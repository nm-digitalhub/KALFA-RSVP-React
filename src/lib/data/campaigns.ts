import 'server-only';

import { unstable_rethrow } from 'next/navigation';

import { requireUser, requirePlatformPermission } from '@/lib/auth/dal';
import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { requireOwnedEvent, requireEventAccess } from '@/lib/data/events';
import { assertEventNotPast, defaultThankyouSendAt } from '@/lib/data/event-date';
import { countUniqueContactsForEvent } from '@/lib/data/contacts';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import { getCurrentPricing, getCurrentPricingByCampaign } from '@/lib/data/campaign-pricing';
import {
  bindBestBenefit,
  acceptBenefitForCampaign,
  releaseCancelledCampaignBenefit,
} from '@/lib/data/coupon-benefits';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';
import type { Json, Tables, TablesUpdate } from '@/lib/supabase/types';
import { getPackageOffer } from '@/lib/data/package-offers';
import {
  EVENT_NOT_CONFIRMED_ERROR,
  requirePackageFunding,
  transitionCampaignStatus,
  type CampaignActor,
  type TransitionSession,
} from '@/lib/data/campaign-transition';

// The catalogue moved to package-offers.ts (worker-safe); re-exported so callers keep importing it from here.
export { listPackageOffers, getPackageOffer } from '@/lib/data/package-offers';
export type { OutreachTouchpoint, PackageOffer } from '@/lib/data/package-offers';

// Campaign = the RSVP outreach of one event, sold as a fixed-price package. The
// commercial terms are copied from the chosen package offer, never accepted from
// the client. Reads are scoped via RLS (can_access_event); writes go through the
// service-role admin client after an explicit ownership check (no client-side
// money writes, §18).

type CampaignRow = Tables<'campaigns'>;

export type OwnerCampaign = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'template_id'
  | 'status'
  | 'max_contacts'
  | 'allowed_channels'
  | 'start_at'
  | 'close_at'
  | 'created_at'
  // How many contacts the campaign may approach (the fixed-price package model); NULL = no quota.
  | 'contact_quota'
> & {
  // The current pricing round's final price (campaign_pricing, task 4.1 — read through the pricing module after the
  // RLS-scoped campaign read proved access). NULL only on a campaign of the retired pay-per-result model, which has
  // no round, cannot be paid and cannot start.
  price: number | null;
};

// Exported so the admin cross-tenant reader (src/lib/data/admin/campaigns.ts)
// selects the SAME shape — an admin viewing a campaign must see exactly what
// the owner sees, and a second column list here would drift. The price is NOT here: it comes from the pricing module.
export const CAMPAIGN_COLUMNS =
  'id, event_id, template_id, status, max_contacts, allowed_channels, start_at, close_at, created_at, contact_quota';

