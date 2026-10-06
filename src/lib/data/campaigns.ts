import 'server-only';

import { requireUser, requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { requireOwnedEvent, requireEventAccess } from '@/lib/data/events';
import { assertEventNotPast, defaultThankyouSendAt } from '@/lib/data/event-date';
import {
  countUniqueContactsForEvent,
  snapshotAuthorizedSet,
} from '@/lib/data/contacts';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';
import { getBaseOveragePricingEnabled, getPackageModelEnabled } from '@/lib/data/payments';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import {
  PACKAGE_NOT_PAID_ERROR,
  PACKAGE_NO_CONTACTS_ERROR,
  PACKAGE_PAYMENT_UNVERIFIED_ERROR,
  PACKAGE_SUPPORT_ERROR,
} from '@/lib/data/package-activation-errors';
import { getPackagePaymentState, packagePaymentOf } from '@/lib/payments/package-paid';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { isPackageAgreementVersion } from '@/lib/agreements/template';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';
import type { Enums, Json, Tables, TablesUpdate } from '@/lib/supabase/types';
// Campaign = "campaign approval for an event" (outcome-billing). The commercial
// terms are copied from the service template (or the chosen package offer), never
// accepted from the client; the charge ceiling is computed server-side. Reads are
// scoped via RLS (can_access_event); writes go through the service-role admin
// client after an explicit ownership check (no client-side billing writes, §18).

type CampaignRow = Tables<'campaigns'>;
type Channel = Enums<'campaign_channel'>;

export type OwnerCampaign = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'status'
  | 'price_per_reached'
  | 'max_contacts'
  | 'max_charge_ceiling'
  | 'base_price'
  | 'included_reached'
  | 'tos_version'
  | 'allowed_channels'
  | 'start_at'
  | 'close_at'
  | 'approved_at'
  | 'final_charge_amount'
  | 'credit_applied'
  | 'capture_status'
  | 'charge_status'
  | 'created_at'
  // The REAL J5 hold amount, sized to `covered` (min(max_contacts,
  // reasonable_coverage_contacts)) — NOT the same as max_charge_ceiling when
  // max_contacts exceeds the reasonable-coverage cap (300 today). Needed to
  // show what was actually authorized, not the (possibly larger) ceiling.
  | 'auth_amount'
  // Fixed package price agreed at approval (NULL = a pay-per-result campaign). The payment page branches on it:
  // a package campaign is paid by one purchase, never by a card hold.
  | 'package_price'
  // How many contacts the campaign may approach (the fixed-price package model); NULL = no quota.
  | 'contact_quota'
>;

// Exported so the admin cross-tenant reader (src/lib/data/admin/campaigns.ts)
// selects the SAME shape — an admin viewing a campaign must see exactly what
// the owner sees, and a second column list here would drift.
export const CAMPAIGN_COLUMNS =
  'id, event_id, status, price_per_reached, max_contacts, max_charge_ceiling, base_price, included_reached, tos_version, allowed_channels, start_at, close_at, approved_at, final_charge_amount, credit_applied, capture_status, charge_status, created_at, auth_amount, package_price, contact_quota';

// R9 refusal, in the owner's vocabulary (audit §2): the event step is
// "אישור פרטי האירוע", never "פרסום". Exported so the console status route can
// classify it as a 409 without duplicating the string.
export const EVENT_NOT_CONFIRMED_ERROR = 'יש לאשר את פרטי האירוע לפני אישורי הגעה';

// Pure: the approved charge ceiling = price-per-reached × max contacts, rounded
// to agorot. The ceiling is the maximum the system may bill under an agreement
// that quotes a frozen figure (v4 and earlier; close-charge.ts leaves an
// open-ceiling agreement uncapped) (§7); it is derived server-side and never
// accepted from the client.
export function computeCeiling(pricePerReached: number, maxContacts: number): number {
  return Math.round(pricePerReached * maxContacts * 100) / 100;
}

// Pure: the COVERED contact count = min(full_unique, reasonable_coverage). It is
// the cap the authorized SET is snapshotted to at the hold and the basis for the
// J5 hold. The CHARGE CEILING (full×price) is NOT lowered to this.
export function computeCovered(
  fullUnique: number,
  reasonableCoverage: number,
): number {
  return Math.max(0, Math.min(fullUnique, reasonableCoverage));
}

// Pure: the J5 hold (authorization) amount = covered × price × (1 + buffer),
// rounded to agorot, but never below the package's min_hold_floor. The hold is
// SECURITY only and is sized to `covered` (NOT the full ceiling); it is a card
// guarantee, not a billing bound (the authorized set no longer caps `reached`).
// `holdBufferPct` is a FRACTION, not a percent
// number (0.1 = +10%); it stays 0 while pricing is uniform. The floor never
// raises the final charge — that settles from contacts actually reached.
export function computeHoldAmount(
  covered: number,
  pricePerReached: number,
  minHoldFloor: number,
  holdBufferPct: number,
): number {
  const sized =
    Math.round(covered * pricePerReached * (1 + holdBufferPct) * 100) / 100;
  return Math.max(minHoldFloor, sized);
}

// Pure: the flat-base + included + overage charge ceiling = base + max(0,
// maxContacts − included) × overage, rounded to agorot. With base=0 & included=0
// this equals the legacy computeCeiling(overage, maxContacts) — so a gated-OFF
// campaign (base/included snapshotted 0) keeps the legacy ceiling exactly.
export function computeCeilingBaseOverage(
  base: number,
  included: number,
  overage: number,
  maxContacts: number,
): number {
  const gross = base + Math.max(0, maxContacts - included) * overage;
  return Math.round(gross * 100) / 100;
}

// Pure: the flat-base + included + overage J5 hold = (base + max(0, covered −
// included) × overage) × (1 + buffer), rounded to agorot, floored at
// min_hold_floor. With base=0 & included=0 this equals the legacy
// computeHoldAmount(covered, overage, floor, buffer) — behaviour-neutral for the
// gated-OFF path. The base term makes the hold cover the always-charged fee.
export function computeHoldAmountBaseOverage(
  base: number,
  included: number,
  overage: number,
  covered: number,
  minHoldFloor: number,
  holdBufferPct: number,
): number {
  const gross = base + Math.max(0, covered - included) * overage;
  const sized = Math.round(gross * (1 + holdBufferPct) * 100) / 100;
  return Math.max(minHoldFloor, sized);
}

// A single touchpoint in the event-anchored outreach schedule (§10) — a friendly
// drip leading up to the event to maximize reached contacts.
export type OutreachTouchpoint = {
  days_before: number; // days before the event date
  channel: Channel;
  message_key: string; // references an approved WhatsApp template / call script
};

// Commercial templates (§17) — active packages that carry a recommended
// price-per-reached, the channels, and the outreach schedule. KALFA (admin)
// defines these; the owner chooses one (or, with one, just sees it).
export type CampaignTemplate = {
  id: string;
  name: string;
  price_per_reached: number;
  // Flat-base + included tier. 0 when the package has no base set.
  // price_per_reached is the per-reached OVERAGE rate above `included_reached`.
  base_price: number;
  included_reached: number;
  description: string | null;
  channels: Channel[];
  outreach_schedule: OutreachTouchpoint[];
};

export async function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select(
      'id, name, price_per_reached, base_price, included_reached, description, channels, outreach_schedule',
    )
    .eq('active', true)
    .not('price_per_reached', 'is', null)
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת מסלולי השירות נכשלה');
  return (data ?? [])
    .filter((p): p is typeof p & { price_per_reached: number } =>
      p.price_per_reached != null,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      price_per_reached: Number(p.price_per_reached),
      base_price: Number(p.base_price ?? 0),
      included_reached: Number(p.included_reached ?? 0),
      description: p.description,
      channels: p.channels ?? [],
      outreach_schedule:
        (p.outreach_schedule as OutreachTouchpoint[] | null) ?? [],
    }));
}

