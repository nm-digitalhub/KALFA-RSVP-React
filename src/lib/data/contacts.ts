import 'server-only';

import { requireEventAccess } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';
import { resolveSendableContacts } from '@/lib/data/sendable-contacts';
import type { Tables } from '@/lib/supabase/types';
// "Contacts" = unique reachable phones per event (§2–3). Built from the event's
// guests by normalizing to E.164 and de-duplicating; many guests may share one
// phone → one contact. Access is enforced (requireEventAccess); contact writes
// go through the service-role admin client (contacts have no client write policy
// under RLS).

type ContactRow = Tables<'contacts'>;
export type EventContact = Pick<
  ContactRow,
  'id' | 'normalized_phone' | 'op_status' | 'removal_requested'
>;

type GuestPhone = { id: string; phone: string | null };

export type DerivedContacts = {
  guestToPhone: Map<string, string | null>; // guestId → E.164 | null (invalid/missing)
  uniquePhones: string[]; // distinct E.164 keys
  withValidPhone: number;
  invalid: number;
};

// Pure dedup/normalization — no I/O, fully unit-testable. This is the core of
// the guests→contacts derivation; the DB wrapper below is thin around it.
export function deriveContacts(guests: GuestPhone[]): DerivedContacts {
  const guestToPhone = new Map<string, string | null>();
  const unique = new Set<string>();
  let withValidPhone = 0;
  let invalid = 0;

  for (const g of guests) {
    const e164 = normalizePhone(g.phone);
    guestToPhone.set(g.id, e164);
    if (e164) {
      withValidPhone++;
      unique.add(e164);
    } else {
      invalid++;
    }
  }

  return { guestToPhone, uniquePhones: [...unique], withValidPhone, invalid };
}

export type BuildContactsResult = {
  guests: number;
  withValidPhone: number;
  uniqueContacts: number;
  invalid: number;
  // Every unique contact id this call touched, so bulk-import callers (CSV/
  // WhatsApp) can reconcile each one into an event whose campaign is ALREADY
  // approved/scheduled/active/paused (best-effort, cheap no-op for
  // already-authorized/no-campaign events — see reconcileCampaignSetForContact).
  contactIds: string[];
};

// Build/refresh the contacts for an event from its guests, and link
// guests.contact_id. Idempotent: re-running upserts the same unique phones
// (UNIQUE event_id+normalized_phone) and re-links guests.
export async function buildContactsForEvent(
  eventId: string,
): Promise<BuildContactsResult> {
  await requireEventAccess(eventId, 'contacts', 'create');

  const supabase = await createClient();
  const { data: guests, error } = await supabase
    .from('guests')
    .select('id, phone')
    .eq('event_id', eventId)
    // Order of addition (guests.seq). Without it the rows come back in heap order, and a
    // bulk import inserts every guest in one statement (identical created_at), so the
    // contacts would be created — and, in the contact-quota model, seats handed out — in
    // an arbitrary order instead of the order the guests were added.
    .order('seq', { ascending: true });
  if (error) throw new Error('טעינת המוזמנים נכשלה');

  const derived = deriveContacts(guests ?? []);
  const admin = createAdminClient();

  // Upsert each unique phone → contact, capturing its id.
  const phoneToContactId = new Map<string, string>();
  for (const phone of derived.uniquePhones) {
    const { data: row, error: upErr } = await admin
      .from('contacts')
      .upsert(
        { event_id: eventId, normalized_phone: phone },
        { onConflict: 'event_id,normalized_phone' },
      )
      .select('id')
      .single();
    if (upErr || !row) throw new Error('יצירת אנשי הקשר נכשלה');
    phoneToContactId.set(phone, row.id);
  }

  // Link each guest to its contact (or null when the phone is invalid/missing).
  for (const [guestId, e164] of derived.guestToPhone) {
    const contactId = e164 ? (phoneToContactId.get(e164) ?? null) : null;
    const { error: linkErr } = await admin
      .from('guests')
      .update({ contact_id: contactId })
      .eq('id', guestId)
      .eq('event_id', eventId);
    if (linkErr) throw new Error('קישור המוזמנים לאנשי הקשר נכשל');
  }

  return {
    guests: guests?.length ?? 0,
    withValidPhone: derived.withValidPhone,
    uniqueContacts: derived.uniquePhones.length,
    invalid: derived.invalid,
    contactIds: [...phoneToContactId.values()],
  };
}