// Create-or-continue the event's SINGLE "RSVP confirmations" campaign in
// `pending_approval`. Idempotent: if a non-cancelled campaign already exists for
// the event it is returned unchanged (one campaign per event — entered via the
// "הפעלת אישורי הגעה" CTA, never a repeatable "new campaign"). The campaign snapshots the chosen package's price
// (its pricing round), quota (`contact_quota`), channels and outreach schedule. The activity window is derived from the
// event date: outreach closes at the event.
//
// Refused unless the package switch is on, the package is an offer, and the ACTIVE agreement is the package contract
// (so the customer approves the terms they bought).
export async function createCampaign(
  eventId: string,
  packageId: string,
): Promise<{ id: string }> {
  const event = await requireOwnedEvent(eventId);
  // L1: block the entry point — never create OR continue a campaign for an event
  // whose day has already passed (the downstream sign/activate/hold guards would
  // block it anyway; this stops the flow before it starts).
  assertEventNotPast(event.event_date);
  // R9: every commercial campaign action requires event.status='active'. App
  // defense-in-depth — the DB trigger (campaigns_require_active_event) is the
  // REST-proof authority.
  if (event.status !== 'active') {
    throw new Error(EVENT_NOT_CONFIRMED_ERROR);
  }

  // Celebrants gate: the outreach sends bind the celebrant names (בעלי השמחה)
  // into the message templates, so they must be COMPLETE for the event's type
  // before RSVP confirmations are enabled. The gate sits BEFORE the
  // create-or-continue early return on purpose — the sends depend on these
  // values, so CONTINUING an existing campaign without them must be blocked
  // exactly like creating a new one. requireOwnedEvent's slim column set does
  // not carry these two fields; this RLS-scoped read fetches just them.
  const supabase = await createClient();
  const { data: celebrantsRow, error: celebrantsErr } = await supabase
    .from('events')
    .select('event_type, celebrants, venue_name')
    .eq('id', eventId)
    .maybeSingle();
  if (celebrantsErr || !celebrantsRow) throw new Error('טעינת האירוע נכשלה');
  if (!celebrantsCompleteFor(celebrantsRow.event_type, celebrantsRow.celebrants)) {
    throw new Error('יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה');
  }
  // The sends also derive day/date/time from event_date and the location from
  // venue_name (WhatsApp params {{4}}..{{7}}): without them EVERY touchpoint
  // would skip as params_incomplete at send time, so enablement is blocked
  // upfront — same before-the-early-return rationale as the celebrants gate.
  if (!event.event_date) {
    throw new Error('יש לקבוע תאריך אירוע לפני הפעלת אישורי הגעה');
  }
  if (
    typeof celebrantsRow.venue_name !== 'string' ||
    celebrantsRow.venue_name.trim() === ''
  ) {
    throw new Error('יש למלא את מקום האירוע בעריכת האירוע לפני הפעלת אישורי הגעה');
  }

  // Create-or-continue: never a second campaign for the same event.
  const existing = await getCampaignForEvent(eventId);
  if (existing) return { id: existing.id };

  // max_contacts is DERIVED from the unique-contact count, not owner input (§7). It may be 0 at creation: the owner
  // can choose a package and approve its terms before finishing the guest list.
  const maxContacts = await countUniqueContactsForEvent(eventId);

  // The offer is read server-side by id — the browser submits only the choice.
  const offer = await getPackageOffer(packageId);
  if (!offer) throw new Error('החבילה שנבחרה אינה זמינה');
  // A package campaign is approved under the package contract — a separate, admin-managed document that must be
  // approved before any customer is offered it. Without it there would be no terms to approve and the customer would
  // be stuck at the first step; refusing here avoids that dead end.
  if (!(await getApprovedPackageAgreementDoc())) {
    throw new Error('הסכם החבילה טרם הופעל — פנו לתמיכה');
  }
  const admin = createAdminClient();
  // Phase 2 of the price migration (personal-coupons D8, task 2.1): the campaign and its pricing round are created
  // in ONE database transaction (create_package_campaign). The pricing row IS the price; the mirror trigger keeps
  // the legacy campaigns column equal in the same transaction until the phase-3 contract drops it.
  const { data, error } = await admin.rpc('create_package_campaign', {
    _event_id: eventId,
    _template_id: offer.id,
    _list_price: offer.price, // the pricing round's list price (and, with no benefit, its final price)
    _contact_quota: offer.contact_quota, // locked copy of the quota
    _max_contacts: maxContacts, // derived from the unique-contact count (§7)
    _allowed_channels: offer.channels,
    _close_at: event.event_date, // window closes at the event date
    _outreach_schedule: offer.outreach_schedule as unknown as Json,
  });
  if (error || typeof data !== 'string') throw new Error('יצירת הקמפיין נכשלה');

  // The binding applied at package choice (personal-coupons task 5.2): once the campaign and its
  // round exist, the account's best eligible benefit for the chosen package is bound (D18 picks
  // the lowest final price; a phone benefit is claimed on first use). NON-FATAL: a benefit that
  // cannot be bound leaves the campaign at its list price — it never blocks the purchase flow.
  try {
    const user = await requireUser();
    await bindBestBenefit({ campaignId: data, eventId, packageId: offer.id, user });
  } catch (err) {
    unstable_rethrow(err);
    console.error('[campaigns] benefit bind at package choice failed', {
      campaignId: data,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { id: data };
}

// The package change BEFORE approval (personal-coupons task 5.3, D5/D17): the event's pending
// campaign moves to another offered package. One database transaction (change_campaign_package):
// the campaign's snapshot fields, the current UNLOCKED round at the new list price, and the bound
// benefit following the change — onto the new package's frozen option, or unbound when the new
// package has no option. A locked round is refused there (past approval the only path is the
// supersede operation). The celebrants/date gates are not re-run: they passed at creation and a
// package change does not touch them.
export async function changeCampaignPackage(
  eventId: string,
  packageId: string,
): Promise<{ id: string; changed: boolean }> {
  const event = await requireOwnedEvent(eventId);
  assertEventNotPast(event.event_date);
  if (event.status !== 'active') {
    throw new Error(EVENT_NOT_CONFIRMED_ERROR);
  }
  const campaign = await getCampaignForEvent(eventId);
  if (!campaign) throw new Error('אין קמפיין לאירוע — יש לבחור חבילה תחילה');
  if (campaign.status !== 'pending_approval') {
    throw new Error('לא ניתן להחליף חבילה אחרי אישור התנאים');
  }
  // The offer is read server-side by id — the browser submits only the choice.
  const offer = await getPackageOffer(packageId);
  if (!offer) throw new Error('החבילה שנבחרה אינה זמינה');

  const user = await requireUser();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('change_campaign_package', {
    _campaign_id: campaign.id,
    _template_id: offer.id,
    _list_price: offer.price,
    _contact_quota: offer.contact_quota,
    _allowed_channels: offer.channels,
    _outreach_schedule: offer.outreach_schedule as unknown as Json,
    _actor_user_id: user.id,
  });
  if (error || typeof data !== 'string') throw new Error('החלפת החבילה נכשלה');
  if (data === 'unchanged') return { id: campaign.id, changed: false };

  await logActivity({
    eventId,
    action: 'campaign.package_changed',
    meta: { campaignId: campaign.id, packageId: offer.id, benefit: data },
  });

  // D18 after the move: another eligible benefit may price the NEW package lower than whatever the
  // transaction left bound (or nothing is bound now) — the same non-fatal best-price pass as at
  // package choice. bind_coupon_assignment releases a replaced assignment in the same transaction.
  try {
    await bindBestBenefit({ campaignId: campaign.id, eventId, packageId: offer.id, user });
  } catch (err) {
    unstable_rethrow(err);
    console.error('[campaigns] benefit re-bind after package change failed', {
      campaignId: campaign.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { id: campaign.id, changed: true };
}

// The acceptance flow's entry (task 5.5, ש5/D21): the owner of an APPROVED, unpaid campaign
// accepts a waiting benefit — the approved terms are superseded by the discounted price and the
// campaign returns to approval. Ownership proven first; the campaign must belong to the event and
// hold approved terms; the supersede rpc itself refuses any campaign with money movement.
export async function acceptCampaignBenefit(
  eventId: string,
  campaignId: string,
): Promise<'accepted' | 'none'> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, event_id, status, template_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data || data.event_id !== eventId) {
    const { notFound } = await import('next/navigation');
    notFound();
  }
  const campaign = data as NonNullable<typeof data>; // notFound() above never returns
  if (campaign.status !== 'approved') {
    throw new Error('ההטבה מתקבלת רק אחרי אישור תנאים וכשטרם שולם');
  }
  if (!campaign.template_id) throw new Error('לקמפיין אין חבילה');

  const user = await requireUser();
  return acceptBenefitForCampaign({
    campaignId: campaign.id,
    eventId,
    packageId: campaign.template_id,
    user,
  });
}

export async function getCampaign(campaignId: string): Promise<OwnerCampaign> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) {
    const { notFound } = await import('next/navigation');
    notFound();
  }
  // The RLS-scoped read above proved access; the price comes from the round (the pricing module, task 4.1).
  const row = data as NonNullable<typeof data>; // notFound() above never returns
  return { ...row, price: (await getCurrentPricing(row.id))?.price ?? null } as OwnerCampaign;
}

export async function listCampaignsForEvent(
  eventId: string,
): Promise<OwnerCampaign[]> {
  await requireEventAccess(eventId, 'campaigns', 'view');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('טעינת הקמפיינים נכשלה');
  const rows = data ?? [];
  // ONE batch read for every campaign's current round — no per-row query.
  const pricing = await getCurrentPricingByCampaign(rows.map((c) => c.id));
  return rows.map((c) => ({ ...c, price: pricing.get(c.id)?.price ?? null })) as OwnerCampaign[];
}

// The event's "RSVP confirmations" campaign. Returns the most-recent
// NON-cancelled campaign (or null), so `cancelled` is excluded to let a future
// campaign replace a retired one. Scoped via RLS (can_access_event).
// NOTE: "one non-cancelled campaign per event" is upheld by createCampaign's
// create-or-continue early return (a check-then-insert using this function) and
// backstopped in the DB by the partial unique index campaigns_event_noncancelled_uidx
// (event_id) WHERE status <> 'cancelled', so a concurrent createCampaign race fails
// the insert instead of creating two non-cancelled rows.
export async function getCampaignForEvent(
  eventId: string,
): Promise<OwnerCampaign | null> {
  await requireEventAccess(eventId, 'campaigns', 'view');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) return null;
  return { ...data, price: (await getCurrentPricing(data.id))?.price ?? null } as OwnerCampaign;
}

// The event's campaign STAGE only, for surfaces that show it next to ANOTHER
// resource (the guests page's "add guests" empty state). Two deliberate
// differences from getCampaignForEvent above:
//   1. Minimal DTO — the caller renders one badge, so it gets the derived stage
//      and never the OwnerCampaign row (pricing, ceiling, capture fields).
//   2. Returns null instead of notFound()-ing when the viewer lacks
//      ('campaigns','view'). Permissions are per-role and admin-configurable
//      (20260713203826_org_role_permissions_per_role), so a member may hold
//      ('guests','view') WITHOUT campaigns access; 404-ing the whole guests page
//      over a decorative badge would be a regression. The RPC below IS the authz
//      gate for this read — the function is self-gating, not caller-dependent.
export async function getCampaignStageForEvent(
  eventId: string,
): Promise<CampaignStage | null> {
  await requireUser();
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc('can_access_event', {
    _event_id: eventId,
    _resource: 'campaigns',
    _action: 'view',
  });
  if (allowed !== true) return null;
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) return campaignStage(null);
  // A package campaign is funded by its payment, which only the ledger knows; the round says whether it IS a package.
  const price = (await getCurrentPricing(data.id))?.price ?? null;
  const withPrice = { ...data, price };
  return campaignStage({ ...withPrice, payment: await packagePaymentOf(withPrice) });
}