// The fixed-price package catalogue (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-F): active packages
// that carry a contact quota. A package is EITHER pay-per-result (a price per reached contact — listCampaignTemplates
// above, unchanged) OR fixed-price (a quota); the admin form refuses a mix, and a row that is both is not an offer here
// either, so it can never be sold under the wrong model.
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
    .is('price_per_reached', null)
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

// One offer by id; null when it is not an offer (the switch is off, inactive, pay-per-result, not sellable).
export async function getPackageOffer(packageId: string): Promise<PackageOffer | null> {
  return (await listPackageOffers()).find((o) => o.id === packageId) ?? null;
}

// Create-or-continue the event's SINGLE "RSVP confirmations" campaign in
// `pending_approval`. Idempotent: if a non-cancelled campaign already exists for
// the event it is returned unchanged (one campaign per event — entered via the
// "הפעלת אישורי הגעה" CTA, never a repeatable "new campaign"). Price, channels
// and the outreach schedule are copied+locked from the CANONICAL template
// (§17/§18.7) — the owner chooses nothing. The activity window is derived from
// the event date: outreach closes at the event; the post-event charge is a
// separate settle step.
//
// `packageId` selects the FIXED-PRICE package model instead: the campaign snapshots that package's price
// (`package_price`) and quota (`contact_quota`) and carries no per-reached formula. Without it everything is exactly as
// before — the canonical pay-per-result template. The package path is refused unless the package switch is on, the
// package is an offer, and the ACTIVE agreement is the package contract (so the customer approves the terms they bought).
export async function createCampaign(
  eventId: string,
  packageId?: string,
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

  // max_contacts is DERIVED from the unique-contact count, not owner input (§7).
  // May be 0 at creation — the base+overage flat fee prices a 0-contact campaign
  // just fine (ceiling = base_price), and prepareCampaignHold re-derives the real
  // count (and the authorize route refuses a ₪0 hold) before any money moves.
  // Letting creation proceed lets the owner sign the agreement before finishing
  // their guest list, instead of being blocked at the very first step.
  const maxContacts = await countUniqueContactsForEvent(eventId);

  const admin = createAdminClient();

  if (packageId !== undefined) {
    // The fixed-price package path. The offer is read server-side by id — the browser submits only the choice.
    const offer = await getPackageOffer(packageId);
    if (!offer) throw new Error('החבילה שנבחרה אינה זמינה');
    // A package campaign is approved under the package contract — a separate, admin-managed document that must be
    // approved before any customer is offered it. Without it there would be no terms to approve and the customer would
    // be stuck at the first step; refusing here avoids that dead end (approveCampaign refuses the version mismatch too).
    if (!(await getApprovedPackageAgreementDoc())) {
      throw new Error('הסכם החבילה טרם הופעל — פנו לתמיכה');
    }
    const { data, error } = await admin
      .from('campaigns')
      .insert({
        event_id: eventId,
        status: 'pending_approval',
        template_id: offer.id,
        package_price: offer.price, // locked copy of the package price
        contact_quota: offer.contact_quota, // locked copy of the quota
        // No per-reached formula in this model. 0 and not NULL on purpose: billed_results.locked_price is NOT NULL
        // (try_record_billed_result copies price_per_reached into it), so a NULL here would make the first reached
        // contact fail to record; and recordSignedAgreement refuses a campaign whose terms are NULL.
        price_per_reached: 0,
        base_price: 0,
        included_reached: 0,
        max_contacts: maxContacts, // derived from the unique-contact count (§7)
        max_charge_ceiling: 0, // nothing is billed by reach, so there is no ceiling to cap
        allowed_channels: offer.channels,
        start_at: null,
        close_at: event.event_date, // window closes at the event date
        outreach_schedule: offer.outreach_schedule as unknown as Json,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error('יצירת הקמפיין נכשלה');
    return { id: data.id };
  }

  // The single active commercial template (the owner does not choose).
  const template = await resolveCanonicalTemplate();
  if (template.channels.length === 0) {
    throw new Error('למסלול השירות לא הוגדרו ערוצי פנייה');
  }
  const price = template.price_per_reached;
  // Base+overage gate: OFF (default) ⇒ snapshot base/included = 0 ⇒
  // the close-charge formula reduces to pure per-reached (the legacy behaviour).
  // ON ⇒ snapshot the package's base/included, activating base charging for this
  // NEW campaign. The snapshot pins the terms the customer signs against.
  const useBaseOverage = await getBaseOveragePricingEnabled();
  const base = useBaseOverage ? template.base_price : 0;
  const included = useBaseOverage ? template.included_reached : 0;

  const { data, error } = await admin
    .from('campaigns')
    .insert({
      event_id: eventId,
      status: 'pending_approval',
      template_id: template.id,
      price_per_reached: price, // locked copy from the canonical template
      base_price: base, // 0 unless the base+overage gate is on
      included_reached: included, // 0 unless the base+overage gate is on
      max_contacts: maxContacts, // derived from the unique-contact count (§7)
      max_charge_ceiling: computeCeilingBaseOverage(base, included, price, maxContacts),
      allowed_channels: template.channels, // from the template, not owner choice
      start_at: null,
      close_at: event.event_date, // window closes at the event date
      // Outreach schedule copied + locked from the template (§10/§17).
      outreach_schedule: template.outreach_schedule as unknown as Json,
      // steps ('[]') and enabled (false) use their column defaults.
    })
    .select('id')
    .single();

  if (error || !data) throw new Error('יצירת הקמפיין נכשלה');
  return { id: data.id };
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
  return data as OwnerCampaign;
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
  return (data ?? []) as OwnerCampaign[];
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
  return (data ?? null) as OwnerCampaign | null;
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
    .select('id, status, capture_status, package_price')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  // A package campaign is funded by its payment, which only the ledger knows.
  return campaignStage(data ? { ...data, payment: await packagePaymentOf(data) } : null);
}

// The single active commercial template ("canonical") — the owner no longer
// chooses one. Reuses listCampaignTemplates' filter (active + priced); takes the
// first by sort_order. Throws a safe error when none is configured.
export async function resolveCanonicalTemplate(): Promise<CampaignTemplate> {
  const templates = await listCampaignTemplates();
  const template = templates[0];
  if (!template) {
    throw new Error('שירות אישורי ההגעה אינו מוגדר כעת — פנו לתמיכה');
  }
  return template;
}

// Transition a campaign pending_approval → approved. Guarded so a campaign can
// only be approved once (§18.7 — terms lock on approval; no re-approval). The
// signed agreement must already be recorded by the caller before this runs.
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
    .select('id, event_id, status, package_price')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  // The contract must match the campaign's pricing model: a fixed-price package campaign is approved under the package
  // contract and a pay-per-result one is signed under the pay-per-result contract, never the other way round. The money follows
  // the signed version (close-charge), so a mismatch would bind the customer to terms they did not buy.
  if (isPackageAgreementVersion(tosVersion) !== (campaign.package_price != null)) {
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

  const { error: upErr } = await admin
    .from('campaigns')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      tos_version: tosVersion,
    })
    .eq('id', campaignId)
    .eq('status', 'pending_approval'); // race-safe optimistic guard
  if (upErr) throw new Error('אישור הקמפיין נכשל');
}

