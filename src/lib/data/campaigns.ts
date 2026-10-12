import 'server-only';

import { requireUser, requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { requireOwnedEvent, requireEventAccess } from '@/lib/data/events';
import { assertEventNotPast, defaultThankyouSendAt } from '@/lib/data/event-date';
import { countUniqueContactsForEvent } from '@/lib/data/contacts';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { getPackageModelEnabled } from '@/lib/data/payments';
import {
  PACKAGE_NOT_PAID_ERROR,
  PACKAGE_PAYMENT_UNVERIFIED_ERROR,
} from '@/lib/data/package-activation-errors';
import { getPackagePaymentState, packagePaymentOf } from '@/lib/payments/package-paid';
import { getCurrentPricing, getCurrentPricingByCampaign } from '@/lib/data/campaign-pricing';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { isPackageAgreementVersion } from '@/lib/agreements/template';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';
import type { Enums, Json, Tables, TablesUpdate } from '@/lib/supabase/types';
// Campaign = the RSVP outreach of one event, sold as a fixed-price package. The
// commercial terms are copied from the chosen package offer, never accepted from
// the client. Reads are scoped via RLS (can_access_event); writes go through the
// service-role admin client after an explicit ownership check (no client-side
// money writes, §18).

type CampaignRow = Tables<'campaigns'>;
type Channel = Enums<'campaign_channel'>;

export type OwnerCampaign = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'template_id'
  | 'status'
  | 'max_contacts'
  | 'tos_version'
  | 'allowed_channels'
  | 'start_at'
  | 'close_at'
  | 'approved_at'
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
  'id, event_id, template_id, status, max_contacts, tos_version, allowed_channels, start_at, close_at, approved_at, created_at, contact_quota';

// R9 refusal, in the owner's vocabulary (audit §2): the event step is
// "אישור פרטי האירוע", never "פרסום". Exported so the console status route can
// classify it as a 409 without duplicating the string.
export const EVENT_NOT_CONFIRMED_ERROR = 'יש לאשר את פרטי האירוע לפני אישורי הגעה';

// A campaign created under the earlier pay-per-result model cannot be started: it has no package payment.
export const NO_PACKAGE_ERROR = 'לא ניתן להפעיל קמפיין שלא נרכשה עבורו חבילה';

// A single touchpoint in the event-anchored outreach schedule (§10) — a friendly
// drip leading up to the event to maximize reached contacts.
export type OutreachTouchpoint = {
  days_before: number; // days before the event date
  channel: Channel;
  message_key: string; // references an approved WhatsApp template / call script
};

// The fixed-price package catalogue (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-F): active packages
// that carry a contact quota (the packages action refuses a per-reached price, so no package carries one).
//
// The whole catalogue is behind the package switch: while it is off this is empty without a read, so nothing can be
// offered, and createCampaign below cannot snapshot one. Fail-closed like every money switch.
export type PackageOffer = {
  id: string;
  name: string;
  // The package's own price (packages.price_with_vat — the final consumer price; the business is VAT-exempt).
  price: number;
  contact_quota: number;
  description: string | null;
  // What the package includes, one line each (packages.includes — a JSON array of strings).
  includes: string[];
  channels: Channel[];
  outreach_schedule: OutreachTouchpoint[];
};

export async function listPackageOffers(): Promise<PackageOffer[]> {
  if (!(await getPackageModelEnabled())) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_with_vat, contact_quota, description, includes, channels, outreach_schedule')
    .eq('active', true)
    .not('contact_quota', 'is', null)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת החבילות נכשלה');
  return (data ?? [])
    .filter(
      (p) =>
        p.contact_quota != null &&
        p.contact_quota >= 1 &&
        Number(p.price_with_vat) > 0 &&
        (p.channels ?? []).length > 0,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price_with_vat),
      contact_quota: p.contact_quota as number,
      description: p.description,
      includes: Array.isArray(p.includes)
        ? p.includes.filter((x): x is string => typeof x === 'string')
        : [],
      channels: p.channels ?? [],
      outreach_schedule: (p.outreach_schedule as OutreachTouchpoint[] | null) ?? [],
    }));
}

// One offer by id; null when it is not an offer (the switch is off, inactive, legacy, not sellable).
export async function getPackageOffer(packageId: string): Promise<PackageOffer | null> {
  return (await listPackageOffers()).find((o) => o.id === packageId) ?? null;
}

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
  // be stuck at the first step; refusing here avoids that dead end (approveCampaign refuses the version mismatch too).
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
  return { id: data };
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