// The campaign's identity for an owner action: which event it belongs to, so the caller can verify ownership.
// Service-role read; the caller checks ownership with requireOwnedEvent.
export type CampaignRef = Pick<CampaignRow, 'id' | 'event_id' | 'status'>;

export async function getCampaignRef(campaignId: string): Promise<CampaignRef | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  return data;
}

// The package purchase's view of a campaign: its status and the fixed price agreed at approval. The price is read here,
// on the server, FROM THE CURRENT PRICING ROUND, and is the ONLY source of the amount charged — the browser submits
// nothing but a card token. `price` NULL means a campaign of the retired pay-per-result model (no round), which the
// purchase route must refuse.
export type CampaignPurchaseState = Pick<CampaignRow, 'id' | 'event_id' | 'status'> & {
  price: number | null;
  /** The name of the package the campaign was created from (campaigns.template_id → packages): the receipt line. */
  package_name: string | null;
};

// Service-role read; the caller (the purchase Route Handler) verifies ownership.
export async function getCampaignForPurchase(
  campaignId: string,
): Promise<CampaignPurchaseState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, package:packages(name)')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) return null;
  const { package: pkg, ...campaign } = data;
  const price = (await getCurrentPricing(campaignId))?.price ?? null;
  return { ...campaign, price, package_name: pkg?.name ?? null };
}