// --- Route A: J5 authorization hold (card capture at approval) ---------------
// capture_status is a free-text column; the working vocabulary is:
//   null         no hold yet
//   pending      a hold attempt is in flight (the atomic lock below)
//   authorized   a hold succeeded (auth_number/card_token_ref stored)
//   hold_failed  a definitive decline — retryable
//   hold_review  an ambiguous provider outcome — retryable / needs reconciliation

export type CampaignHoldState = Pick<
  CampaignRow,
  'id' | 'event_id' | 'status' | 'max_charge_ceiling' | 'capture_status' | 'package_price'
>;

// Read the hold-relevant fields. Service-role (the hold writes bypass RLS); the
// caller (the Route Handler) has already verified ownership.
export async function getCampaignForHold(
  campaignId: string,
): Promise<CampaignHoldState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, max_charge_ceiling, capture_status, package_price')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  return data;
}

// The package purchase's view of a campaign: its status and the fixed price agreed at approval. The price is read here,
// on the server, and is the ONLY source of the amount charged — the browser submits nothing but a card token.
// `package_price` NULL means a pay-per-result campaign, which the purchase route must refuse. The two legacy payment
// states are read so the purchase can refuse a campaign that already carries an old-style hold or final charge: two
// money mechanisms on one campaign is never right.
export type CampaignPurchaseState = Pick<
  CampaignRow,
  'id' | 'event_id' | 'status' | 'package_price' | 'capture_status' | 'charge_status'