// Surgically (re)link ONE guest to its contact after a single create/update —
// O(1), versus buildContactsForEvent's whole-event rebuild. Upserts the guest's
// normalized phone into contacts (UNIQUE event_id+normalized_phone → idempotent,
// §13) and sets guests.contact_id (null when the phone is invalid/missing, so it
// is not billable, §4/§5.4). All writes are scoped by event_id. Verifies
// access server-side — this writes the billing source-of-truth via the
// service-role client (RLS-bypassing), so it must not rely on the caller alone.
export async function linkGuestContact(
  eventId: string,
  guestId: string,
  phone: string | null,
): Promise<{ contactId: string | null; prevContactId: string | null }> {
  await requireEventAccess(eventId, 'contacts', 'edit');
  const admin = createAdminClient();
  const e164 = normalizePhone(phone);

  // Capture the guest's CURRENT contact link first — if the phone change repoints
  // it, the previous contact may be left orphaned and must be pruned.
  const { data: cur } = await admin
    .from('guests')
    .select('contact_id')
    .eq('id', guestId)
    .eq('event_id', eventId)
    .maybeSingle();
  const prevContactId =
    (cur as { contact_id: string | null } | null)?.contact_id ?? null;

  let contactId: string | null = null;
  if (e164) {
    const { data: row, error: upErr } = await admin
      .from('contacts')
      .upsert(
        { event_id: eventId, normalized_phone: e164 },
        { onConflict: 'event_id,normalized_phone' },
      )
      .select('id')
      .single();
    if (upErr || !row) throw new Error('יצירת איש הקשר נכשלה');
    contactId = row.id;
  }

  const { error: linkErr } = await admin
    .from('guests')
    .update({ contact_id: contactId })
    .eq('id', guestId)
    .eq('event_id', eventId);
  if (linkErr) throw new Error('עדכון קישור איש הקשר נכשל');

  // Phone changed away from a previous contact → prune it if now orphaned.
  if (prevContactId && prevContactId !== contactId) {
    await pruneOrphanContact(eventId, prevContactId);
  }

  // Return the link delta so the caller can reconcile the campaign authorized
  // set (P0-1 A6).
  return { contactId, prevContactId };
}