// Transition a campaign pending_approval → approved. Guarded so a campaign can
// only be approved once (§18.7 — terms lock on approval; no re-approval). The
// approval record must already be stored by the caller before this runs.
// Ownership is verified; the write goes through the service-role admin client
// with an optimistic status guard to be race-safe.
export async function approveCampaign(
  campaignId: string,
  tosVersion: string,
): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  // A campaign is approved only under the package contract, and only when it carries a package (a pricing round).
  if (!isPackageAgreementVersion(tosVersion) || (await getCurrentPricing(campaignId)) === null) {
    throw new Error('ההסכם אינו תואם למודל התמחור של הקמפיין');
  }

  const event = await requireOwnedEvent(campaign.event_id); // ownership
  assertEventNotPast(event.event_date); // L1: no approval for a past event
  // R9: every commercial campaign action requires event.status='active'.
  if (event.status !== 'active') {
    throw new Error(EVENT_NOT_CONFIRMED_ERROR);
  }

  if (campaign.status !== 'pending_approval') {
    throw new Error('ניתן לאשר רק קמפיין הממתין לאישור');
  }

  const { data: updated, error: upErr } = await admin
    .from('campaigns')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      tos_version: tosVersion,
    })
    .eq('id', campaignId)
    .eq('status', 'pending_approval')
    .select('id')
    .maybeSingle();

  if (upErr) throw new Error('אישור הקמפיין נכשל');

  if (!updated) {
    throw new Error('מצב הקמפיין השתנה. יש לרענן ולבדוק את האישור');
  }
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

export type CampaignStatus = Enums<'campaign_status'>;

// WHO is performing a campaign transition.
//
// This is a value, not a boolean "skip auth" flag, on purpose: the console
// variant CARRIES the verified staff user id, so it cannot be conjured by a
// caller that has not been through requireConsoleAgent — and that same id is
// what the support-access audit row is written from. A bare "trust me" mode
// would be one careless import away from an unauthenticated transition.
export type CampaignActor =
  // Cookie session, event owner. The default for every owner-facing Server Action.
  | { kind: 'owner' }
  // Cookie session, platform admin. Wind-down ops (pause / close / cancel).
  | { kind: 'admin' }
  // Bearer session, already verified by the console route as a console agent
  // holding `campaigns.runstate`. Cross-tenant by design (staff), so there is no
  // ownership check here — the ROUTE is the authorization boundary, and what a
  // console actor may reach is narrowed at the call sites below, not here.
  | { kind: 'console'; staffUserId: string };