>;

// Service-role read; the caller (the purchase Route Handler) verifies ownership.
export async function getCampaignForPurchase(
  campaignId: string,
): Promise<CampaignPurchaseState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, package_price, capture_status, charge_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  return data;
}

// Atomically claim the hold slot. The guarded UPDATE only matches when there is
// no hold yet (null) or a prior attempt is retryable (hold_failed/hold_review),
// so two concurrent submits can never both place a hold (§13 anti-double-charge
// in spirit). Returns true only for the caller that won the slot.
export async function lockCampaignForHold(campaignId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .update({ capture_status: 'pending' })
    .eq('id', campaignId)
    .or('capture_status.is.null,capture_status.in.(hold_failed,hold_review)')
    .select('id')
    .maybeSingle();
  if (error) throw new Error('נעילת הקמפיין לחיוב נכשלה');
  return data !== null;
}

// Persist a successful hold. auth_amount is the server-derived hold amount (numeric),
// never client input. Card token + auth number are evidence for the later capture.
export async function recordCampaignHold(
  campaignId: string,
  hold: {
    authNumber: string;
    authAmount: number;
    // The reusable CreditCard_Token + its expiry + the holder CitizenID — all
    // REQUIRED at capture (SUMIT validates the token's expiry + CitizenID).
    cardToken: string | null;
    expMonth: number | null;
    expYear: number | null;
    citizenId: string | null;
    // SUMIT Customer.ExternalIdentifier — reconciliation anchor on the charge.
    authExternalRef: string;
    // The draft "Order" document SUMIT creates for this hold — traceable in the
    // SUMIT "תפיסות מסגרת" screen. Null if SUMIT omitted it (never blocks the hold).
    orderDocumentId: number | null;
    orderDocumentNumber: number | null; // human-readable ("הזמנה / 1002")
    orderDocumentUrl: string | null; // direct download link
    // SUMIT numeric Customer.ID — passed back at close-charge so it reuses the
    // SAME customer instead of creating a new one.
    sumitCustomerId: number | null;
  },
): Promise<void> {
  // Only reached behind the payments config gate.
  const admin = createAdminClient();
  const { error } = await admin
    .from('campaigns')
    .update({
      capture_status: 'authorized',
      auth_number: hold.authNumber,
      auth_amount: hold.authAmount,
      card_token_ref: hold.cardToken, // the saved card token, used at capture
      card_exp_month: hold.expMonth, // card expiry month — required at capture
      card_exp_year: hold.expYear, // card expiry year — required at capture
      card_citizen_id: hold.citizenId, // holder CitizenID — required at capture (PII)
      auth_external_ref: hold.authExternalRef, // reconciliation anchor
      hold_order_document_id: hold.orderDocumentId,
      hold_order_document_number: hold.orderDocumentNumber,
      hold_order_document_url: hold.orderDocumentUrl,
      sumit_customer_id: hold.sumitCustomerId,
      authorized_at: new Date().toISOString(),
    })
    .eq('id', campaignId);
  if (error) throw new Error('שמירת תפיסת המסגרת נכשלה');
}