// Prune a contact that is no longer referenced by ANY current guest of the event
// (a billing-integrity hygiene step — an orphaned contact would otherwise stay
// reachable + billable; the root bound is the Phase-2 frozen set). SAFE by design:
// it deletes ONLY a contact with (a) zero current guest references AND (b) no
// billing/outreach history (billed_results + contact_interactions), so it never
// drops an audit trail or violates a FK. Returns true iff a row was deleted.
// Admin client: contacts have no client write policy under RLS. Caller must have
// verified event ownership.
export async function pruneOrphanContact(
  eventId: string,
  contactId: string,
): Promise<boolean> {
  const admin = createAdminClient();

  // Still referenced by a current guest? keep.
  const { count: refs } = await admin
    .from('guests')
    .select('contact_id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('contact_id', contactId);
  if ((refs ?? 0) > 0) return false;

  // Has any billing or outreach history? keep for audit.
  const { count: billed } = await admin
    .from('billed_results')
    .select('contact_id', { count: 'exact', head: true })
    .eq('contact_id', contactId);
  if ((billed ?? 0) > 0) return false;

  const { count: interactions } = await admin
    .from('contact_interactions')
    .select('contact_id', { count: 'exact', head: true })
    .eq('contact_id', contactId);
  if ((interactions ?? 0) > 0) return false;

  // P0-1 (A6): a member of a campaign's frozen authorized set must never be
  // hard-deleted here — the FK's ON DELETE would silently evict it from the set
  // (the root of the repoint/orphan mis-charge bug). Kill-switch gated — LIVE
  // in production since 2026-07-21 (see reconcile-config.ts), so this guard is
  // ACTIVE. reconcile_authorized_set is the ONLY path that removes a contact
  // from the set.
  if (isReconcileEnabled()) {
    const { count: setMember } = await admin
      .from('campaign_authorized_contacts')
      .select('contact_id', { count: 'exact', head: true })
      .eq('contact_id', contactId);
    if ((setMember ?? 0) > 0) return false;
  }

  // Truly orphaned + history-free → safe to delete.
  const { error } = await admin
    .from('contacts')
    .delete()
    .eq('id', contactId)
    .eq('event_id', eventId);
  if (error) throw new Error('מחיקת איש קשר יתום נכשלה');
  return true;
}

// P0-1 (A6): reconcile a campaign's authorized recipient SET after a guest
// mutation (add / repoint / delete of a contact). Delegates the money-safe
// decision (admit every eligible contact — no size cap other than a campaign's
// contact_quota —, exposed-or-billed pin, audit) to the
// reconcile_authorized_set RPC, which runs under the same campaigns FOR UPDATE
// lock as billing. KILL-SWITCH: inert unless RECONCILE_AUTHORIZED_SET_ENABLED
// (env var, not app_settings — see reconcile-config.ts) — LIVE in production
// since 2026-07-21, so this path is ACTIVE, not the inert default. Best-effort
// (the guest mutation is already committed): errors and not_eligible are
// logged (no PII), never thrown. Callers must have already
// verified event access (this is an internal service-role helper, like
// pruneOrphanContact).
export async function reconcileCampaignSetForContact(
  eventId: string,
  op: 'add' | 'repoint' | 'delete',
  contactId: string,
  prevContactId?: string | null,
): Promise<void> {
  if (!isReconcileEnabled()) return;
  const admin = createAdminClient();

  // Resolve the operational campaign(s) for this event. The app invariant is one
  // per event, but the schema does not enforce it — iterate defensively.
  const { data: campaigns, error: campErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('event_id', eventId)
    .in('status', ['approved', 'scheduled', 'active', 'paused']);
  if (campErr || !campaigns || campaigns.length === 0) return;

  for (const c of campaigns) {
    const { data: outcome, error } = await admin.rpc('reconcile_authorized_set', {
      p_event: eventId,
      p_campaign: c.id,
      p_op: op,
      p_contact: contactId,
      p_prev_contact: prevContactId ?? undefined,
    });
    if (error) {
      console.error(
        `[reconcile] rpc failed (event=${eventId} campaign=${c.id} op=${op}): ${error.message}`,
      );
    } else if (outcome === 'not_eligible' || outcome === 'quota_full') {
      // Surfaced, not silent. not_eligible: the contact was ineligible (foreign/
      // opted-out/no live guest). quota_full: the campaign has a package quota
      // (campaigns.contact_quota) and its list is full, so the guest WAITS instead
      // of being admitted (plan 2026-09-30-contact-quota-package.md §4.3.1); an
      // upgrade admits him later. A campaign without a quota has no size cap on
      // the set: billing is bounded by contacts actually reached.
      console.warn(
        `[reconcile] ${outcome} (event=${eventId} campaign=${c.id} op=${op})`,
      );
    }
  }
}

// Size of the campaign's authorized set — "how many contacts the campaign will
// actually reach out to". Service-role read; callers must have passed their own
// access gate first (the manage page does). Used for the empty state and the
// "not included" banner.
export async function countAuthorizedContacts(campaignId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('campaign_authorized_contacts')
    .select('contact_id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);
  if (error) throw new Error('טעינת מונה אנשי הקשר בקמפיין נכשלה');
  return count ?? 0;
}

// Count of unique reachable contacts for an event, derived from the current
// guest list (dedup by E.164). This is a DATA fact — it drives max_contacts and
// the ceiling (§7), and is never entered by the owner. Verifies ownership
// server-side: it derives a billing input via the RLS-bypassing service-role
// client, so it must not rely on the caller alone.
export async function countUniqueContactsForEvent(
  eventId: string,
): Promise<number> {
  await requireEventAccess(eventId, 'contacts', 'view');
  const admin = createAdminClient();
  const { data: guests, error } = await admin
    .from('guests')
    .select('id, phone')
    .eq('event_id', eventId);
  if (error) throw new Error('טעינת המוזמנים נכשלה');
  return deriveContacts(guests ?? []).uniquePhones.length;
}

// Read-only list of an event's contacts (org-aware via RLS + the gate).
export async function listContacts(eventId: string): Promise<EventContact[]> {
  await requireEventAccess(eventId, 'contacts', 'view');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contacts')
    .select('id, normalized_phone, op_status, removal_requested')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('טעינת אנשי הקשר נכשלה');
  return data ?? [];
}

// --- Outreach (B3) consent + send-eligibility -------------------------------
// These run only behind getOutreachEnabled() (false until outreach is enabled).

// Record channel-specific WhatsApp consent for one contact (caller authorized).
export async function recordWhatsAppConsent(
  eventId: string,
  contactId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('contacts')
    .update({ whatsapp_consent_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('event_id', eventId);
  if (error) throw new Error('שמירת ההסכמה לוואטסאפ נכשלה');
}

// Record channel-specific CALL consent for one contact (caller authorized). The
// twin of recordWhatsAppConsent for the Voximplant AI-call channel (B1): a single
// non-null timestamp IS the consent record. Service-role write — `contacts` has
// only a SELECT RLS policy (contacts_org_select), so owners cannot
// UPDATE it under RLS; callers MUST verify event access server-side first (the UI
// action does requireEventAccess; the public-RSVP path stamps it inside the
// token-bound submit_rsvp DEFINER RPC). Scoped by BOTH id AND event_id — consent
// is per (event, contact) and never portable across events. Does NOT clear
// removal_requested or touch the DNC list (independent suppressors).
export async function recordCallConsent(
  eventId: string,
  contactId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('contacts')
    .update({ call_consent_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('event_id', eventId);
  if (error) throw new Error('שמירת ההסכמה לשיחה נכשלה');
}

// Contacts eligible for a WhatsApp send: not removal-requested AND, unless an admin
// lifted app_settings.whatsapp_consent_required, with recorded WhatsApp consent.
// When a campaignId is given, membership is ADDITIONALLY bound
// to that campaign's authorized set (campaign_authorized_contacts) via an
// INNER JOIN — so the outreach path can never target a contact outside the set:
// reached ⊆ authorized BY CONSTRUCTION (the Phase-2 money-leak guard, §7/0024).
// (Already-reached contacts are excluded by the outreach engine's gate, not here.)
export async function listSendableContacts(
  eventId: string,
  campaignId?: string,
): Promise<Array<{ id: string; normalized_phone: string }>> {
  await requireEventAccess(eventId, 'contacts', 'view');
  // Request-free core lives in its own module (@/lib/data/sendable-contacts) so
  // the worker send path can import it WITHOUT dragging events.ts → auth/dal →
  // next/headers into the worker bundle; this UI wrapper adds only the gate.
  return resolveSendableContacts(eventId, campaignId);
}