// --- Campaign lifecycle (no money) ------------------------------------------
// Status transitions. A package campaign is paid once, at purchase (src/lib/payments).

// The transition itself (event guards, funding check, guarded UPDATE) and the actor types live in campaign-transition.ts,
// which the worker can import to start a paid package (design D23). This module supplies the cookie-session half.
const REQUEST_SESSION: TransitionSession = {
  async requireStaff() {
    // Staff wind-down: no ownership, no past/active gating. Pinned to
    // `campaigns.runstate` rather than the coarse staff floor — the permission
    // catalogue has a key for exactly this (start/pause/close/cancel a live
    // send), so an auditor cannot stop a running campaign. The key comes from the CASL map (Campaign.runstate).
    await requirePlatformAction('runstate', 'Campaign');
  },
  async notFound() {
    const { notFound } = await import('next/navigation');
    return notFound();
  },
};

// Revive (resume outreach): `paused → active`, by a console agent holding `campaigns.runstate` (the console status
// route). Requires the package payment, like every start — no outreach without a secured payment.
//
// The FIRST start is not here: it is the server's, once the payment is recorded (activateCampaignAfterPayment, design
// D23); a customer never starts a campaign. Revival is the only activation left, and it is safe because `paused` is
// reachable only from `active` (pauseCampaign is the sole writer of that status, and it accepts only `['active']`):
// a paused campaign is PROOF the paid service already started. Staff resume that commitment; they can never create
// one. The console actor is the only one the type accepts, so a future caller cannot widen it.
export async function activateCampaign(
  campaignId: string,
  actor: Extract<CampaignActor, { kind: 'console' }>,
): Promise<void> {
  const { eventDate } = await transitionCampaignStatus(
    campaignId,
    ['paused'],
    'active',
    'package',
    // L1: never begin outreach for a past event. R9: requires an active event.
    {
      rejectPastEvent: true,
      requireActiveEvent: true,
      preparePackage: (c) => requirePackageFunding(c.id),
    },
    actor,
    REQUEST_SESSION,
  );

  // Additive ops alert (fire-and-forget, fail-safe): fires only once the guarded
  // transition to 'active' succeeded. event_id is not returned by the transition
  // helper, so only campaign_id is included (no extra DB read just for the alert).
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'campaign-lifecycle',
    title: 'קמפיין הופעל — הפניות מתחילות',
    fields: { campaign_id: campaignId },
  });

  // Auditability (CLAUDE.md): sending resumes, recorded like a start (the first
  // start writes its own row, activate-paid-package.ts). Best-effort — never fails the revival.
  // Needs event_id; the transition helper returns only the date, so one narrow
  // read. No PII: ids + actor kind only.
  try {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from('campaigns')
      .select('event_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (row?.event_id) {
      await logActivity({
        eventId: row.event_id,
        action: 'campaign.activated',
        meta: { campaignId, actor: actor.kind },
      });
    }
  } catch (err) {
    console.error('[campaign-lifecycle] logActivity(campaign.activated) failed (non-fatal)', {
      campaignId,
      err,
    });
  }

  // Auto-thankyou: the first start seeds the default schedule
  // (activate-paid-package.ts). A revival fills it only while it is still empty —
  // `.is(...null)` keeps it from clobbering an owner-edited send time. A
  // null/unparseable event_date leaves it unset (the owner can still set one
  // manually; the sweep simply never picks up a null).
  const seeded = defaultThankyouSendAt(eventDate);
  if (seeded) {
    const admin = createAdminClient();
    await admin
      .from('campaigns')
      .update({ thankyou_send_at: seeded })
      .eq('id', campaignId)
      .is('thankyou_send_at', null);
  }
}