// Release the lock to a retryable state after a failed/ambiguous hold. Never
// touches status — the agreement stays signed and the campaign stays approved.
export async function markCampaignHoldFailed(
  campaignId: string,
  status: 'hold_failed' | 'hold_review',
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('campaigns')
    .update({ capture_status: status })
    .eq('id', campaignId);
  if (error) throw new Error('עדכון מצב התפיסה נכשל');
}

// --- Authorized SET snapshot + hold sizing -----------------------------------
// The hold (J5 auth amount) is sized to the COVERED contacts, NOT the full
// ceiling. The authorized SET is snapshotted to the covered contacts at the hold,
// but it is the membership boundary for outreach + billing, not a cap on how many
// contacts may be reached: reconcile_authorized_set admits every later eligible
// guest (the funded cap was retired, see
// supabase/migrations/20260925003335_retire_funded_cap.sql). The hold is a card
// guarantee. See supabase/migrations/202606290024_billing_authorized_set.sql.

// Resolve the admin-managed hold-sizing knobs, each falling back FAIL-SAFE
// (toward the highest / safest hold): a missing global coverage falls back to
// `fullUnique` (covered = full → hold = ceiling), and missing per-package
// economics fall back to 0 (no artificial floor, no buffer). Reads go through the
// service-role client (app_settings + packages are admin-only under RLS).
async function getHoldSizingKnobs(
  templateId: string | null,
  fullUnique: number,
): Promise<{
  reasonableCoverage: number;
  minHoldFloor: number;
  holdBufferPct: number;
}> {
  const admin = createAdminClient();

  let reasonableCoverage = fullUnique; // fail-safe: never silently lower the hold
  try {
    const { data } = await admin
      .from('app_settings')
      .select('reasonable_coverage_contacts')
      .eq('id', true)
      .maybeSingle();
    const r = Number(data?.reasonable_coverage_contacts);
    if (Number.isFinite(r) && r > 0) reasonableCoverage = r;
  } catch {
    // keep the fail-safe default (covered = full → hold = ceiling)
  }

  let minHoldFloor = 0;
  let holdBufferPct = 0;
  if (templateId) {
    try {
      const { data } = await admin
        .from('packages')
        .select('min_hold_floor, hold_buffer_pct')
        .eq('id', templateId)
        .maybeSingle();
      const f = Number(data?.min_hold_floor);
      const b = Number(data?.hold_buffer_pct);
      if (Number.isFinite(f) && f >= 0) minHoldFloor = f;
      if (Number.isFinite(b) && b >= 0) holdBufferPct = b;
    } catch {
      // keep 0 / 0
    }
  }

  return { reasonableCoverage, minHoldFloor, holdBufferPct };
}

export type CampaignHoldSizing = {
  holdAmount: number; // J5 auth amount = max(floor, covered × price × (1+buffer))
  ceiling: number; // charge ceiling = full × price (caps the charge only under frozen-figure agreements, v4 and earlier)
  full: number; // current unique-contact count
  covered: number; // min(full, reasonable_coverage) — the set + hold basis
};

// Everything hold sizing depends on, read ONCE and shared by the read-only
// PREVIEW (payment page, before the card) and the real prepareCampaignHold
// (after the lock). One code path ⇒ the number the customer sees before
// entering a card is the number the route will hold, barring a guest-list
// change in between. Throws short, PII-free Hebrew strings.
async function loadHoldSizingInputs(campaignId: string): Promise<{
  eventId: string;
  price: number;
  base: number;
  included: number;
  full: number;
  covered: number;
  minHoldFloor: number;
  holdBufferPct: number;
}> {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('event_id, price_per_reached, template_id, base_price, included_reached')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) throw new Error('הקמפיין לא נמצא');

  const price = Number(campaign.price_per_reached);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('מחיר לאיש קשר אינו תקין');
  }
  // Base+overage snapshot frozen at create; 0/0 = pre-model campaign.
  const base = Number(campaign.base_price ?? 0);
  const included = Number(campaign.included_reached ?? 0);

  // full = the CURRENT unique-contact count (verifies ownership server-side).
  // May be 0 — same reasoning as createCampaign: the flat base fee prices a
  // 0-contact hold just fine. A legacy (base=0) campaign still can't place a
  // ₪0 hold — route.ts's own `holdAmount <= 0` check is the guard for that.
  const full = await countUniqueContactsForEvent(campaign.event_id);
  const { reasonableCoverage, minHoldFloor, holdBufferPct } =
    await getHoldSizingKnobs(campaign.template_id, full);
  const covered = computeCovered(full, reasonableCoverage);

  return {
    eventId: campaign.event_id,
    price,
    base,
    included,
    full,
    covered,
    minHoldFloor,
    holdBufferPct,
  };
}

