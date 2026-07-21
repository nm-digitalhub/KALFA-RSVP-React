import 'server-only';

import { requireUser, requireAdmin } from '@/lib/auth/dal';
import { requireOwnedEvent, requireEventAccess } from '@/lib/data/events';
import { assertEventNotPast, defaultThankyouSendAt } from '@/lib/data/event-date';
import {
  countUniqueContactsForEvent,
  snapshotAuthorizedSet,
} from '@/lib/data/contacts';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';
import type { Database, Json } from '@/lib/supabase/types';

// Campaign = "campaign approval for an event" (outcome-billing). Owner sets the
// commercial terms; the charge ceiling is computed server-side. Reads are
// owner-scoped via RLS (owns_event); writes go through the service-role admin
// client after an explicit ownership check (no client-side billing writes, §18).

type CampaignRow = Database['public']['Tables']['campaigns']['Row'];
type Channel = Database['public']['Enums']['campaign_channel'];

export type OwnerCampaign = Pick<
  CampaignRow,
  | 'id'
  | 'event_id'
  | 'status'
  | 'price_per_reached'
  | 'max_contacts'
  | 'max_charge_ceiling'
  | 'allowed_channels'
  | 'start_at'
  | 'close_at'
  | 'approved_at'
  | 'final_charge_amount'
  | 'credit_applied'
  | 'capture_status'
  | 'created_at'
>;

const CAMPAIGN_COLUMNS =
  'id, event_id, status, price_per_reached, max_contacts, max_charge_ceiling, allowed_channels, start_at, close_at, approved_at, final_charge_amount, credit_applied, capture_status, created_at';

// Pure: the approved charge ceiling = price-per-reached × max contacts, rounded
// to agorot. The ceiling is the maximum the system may ever bill (§7); it is
// derived server-side and never accepted from the client.
export function computeCeiling(pricePerReached: number, maxContacts: number): number {
  return Math.round(pricePerReached * maxContacts * 100) / 100;
}

// Pure: the COVERED contact count = min(full_unique, reasonable_coverage). It is
// the binding cap the frozen authorized SET is snapshotted to (Phase 2) and the
// basis for the J5 hold. The CHARGE CEILING (full×price) is NOT lowered to this.
export function computeCovered(
  fullUnique: number,
  reasonableCoverage: number,
): number {
  return Math.max(0, Math.min(fullUnique, reasonableCoverage));
}

// Pure: the J5 hold (authorization) amount = covered × price × (1 + buffer),
// rounded to agorot, but never below the package's min_hold_floor. The hold is
// SECURITY only and is sized to `covered` (NOT the full ceiling) — safe ONLY
// because the frozen authorized SET caps `reached` at `covered` by construction
// (the Phase-2 money-leak guard). `holdBufferPct` is a FRACTION, not a percent
// number (0.1 = +10%); it stays 0 while pricing is uniform. The floor never
// raises the final charge — that settles from contacts actually reached (≤ ceiling).
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
  description: string | null;
  channels: Channel[];
  outreach_schedule: OutreachTouchpoint[];
};

export async function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('packages')
    .select('id, name, price_per_reached, description, channels, outreach_schedule')
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
      description: p.description,
      channels: p.channels ?? [],
      outreach_schedule:
        (p.outreach_schedule as OutreachTouchpoint[] | null) ?? [],
    }));
}