// Wind-down: `active → paused`. Platform admin on the web; a console agent with
// `campaigns.runstate` may also pause.
//
// Opening the stop button wider than the start button is deliberate. Pausing is
// a SAFETY action — a guest complains, a template is wrong, the owner phones
// support — and the person taking that call must be able to stop sends
// immediately rather than escalate while messages keep going out. A wrong pause
// costs nothing: it is fully reversible by the revival path above. A late pause
// costs messages that cannot be recalled.
export async function pauseCampaign(
  campaignId: string,
  actor: CampaignActor = { kind: 'admin' },
): Promise<void> {
  await transitionCampaignStatus(
    campaignId,
    ['active'],
    'paused',
    undefined,
    undefined,
    actor,
    REQUEST_SESSION,
  );
}

// --- Auto-thankyou owner controls -------------------------------------------
// thankyou_auto_enabled / thankyou_send_at / thankyou_sent_at (migration
// 20260712205030_auto_thankyou_schema.sql, applied + gen-typed). The read below
// keeps its select('*') + runtime narrowing as a fail-open guard (an absent
// column must read as the plan's default, not "disabled"); the write is typed.
// The sweep itself (src/lib/data/auto-thankyou.ts) reads these via its own
// admin-scoped query; these are the OWNER-FACING read/write (the read is
// RLS-scoped like the rest of this file's getters; the write goes through the
// service-role client after its own authorization check).