// Read-only preview for the payment page (audit §6 — "סכום תפיסת המסגרת כעת").
// No snapshot, no write. The basis is `covered`; prepareCampaignHold uses
// max(covered, frozenSetSize), which equals covered on the happy path.
export async function previewCampaignHoldSizing(
  campaignId: string,
): Promise<CampaignHoldSizing> {
  const i = await loadHoldSizingInputs(campaignId);
  return {
    holdAmount: computeHoldAmountBaseOverage(
      i.base,
      i.included,
      i.price,
      i.covered,
      i.minHoldFloor,
      i.holdBufferPct,
    ),
    ceiling: computeCeilingBaseOverage(i.base, i.included, i.price, i.full),
    full: i.full,
    covered: i.covered,
  };
}

// Phase-2 hold preparation. Run at the J5 step AFTER the hold slot is locked and
// BEFORE the card hold is placed. In one coherent step it:
//   1. recomputes `full` = the CURRENT unique-contact count (the guest list may
//      have grown since create) and resolves the admin knobs,
//   2. SNAPSHOTS the authorized SET to the COVERED contacts (min(full, reasonable))
//      — reached ⊆ set by construction (outreach + billing are bound to set
//      membership); the set MUST exist before any billing, so this precedes the hold,
//   3. recomputes + persists max_contacts = full (NON-NULL — closes the nullable-
//      uncapped flag) and max_charge_ceiling = full × price (D1=No — closes the
//      create→approval growth gap; the ceiling is NEVER lowered to covered),
//   4. returns holdAmount = max(min_hold_floor, covered × price × (1 + buffer)).
// The hold may be < ceiling. The SET no longer caps reached (the funded cap was
// retired 2026-09-25); the hold is a card guarantee, not a billing bound.
// CROSS-AGENT CONTRACT: snapshotAuthorizedSet MUST yield set == the current
// top-`covered` contacts (REPLACE semantics), so a retry after the list / coverage
// shrinks cannot leave a stale, larger set above the lowered hold.
// NOTE: the set is no longer a hard freeze — reconcile_authorized_set admits every
// later eligible guest (no cap since 2026-09-25).
export async function prepareCampaignHold(
  campaignId: string,
): Promise<CampaignHoldSizing> {
  const admin = createAdminClient();
  const i = await loadHoldSizingInputs(campaignId);

  // Snapshot the authorized set BEFORE any billing — outreach and billing only
  // reach set members.
  // snapshotAuthorizedSet has REPLACE semantics (set == current top-`covered`
  // contacts; stale/orphan members pruned), and returns the RESULTING set size —
  // on the happy path == `covered`. We STILL size the hold to
  // max(covered, frozenSetSize) as belt-and-suspenders: the hold always covers the
  // actual snapshotted set even if they ever diverge.
  const frozenSetSize = await snapshotAuthorizedSet(i.eventId, campaignId, i.covered);
  const holdBasis = Math.max(i.covered, frozenSetSize);

  // Recompute + persist the ceiling and max_contacts (= full, NON-NULL) from the
  // CURRENT full count. Base+overage ceiling = base + max(0, full − included) ×
  // overage (with base/included 0 this is full × price — unchanged); never
  // lowered to covered, and always ≥ base so the flat fee is never capped away.
  const ceiling = computeCeilingBaseOverage(i.base, i.included, i.price, i.full);
  const { error: upErr } = await admin
    .from('campaigns')
    .update({ max_contacts: i.full, max_charge_ceiling: ceiling })
    .eq('id', campaignId);
  if (upErr) throw new Error('עדכון תקרת החיוב נכשל');

  const holdAmount = computeHoldAmountBaseOverage(
    i.base,
    i.included,
    i.price,
    holdBasis,
    i.minHoldFloor,
    i.holdBufferPct,
  );
  return { holdAmount, ceiling, full: i.full, covered: i.covered };
}