// Create-or-continue the event's SINGLE "RSVP confirmations" campaign in
// `pending_approval`. Idempotent: if a non-cancelled campaign already exists for
// the event it is returned unchanged (one campaign per event — entered via the
// "הפעלת אישורי הגעה" CTA, never a repeatable "new campaign"). Price, channels
// and the outreach schedule are copied+locked from the CANONICAL template
// (§17/§18.7) — the owner chooses nothing. The activity window is derived from
// the event date: outreach closes at the event; the post-event charge is a
// separate settle step.
export async function createCampaign(eventId: string): Promise<{ id: string }> {
  const event = await requireOwnedEvent(eventId);
  // L1: block the entry point — never create OR continue a campaign for an event
  // whose day has already passed (the downstream sign/activate/hold guards would
  // block it anyway; this stops the flow before it starts).
  assertEventNotPast(event.event_date);
  // R9: every commercial campaign action requires event.status='active'. App
  // defense-in-depth — the DB trigger (campaigns_require_active_event) is the
  // REST-proof authority.
  if (event.status !== 'active') {
    throw new Error('יש לפרסם את האירוע לפני אישורי הגעה');
  }

  // Celebrants gate: the outreach sends bind the celebrant names (בעלי השמחה)
  // into the message templates, so they must be COMPLETE for the event's type
  // before RSVP confirmations are enabled. The gate sits BEFORE the
  // create-or-continue early return on purpose — the sends depend on these
  // values, so CONTINUING an existing campaign without them must be blocked
  // exactly like creating a new one. requireOwnedEvent's slim column set does
  // not carry these two fields; this owner-scoped (RLS) read fetches just them.
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
  const maxContacts = await countUniqueContactsForEvent(eventId);
  if (maxContacts < 1) {
    throw new Error('אין אנשי קשר תקינים ברשימת המוזמנים — הוסיפו מוזמנים עם מספר טלפון תקין');
  }

  // The single active commercial template (the owner does not choose).
  const template = await resolveCanonicalTemplate();
  if (template.channels.length === 0) {
    throw new Error('למסלול השירות לא הוגדרו ערוצי פנייה');
  }
  const price = template.price_per_reached;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .insert({
      event_id: eventId,
      status: 'pending_approval',
      template_id: template.id,
      price_per_reached: price, // locked copy from the canonical template
      max_contacts: maxContacts, // derived from the unique-contact count (§7)
      max_charge_ceiling: computeCeiling(price, maxContacts),
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
// campaign replace a retired one. Owner-scoped via RLS (owns_event).
// NOTE: "one non-cancelled campaign per event" is an APP-LEVEL invariant only —
// upheld by createCampaign's create-or-continue early return (a check-then-insert
// using this function). There is NO DB backstop: no partial UNIQUE on event_id
// exists (verified — only campaigns_pkey on id), so two non-cancelled rows are
// not structurally prevented (e.g. a concurrent createCampaign race). Tracked as
// a follow-up in docs/event-edit-policy-live-campaign-2026-07-07.md.
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
    .select('id, event_id, status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }

  const event = await requireOwnedEvent(campaign.event_id); // ownership
  assertEventNotPast(event.event_date); // L1: no approval for a past event
  // R9: every commercial campaign action requires event.status='active'.
  if (event.status !== 'active') {
    throw new Error('יש לפרסם את האירוע לפני אישורי הגעה');
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
  'id' | 'event_id' | 'status' | 'max_charge_ceiling' | 'capture_status'
>;

// Read the hold-relevant fields. Service-role (the hold writes bypass RLS); the
// caller (the Route Handler) has already verified ownership.
export async function getCampaignForHold(
  campaignId: string,
): Promise<CampaignHoldState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, status, max_charge_ceiling, capture_status')
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

// Persist a successful hold. auth_amount is the server-derived ceiling (numeric),
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

// --- Phase 2: frozen authorized SET + hold sizing (the money-leak guard) ------
// The hold (J5 auth amount) is sized to the COVERED contacts, NOT the full
// ceiling — this is safe ONLY because the snapshotted authorized SET is the
// binding cap on `reached` (sole outreach + billing path), so reached ⊆ covered
// by construction. See supabase/migrations/202606290024_billing_authorized_set.sql
// and plans/verification-corrections.md §A (SAFETY INVARIANT).

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
  ceiling: number; // charge ceiling = full × price (the binding max on the charge)
  full: number; // current unique-contact count
  covered: number; // min(full, reasonable_coverage) — the set + hold basis
};

// Phase-2 hold preparation. Run at the J5 step AFTER the hold slot is locked and
// BEFORE the card hold is placed. In one coherent step it:
//   1. recomputes `full` = the CURRENT unique-contact count (the guest list may
//      have grown since create) and resolves the admin knobs,
//   2. FREEZES the authorized SET to the COVERED contacts (min(full, reasonable))
//      — reached ⊆ set by construction (the money-leak guard); the set MUST exist
//      before any billing, so this precedes the hold,
//   3. recomputes + persists max_contacts = full (NON-NULL — closes the nullable-
//      uncapped flag) and max_charge_ceiling = full × price (D1=No — closes the
//      create→approval growth gap; the ceiling is NEVER lowered to covered),
//   4. returns holdAmount = max(min_hold_floor, covered × price × (1 + buffer)).
// The hold may be < ceiling — safe ONLY because the SET caps reached at covered.
// CROSS-AGENT CONTRACT: snapshotAuthorizedSet MUST yield set == the current
// top-`covered` contacts (REPLACE semantics), so a retry after the list / coverage
// shrinks cannot leave a stale, larger set above the lowered hold.
export async function prepareCampaignHold(
  campaignId: string,
): Promise<CampaignHoldSizing> {
  const admin = createAdminClient();

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('event_id, price_per_reached, template_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) throw new Error('הקמפיין לא נמצא');

  const price = Number(campaign.price_per_reached);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('מחיר לאיש קשר אינו תקין');
  }

  // full = the CURRENT unique-contact count (verifies ownership server-side).
  const full = await countUniqueContactsForEvent(campaign.event_id);
  if (full < 1) throw new Error('אין אנשי קשר תקינים לפניה');

  const { reasonableCoverage, minHoldFloor, holdBufferPct } =
    await getHoldSizingKnobs(campaign.template_id, full);
  const covered = computeCovered(full, reasonableCoverage);

  // FREEZE the authorized set BEFORE any billing — the binding cap on `reached`.
  // snapshotAuthorizedSet has REPLACE semantics (set == current top-`covered`
  // contacts; stale/orphan members pruned), and returns the RESULTING set size —
  // on the happy path == `covered`. We STILL size the hold to
  // max(covered, frozenSetSize) as belt-and-suspenders: the hold always covers the
  // actual frozen set even if they ever diverge. reached ⊆ set ⇒
  // charge ≤ frozenSetSize × price ≤ hold — the SAFETY INVARIANT holds.
  const frozenSetSize = await snapshotAuthorizedSet(
    campaign.event_id,
    campaignId,
    covered,
  );
  const holdBasis = Math.max(covered, frozenSetSize);

  // Recompute + persist the ceiling (full × price) and max_contacts (= full,
  // NON-NULL). The ceiling stays full × price; it is never lowered to covered.
  const ceiling = computeCeiling(price, full);
  const { error: upErr } = await admin
    .from('campaigns')
    .update({ max_contacts: full, max_charge_ceiling: ceiling })
    .eq('id', campaignId);
  if (upErr) throw new Error('עדכון תקרת החיוב נכשל');

  const holdAmount = computeHoldAmount(
    holdBasis,
    price,
    minHoldFloor,
    holdBufferPct,
  );
  return { holdAmount, ceiling, full, covered };
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
  | 'max_charge_ceiling'
>;

const CHARGE_COLUMNS =
  'id, event_id, status, capture_status, charge_status, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref, max_charge_ceiling';

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
  const payload: Database['public']['Tables']['campaigns']['Update'] = {
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

export type CampaignStatus = Database['public']['Enums']['campaign_status'];

// Race-safe guarded transition: the UPDATE only matches a row in one of `from`
// (plus any extra column guard), so concurrent calls can't double-transition.
// Ownership is verified first. Throws if no row matched its current state.
async function transitionCampaignStatus(
  campaignId: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  extraGuard?: { column: 'capture_status'; value: string },
  // L1/R9: only forward transitions that BEGIN outreach/billing (activate)
  // reject a past event AND require an active event. pause/close must stay
  // allowed for a past/non-active event (cleanup + wind-down paths, per R9's
  // explicit carve-out — cancel/close/settle are not commercial-forward).
  opts?: { rejectPastEvent?: boolean; requireActiveEvent?: boolean },
  // Returns the event's date so a caller (activateCampaign) can seed
  // auto-thankyou's default schedule without a second ownership-checked fetch.
  // authz: 'owner' (default) enforces event ownership + the past/active checks.
  // 'admin' restricts the transition to platform admins (wind-down ops: pause/
  // close) with NO ownership and NO past/active gating — eventDate is then null.
  // 'console' is the staff agent-console path: the caller (a console Route
  // Handler) has ALREADY verified requireConsoleAgent + manage_voice, so there is
  // no ownership check (staff acts across events), but the SAME past/active-event
  // gating as 'owner' is kept for commercial-forward moves (activate).
  authz: 'owner' | 'admin' | 'console' = 'owner',
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
  let eventDate: string | null;
  if (authz === 'admin') {
    // Platform-admin-only wind-down: no ownership, no past/active gating.
    await requireAdmin();
    eventDate = null;
  } else if (authz === 'console') {
    // Staff console: authorization already done at the route boundary. Fetch the
    // event with the service-role client (staff sees all) and apply the same
    // past/active gating as the owner path.
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('event_date, status')
      .eq('id', campaign.event_id)
      .maybeSingle();
    if (evErr || !event) throw new Error('טעינת האירוע נכשלה');
    if (opts?.rejectPastEvent) assertEventNotPast(event.event_date);
    if (opts?.requireActiveEvent && event.status !== 'active') {
      throw new Error('יש לפרסם את האירוע לפני אישורי הגעה');
    }
    eventDate = event.event_date;
  } else {
    const event = await requireOwnedEvent(campaign.event_id);
    if (opts?.rejectPastEvent) assertEventNotPast(event.event_date);
    if (opts?.requireActiveEvent && event.status !== 'active') {
      throw new Error('יש לפרסם את האירוע לפני אישורי הגעה');
    }
    eventDate = event.event_date;
  }

  let query = admin
    .from('campaigns')
    .update({ status: to })
    .eq('id', campaignId)
    .in('status', from);
  if (extraGuard) {
    query = query.eq(extraGuard.column, extraGuard.value);
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

// Activate (begin outreach). Requires an approved/scheduled/paused campaign that
// already has a card hold (capture_status='authorized') — no outreach without a
// secured payment method.
export async function activateCampaign(
  campaignId: string,
  authz: 'owner' | 'console' = 'owner',
): Promise<void> {
  const { eventDate } = await transitionCampaignStatus(
    campaignId,
    ['approved', 'scheduled', 'paused'],
    'active',
    { column: 'capture_status', value: 'authorized' },
    // L1: never begin outreach for a past event. R9: requires an active event.
    { rejectPastEvent: true, requireActiveEvent: true },
    authz,
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

  // Auto-thankyou (§4 auto-thankyou-post-event plan): seed the default
  // schedule ONLY the first time this campaign activates — `.is(...null)`
  // guards a re-activation after pause from clobbering an owner-edited
  // send time. A null/unparseable event_date leaves it unset (the owner can
  // still set one manually; the sweep simply never picks up a null).
  const seeded = defaultThankyouSendAt(eventDate);
  if (seeded) {
    const admin = createAdminClient();
    // thankyou_send_at lands with supabase/migrations/20260712205030_auto_
    // thankyou_schema.sql — forward-compat cast until `gen types` runs.
    await admin
      .from('campaigns')
      .update({ thankyou_send_at: seeded } as unknown as Database['public']['Tables']['campaigns']['Update'])
      .eq('id', campaignId)
      .is('thankyou_send_at', null);
  }
}

// Wind-down: platform-admin only (see transitionCampaignStatus authz='admin').
export async function pauseCampaign(
  campaignId: string,
  authz: 'admin' | 'console' = 'admin',
): Promise<void> {
  await transitionCampaignStatus(
    campaignId,
    ['active'],
    'paused',
    undefined,
    undefined,
    authz,
  );
}

// --- Auto-thankyou owner controls -------------------------------------------
// thankyou_auto_enabled / thankyou_send_at / thankyou_sent_at land with
// supabase/migrations/20260712205030_auto_thankyou_schema.sql — forward-compat
// select('*') + runtime narrowing until `gen types` runs (same stance as the
// gift columns in outreach.ts). The sweep itself (src/lib/data/auto-thankyou.ts)
// reads these via its own admin-scoped query; these are the OWNER-FACING
// read/write, RLS-scoped like the rest of this file's getters/setters.

export type ThankyouSchedule = {
  autoEnabled: boolean;
  sendAt: string | null;
  sentAt: string | null;
};

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

// Owner edits the opt-in flag and/or the scheduled time. Blocked once
// thankyou_sent_at is set — the plan's "cancel window" is explicitly BEFORE
// the sweep/manual send fires, not after (nothing to cancel once it's out).
export async function updateThankyouSchedule(
  campaignId: string,
  patch: { autoEnabled?: boolean; sendAt?: string | null },
): Promise<void> {
  const supabase = await createClient();
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('id, event_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  await requireOwnedEvent(campaign.event_id); // ownership, defense-in-depth beyond RLS

  const update: Record<string, unknown> = {};
  if (patch.autoEnabled !== undefined) update.thankyou_auto_enabled = patch.autoEnabled;
  if (patch.sendAt !== undefined) update.thankyou_send_at = patch.sendAt;
  if (Object.keys(update).length === 0) return;

  const admin = createAdminClient();
  const { data: updated, error: upErr } = await admin
    .from('campaigns')
    .update(update as unknown as Database['public']['Tables']['campaigns']['Update'])
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
// Wind-down: platform-admin only (see transitionCampaignStatus authz='admin').
export async function closeCampaign(campaignId: string): Promise<void> {
  await transitionCampaignStatus(
    campaignId,
    ['active', 'paused', 'approved', 'scheduled'],
    'closed',
    undefined,
    undefined,
    'admin',
  );
}

// R8 — cancel a campaign with no financial commitment (draft/pending_approval/
// approved → cancelled). Explicit authorization contract (round-3): the RPC
// itself is service_role-only with NO caller-identity check, so authorization is
// entirely this function's job, BEFORE the RPC is ever called. Cancel is a
// wind-down operation restricted to PLATFORM ADMINS (requireAdmin) — not the
// event owner. The campaign is still loaded via getCampaignForHold because
// campaign.event_id feeds the success Slack alert below. campaignId is NEVER
// trusted from the browser to imply authorization.
export async function cancelCampaign(campaignId: string): Promise<void> {
  const campaign = await getCampaignForHold(campaignId);
  if (!campaign) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  await requireAdmin(); // platform-admin only; redirects non-admins

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