// Race-safe guarded transition: the UPDATE only matches a row in one of `from`
// (plus any extra column guard), so concurrent calls can't double-transition.
// Identity is verified first. Throws if no row matched its current state.
async function transitionCampaignStatus(
  campaignId: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  // 'package': the campaign must be a package campaign with a recorded payment (verified by preparePackage).
  funding?: 'package',
  // L1/R9: only forward transitions that BEGIN outreach/billing (activate)
  // reject a past event AND require an active event. pause/close must stay
  // allowed for a past/non-active event (cleanup + wind-down paths, per R9's
  // explicit carve-out — cancel/close/settle are not commercial-forward).
  opts?: {
    rejectPastEvent?: boolean;
    requireActiveEvent?: boolean;
    // The funding precondition (the payment, from the ledger). Runs after the identity and event checks, before the
    // status write.
    preparePackage?: (campaign: { id: string; event_id: string }) => Promise<void>;
  },
  // Returns the event's date so a caller (activateCampaign) can seed
  // auto-thankyou's default schedule without a second identity-checked fetch.
  actor: CampaignActor = { kind: 'owner' },
): Promise<{ eventDate: string | null }> {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  // The business guards are deliberately SEPARATE from the identity check: they
  // are two different concerns and are applied independently of who the actor
  // is. Welding them to requireOwnedEvent (the cookie DAL) would drop them for an
  // actor that cannot call it, such as the console route.
  const applyEventGuards = (event: { event_date: string | null; status: string }) => {
    if (opts?.rejectPastEvent) assertEventNotPast(event.event_date);
    if (opts?.requireActiveEvent && event.status !== 'active') {
      throw new Error(EVENT_NOT_CONFIRMED_ERROR);
    }
  };

  let eventDate: string | null;
  if (actor.kind === 'admin') {
    // Staff wind-down: no ownership, no past/active gating. Pinned to
    // `campaigns.runstate` rather than the coarse staff floor — the permission
    // catalogue has a key for exactly this (start/pause/close/cancel a live
    // send), so an auditor cannot stop a running campaign.
    await requirePlatformPermission('campaigns.runstate');
    eventDate = null;
  } else if (actor.kind === 'owner') {
    const event = await requireOwnedEvent(campaign.event_id);
    applyEventGuards(event);
    eventDate = event.event_date;
  } else {
    // Console (Bearer). Identity was verified by the route; read the event with
    // the service-role client so the SAME guards run without the cookie DAL.
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('event_date, status')
      .eq('id', campaign.event_id)
      .maybeSingle();
    if (evErr) throw new Error('טעינת האירוע נכשלה');
    if (!event) throw new Error('האירוע לא נמצא');
    applyEventGuards(event);
    eventDate = event.event_date;
  }

  if (funding === 'package') {
    // Only a package campaign is ever funded: one created under the earlier model has no pricing round and no payment
    // to start from. Rounds are append-only — a campaign that has one cannot stop having one — so this pre-check
    // cannot be raced false, and no update-time re-guard is needed.
    if ((await getCurrentPricing(campaign.id)) === null) throw new Error(NO_PACKAGE_ERROR);
    await opts?.preparePackage?.({ id: campaign.id, event_id: campaign.event_id });
  }

  const query = admin
    .from('campaigns')
    .update({ status: to })
    .eq('id', campaignId)
    .in('status', from);
  const { data: updated, error: upErr } = await query
    .select('id')
    .maybeSingle();
  if (upErr) throw new Error('עדכון מצב הקמפיין נכשל');
  if (!updated) {
    throw new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי');
  }
  return { eventDate };
}

// What a package campaign needs before it may start: its payment recorded in the ledger (the only source of truth for
// package money). The list every send reads is not filled here: guests added before the approval are admitted when the
// terms are approved (agreements.ts), and a guest added later by reconcileCampaignSetForContact (contacts.ts), up to the
// package quota.
async function requirePackageFunding(campaignId: string): Promise<void> {
  let paid: boolean;
  try {
    paid = (await getPackagePaymentState(campaignId)).status === 'collected';
  } catch {
    console.error('[campaign-lifecycle] package payment state could not be read', { campaignId });
    throw new Error(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
  }
  if (!paid) throw new Error(PACKAGE_NOT_PAID_ERROR);
}

// Activate (begin outreach). Requires an approved/scheduled/paused package campaign with a recorded payment — no
// outreach without a secured payment.
//
// `actor` narrows WHICH activations are reachable. An owner may activate from
// any pre-send status; a console agent may only REVIVE, i.e. `paused → active`.
//
// That asymmetry is the whole safety argument, and it lives HERE rather than in
// the route so a future caller cannot widen it: `paused` is reachable only from
// `active` (pauseCampaign is the sole writer of that status, and it accepts only
// `['active']`), so a paused campaign is PROOF the owner already activated it.
// Staff therefore restore a commitment the owner made; they can never create
// one. The package payment is likewise already present on anything that was live.
export async function activateCampaign(
  campaignId: string,
  actor: CampaignActor = { kind: 'owner' },
): Promise<void> {
  const from: CampaignStatus[] =
    actor.kind === 'console' ? ['paused'] : ['approved', 'scheduled', 'paused'];

  const { eventDate } = await transitionCampaignStatus(
    campaignId,
    from,
    'active',
    'package',
    // L1: never begin outreach for a past event. R9: requires an active event.
    {
      rejectPastEvent: true,
      requireActiveEvent: true,
      preparePackage: (c) => requirePackageFunding(c.id),
    },
    actor,
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

  // Auditability (CLAUDE.md): the commercial start of the campaign.
  // Best-effort like the hold's own log — never fails the activation.
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

  // Auto-thankyou: seed the default
  // schedule ONLY the first time this campaign activates — `.is(...null)`
  // guards a re-activation after pause from clobbering an owner-edited
  // send time. A null/unparseable event_date leaves it unset (the owner can
  // still set one manually; the sweep simply never picks up a null).
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
// owner/admin split the rest of this module already uses (CampaignActor).
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
  const staff = await requirePlatformPermission('campaigns.runstate'); // redirects anyone else

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