// --- B4 close-charge data layer ---------------------------------------------
// auth_external_ref is the SUMIT Customer.ExternalIdentifier persisted at the J5
// hold (recordCampaignHold); it is the ONLY anchor a later capture can reference
// (capture.ts). Only ever reached behind getCloseChargeEnabled() (false until
// enabled).

export type CampaignChargeState = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'status'
  | 'capture_status'
  | 'charge_status'
  | 'card_token_ref'
  | 'card_exp_month'
  | 'card_exp_year'
  | 'card_citizen_id'
  | 'auth_external_ref'
  | 'sumit_customer_id'
  // The J5 hold itself — close-charge captures it by AuthNumber when the
  // amount fits and the hold was not released.
  | 'auth_number'
  | 'auth_amount'
  | 'release_status'
  | 'max_charge_ceiling'
  // Flat-base + included + overage snapshot (populated at campaign creation).
  // price_per_reached is the per-reached overage rate.
  | 'base_price'
  | 'included_reached'
  | 'price_per_reached'
  // Fixed package price agreed at approval (NULL = a pay-per-result campaign). When set, the
  // campaign has no settlement: close-charge refuses it.
  | 'package_price'
>;

const CHARGE_COLUMNS =
  'id, event_id, status, capture_status, charge_status, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref, sumit_customer_id, auth_number, auth_amount, release_status, max_charge_ceiling, base_price, included_reached, price_per_reached, package_price';

// Read the charge-relevant fields. Service-role (the charge writes bypass RLS);
// the caller (the Route Handler) has already verified ownership.
export async function getCampaignForCharge(
  campaignId: string,
): Promise<CampaignChargeState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select(CHARGE_COLUMNS)
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  return data;
}

// Atomically claim the charge slot (idempotency for the final charge). Matches
// only when no charge yet (null) or a prior attempt is retryable
// (charge_failed/charge_review) — a 'charged' campaign can never be re-charged.
export async function lockCampaignForCharge(
  campaignId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .update({ charge_status: 'pending' })
    .eq('id', campaignId)
    .or('charge_status.is.null,charge_status.in.(charge_failed,charge_review)')
    .select('id')
    .maybeSingle();
  if (error) throw new Error('נעילת הקמפיין לחיוב הסופי נכשלה');
  return data !== null;
}

export async function recordCampaignCharge(
  campaignId: string,
  charge: {
    amount: number;
    creditApplied: number; // slice of min(accrued, ceiling) covered by credit
    documentId: number;
    documentNumber: number | null;
    documentUrl: string | null; // the receipt download link
    authNumber: string | null;
    paymentId: number | null;
  },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('campaigns')
    .update({
      charge_status: 'charged',
      final_charge_amount: charge.amount,
      credit_applied: charge.creditApplied,
      sumit_charge_document_id: charge.documentId,
      charge_document_number: charge.documentNumber,
      charge_document_url: charge.documentUrl,
      charge_auth_number: charge.authNumber,
      charge_payment_id: charge.paymentId,
      charged_at: new Date().toISOString(),
    })
    .eq('id', campaignId);
  if (error) throw new Error('שמירת החיוב הסופי נכשלה');
}

export async function markCampaignChargeOutcome(
  campaignId: string,
  outcome: 'charge_failed' | 'charge_review' | 'nothing_to_charge',
  creditApplied?: number,
): Promise<void> {
  const admin = createAdminClient();
  const payload: TablesUpdate<'campaigns'> = {
    charge_status: outcome,
  };
  if (outcome === 'nothing_to_charge') {
    payload.final_charge_amount = 0;
    payload.credit_applied = creditApplied ?? 0;
    payload.charged_at = new Date().toISOString();
  }
  // Guarded like lockCampaignForCharge: a terminal outcome (charged /
  // nothing_to_charge) can never be overwritten — a late re-invocation after a
  // real charge (e.g. a credit granted afterwards) must not zero the recorded
  // charge. Zero rows matched = benign no-op, not an error.
  const { error } = await admin
    .from('campaigns')
    .update(payload)
    .eq('id', campaignId)
    .or(
      'charge_status.is.null,charge_status.in.(pending,charge_failed,charge_review)',
    );
  if (error) throw new Error('עדכון מצב החיוב נכשל');
}