export type ThankyouSchedule = {
  autoEnabled: boolean;
  sendAt: string | null;
  sentAt: string | null;
};

// Does the CURRENT viewer own the campaign's event? Mirrors the owner rule the
// write enforces (updateThankyouSchedule -> requireOwnedEvent; platform staff take
// a separate branch there), so the page can render the thank-you form only where
// submitting it can actually succeed.
//
// Deliberately NOT requireEventAccess: that gate is org-aware, and an org member
// holding campaigns:view passes it while the owner-only write still refuses —
// which is precisely the case that produced a visible button guaranteed to fail.
//
// Uses the service-role client on purpose: the answer is a boolean about the
// VIEWER's own relationship to the campaign, so it discloses nothing about the
// customer and needs no audit row. It reads no customer data at all.
export async function viewerOwnsCampaignEvent(campaignId: string): Promise<boolean> {
  const user = await requireUser();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('events!inner(owner_id)')
    .eq('id', campaignId)
    .maybeSingle<{ events: { owner_id: string } }>();
  if (error) throw new Error('בדיקת הבעלות על הקמפיין נכשלה');
  return data?.events.owner_id === user.id;
}

export async function getThankyouSchedule(
  campaignId: string,
): Promise<ThankyouSchedule | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  return {
    // Fail-open toward the plan's confirmed default (true) rather than false —
    // an absent column (migration not yet applied) must not read as "disabled".
    autoEnabled: raw.thankyou_auto_enabled !== false,
    sendAt: typeof raw.thankyou_send_at === 'string' ? raw.thankyou_send_at : null,
    sentAt: typeof raw.thankyou_sent_at === 'string' ? raw.thankyou_sent_at : null,
  };
}

// Edits the opt-in flag and/or the scheduled time. Blocked once
// thankyou_sent_at is set — the plan's "cancel window" is explicitly BEFORE
// the sweep/manual send fires, not after (nothing to cancel once it's out).
//
// AUTHORIZATION — owner OR platform staff holding manage_billing, the same
// owner/staff split the rest of this module uses (requireOwnedEvent for the owner, a named permission for staff).
// Staff who may pause, close, CANCEL and settle-and-charge a customer's
// campaign could not move its thank-you time by an hour. That was not a
// security boundary, just an inconsistency: the four heavier operations are
// `campaigns.runstate`-authorized a few lines from here, and manage_billing is exactly
// the permission the admin controls on this page already demand.
//
// The branch is decided HERE, from the caller's own identity — never from a
// flag the page passes in. An org member who is neither owner nor staff is
// still refused, precisely as before: this widens nothing beyond platform
// staff, who could already end the campaign outright.
export async function updateThankyouSchedule(
  campaignId: string,
  patch: { autoEnabled?: boolean; sendAt?: string | null },
): Promise<void> {
  const service = createAdminClient();
  const { data: campaign, error } = await service
    .from('campaigns')
    .select('id, event_id, events!inner(owner_id)')
    .eq('id', campaignId)
    .maybeSingle<{ id: string; event_id: string; events: { owner_id: string } }>();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  const user = await requireUser();
  if (campaign.events.owner_id === user.id) {
    await requireOwnedEvent(campaign.event_id); // ownership, defense-in-depth beyond RLS
  } else {
    // A cross-tenant WRITE by staff. service_role carries no user identity, so
    // the fail-closed audit row before it is the only thing that can answer
    // "who changed this customer's schedule" — the same reason the admin
    // readers on this page audit rather than relying on an RLS grant.
    const staff = await requirePlatformPermission('manage_billing');
    await recordStaffAccess({
      staffId: staff.id,
      permission: 'manage_billing',
      subjectType: 'campaign',
      subjectId: campaignId,
      ownerId: campaign.events.owner_id,
      eventId: campaign.event_id,
    });
  }

  const update: TablesUpdate<'campaigns'> = {};
  if (patch.autoEnabled !== undefined) update.thankyou_auto_enabled = patch.autoEnabled;
  if (patch.sendAt !== undefined) update.thankyou_send_at = patch.sendAt;
  if (Object.keys(update).length === 0) return;

  const admin = createAdminClient();
  const { data: updated, error: upErr } = await admin
    .from('campaigns')
    .update(update)
    .eq('id', campaignId)
    .is('thankyou_sent_at', null)
    .select('id')
    .maybeSingle();
  if (upErr) throw new Error('עדכון לוח הזמנים נכשל');
  if (!updated) {
    throw new Error('הודעת התודה כבר נשלחה — לא ניתן לשנות את התזמון');
  }
}