// --- Campaign lifecycle (B4 foundation; no money) ---------------------------
// Status transitions. The actual close-CHARGE (capturing the held card for the
// final reached-contact total) is intentionally NOT here — it depends on
// billed_results (B2) and is a separate, gated step.

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
  // 'by_model': the funding precondition depends on the campaign's pricing model — a confirmed card hold
  // (capture_status='authorized') for pay-per-result, a recorded payment (verified by preparePackage) for a package.
  funding?: 'by_model',
  // L1/R9: only forward transitions that BEGIN outreach/billing (activate)
  // reject a past event AND require an active event. pause/close must stay
  // allowed for a past/non-active event (cleanup + wind-down paths, per R9's
  // explicit carve-out — cancel/close/settle are not commercial-forward).
  opts?: {
    rejectPastEvent?: boolean;
    requireActiveEvent?: boolean;
    // Package campaigns only: the funding precondition (payment from the ledger, then the first fill). Runs after the
    // identity and event checks, before the status write.
    preparePackage?: (campaign: { id: string; event_id: string }) => Promise<void>;
  },
  // Returns the event's date so a caller (activateCampaign) can seed
  // auto-thankyou's default schedule without a second identity-checked fetch.
  actor: CampaignActor = { kind: 'owner' },
): Promise<{ eventDate: string | null }> {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id, package_price')
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

  const isPackage = campaign.package_price != null;
  if (funding === 'by_model' && isPackage) {
    await opts?.preparePackage?.({ id: campaign.id, event_id: campaign.event_id });
  }

  let query = admin
    .from('campaigns')
    .update({ status: to })
    .eq('id', campaignId)
    .in('status', from);
  if (funding === 'by_model') {
    query = isPackage
      ? query.not('package_price', 'is', null).is('capture_status', null).is('charge_status', null)
      : query.eq('capture_status', 'authorized');
  }
  const { data: updated, error: upErr } = await query
    .select('id')
    .maybeSingle();
  if (upErr) throw new Error('עדכון מצב הקמפיין נכשל');
  if (!updated) {
    throw new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי');
  }
  return { eventDate };
}

const TRANSITION_REFUSED_ERROR = 'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי';

// What a package campaign needs before it may start, in this order: the payment is recorded in the ledger (the only
// source of truth for package money), then the list every send reads is filled (D6: charged → filled → activated).
// Runs AFTER the ownership and event checks of the transition and BEFORE the status write, so a refused activation
// never leaves a half-filled list behind for a customer who is not allowed to start.
async function requirePackageFundingAndFill(campaignId: string, eventId: string): Promise<void> {
  let paid: boolean;
  try {
    paid = (await getPackagePaymentState(campaignId)).status === 'collected';
  } catch {
    console.error('[campaign-lifecycle] package payment state could not be read', { campaignId });
    throw new Error(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
  }
  if (!paid) throw new Error(PACKAGE_NOT_PAID_ERROR);

  const fill = await fillAuthorizedSet(eventId, campaignId, 'activation');
  if (fill.verdict === 'not_operational') throw new Error(TRANSITION_REFUSED_ERROR);
  if (fill.verdict !== 'filled') {
    console.error('[campaign-lifecycle] package list could not be filled', { campaignId, verdict: fill.verdict });
    throw new Error(PACKAGE_SUPPORT_ERROR);
  }
  // A campaign with nobody on its list would read "active" and approach no one. The customer has paid: tell them what
  // to do instead of activating into silence.
  if (fill.size === 0) throw new Error(PACKAGE_NO_CONTACTS_ERROR);
}

// Activate (begin outreach). Requires an approved/scheduled/paused campaign that
// already has a card hold (capture_status='authorized') — or, for a fixed-price package, a
// recorded payment — no outreach without a secured payment.
//
// `actor` narrows WHICH activations are reachable. An owner may activate from
// any pre-send status; a console agent may only REVIVE, i.e. `paused → active`.
//
// That asymmetry is the whole safety argument, and it lives HERE rather than in
// the route so a future caller cannot widen it: `paused` is reachable only from
// `active` (pauseCampaign is the sole writer of that status, and it accepts only
// `['active']`), so a paused campaign is PROOF the owner already activated it.
// Staff therefore restore a commitment the owner made; they can never create
// one. The funding (J5 hold or package payment) is likewise already present on
// anything that was live.
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
    'by_model',
    // L1: never begin outreach for a past event. R9: requires an active event.
    {
      rejectPastEvent: true,
      requireActiveEvent: true,
      preparePackage: (c) => requirePackageFundingAndFill(c.id, c.event_id),
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

// Close the campaign (no new outreach/billing after this). Computing the final
// charge and capturing the held card is a separate B4 step (needs billed_results).
// Wind-down: platform-admin only. NOT opened to the console — closing ends the
// campaign and leads into the close-charge flow, which stays owner/admin.
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
// event owner. The campaign is still loaded via getCampaignForHold because
// campaign.event_id feeds the success Slack alert below. campaignId is NEVER
// trusted from the browser to imply authorization.
export async function cancelCampaign(campaignId: string): Promise<void> {
  const campaign = await getCampaignForHold(campaignId);
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  await requirePlatformPermission('campaigns.runstate'); // redirects anyone else

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('cancel_campaign', {
    p_campaign: campaignId,
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