// Close the campaign (no new outreach after this; the package was paid at purchase, so closing moves no money).
// Wind-down: platform-admin only. NOT opened to the console — closing ends the campaign, which stays owner/admin.
export async function closeCampaign(campaignId: string): Promise<void> {
  await transitionCampaignStatus(
    campaignId,
    ['active', 'paused', 'approved', 'scheduled'],
    'closed',
    undefined,
    undefined,
    { kind: 'admin' },
    REQUEST_SESSION,
  );
}

// R8 — cancel a campaign with no financial commitment (draft/pending_approval/
// approved → cancelled). Explicit authorization contract: the RPC
// itself is service_role-only with NO caller-identity check, so authorization is
// entirely this function's job, BEFORE the RPC is ever called. Cancel is a
// wind-down operation restricted to holders of `campaigns.runstate` — not the
// event owner. The campaign is loaded via getCampaignRef because
// campaign.event_id feeds the success Slack alert below. campaignId is NEVER
// trusted from the browser to imply authorization.
export async function cancelCampaign(campaignId: string): Promise<void> {
  const campaign = await getCampaignRef(campaignId);
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  const staff = await requirePlatformAction('runstate', 'Campaign'); // redirects anyone else

  // The RPC writes the audit row itself, in the same transaction as the status change, and names who did it: the staff member who
  // just passed the gate above - never an id from the browser. Without a record the cancellation does not happen.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('cancel_campaign', {
    p_campaign: campaignId,
    p_actor: staff.id,
  });
  if (error) throw new Error('ביטול הקמפיין נכשל');
  if (data === 'no_campaign' || data === 'not_cancellable') {
    throw new Error('לא ניתן לבטל קמפיין זה');
  }
  // D17 (personal-coupons task 5.3): a cancelled campaign frees its bound, unconsumed benefit so
  // it follows the event's next campaign. Runs on 'already_cancelled' too — a release that failed
  // on the first cancel self-heals on the retry. Loud but non-fatal (the cancel already stands).
  try {
    await releaseCancelledCampaignBenefit(campaignId, staff.id);
  } catch (err) {
    unstable_rethrow(err);
    console.error('[campaigns] benefit release on cancel failed', {
      campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // 'cancelled' and 'already_cancelled' are both idempotent success.
  // Additive ops alert (fire-and-forget, fail-safe): only a FRESH cancellation
  // is alerted; 'already_cancelled' is idempotent-retry noise and stays silent.
  if (data === 'cancelled') {
    void sendSlackAlert({
      level: 'info',
      category: 'campaign_billing',
      source: 'campaign-lifecycle',
      title: 'קמפיין בוטל',
      fields: { campaign_id: campaignId, event_id: campaign.event_id },
    });
  }
}
