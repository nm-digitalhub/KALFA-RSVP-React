import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/phone';
import type { Database } from '@/lib/supabase/types';

// "Contacts" = unique reachable phones per event (§2–3). Built from the event's
// guests by normalizing to E.164 and de-duplicating; many guests may share one
// phone → one contact. Ownership is enforced (requireOwnedEvent); contact writes
// go through the service-role admin client (contacts are admin-write under RLS).

type ContactRow = Database['public']['Tables']['contacts']['Row'];
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
};

// Build/refresh the contacts for an event from its guests, and link
// guests.contact_id. Idempotent: re-running upserts the same unique phones
// (UNIQUE event_id+normalized_phone) and re-links guests.
export async function buildContactsForEvent(
  eventId: string,
): Promise<BuildContactsResult> {
  await requireOwnedEvent(eventId);

  const supabase = await createClient();
  const { data: guests, error } = await supabase
    .from('guests')
    .select('id, phone')
    .eq('event_id', eventId);
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
  };
}

// Surgically (re)link ONE guest to its contact after a single create/update —
// O(1), versus buildContactsForEvent's whole-event rebuild. Upserts the guest's
// normalized phone into contacts (UNIQUE event_id+normalized_phone → idempotent,
// §13) and sets guests.contact_id (null when the phone is invalid/missing, so it
// is not billable, §4/§5.4). All writes are scoped by event_id. Verifies
// ownership server-side — this writes the billing source-of-truth via the
// service-role client (RLS-bypassing), so it must not rely on the caller alone.
export async function linkGuestContact(
  eventId: string,
  guestId: string,
  phone: string | null,
): Promise<void> {
  await requireOwnedEvent(eventId);
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
}

// Prune a contact that is no longer referenced by ANY current guest of the event
// (a billing-integrity hygiene step — an orphaned contact would otherwise stay
// reachable + billable; the root bound is the Phase-2 frozen set). SAFE by design:
// it deletes ONLY a contact with (a) zero current guest references AND (b) no
// billing/outreach history (billed_results + contact_interactions), so it never
// drops an audit trail or violates a FK. Returns true iff a row was deleted.
// Admin client: contacts are admin-write under RLS. Caller must have verified
// event ownership.
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

  // Truly orphaned + history-free → safe to delete.
  const { error } = await admin
    .from('contacts')
    .delete()
    .eq('id', contactId)
    .eq('event_id', eventId);
  if (error) throw new Error('מחיקת איש קשר יתום נכשלה');
  return true;
}

// Count of unique reachable contacts for an event, derived from the current
// guest list (dedup by E.164). This is a DATA fact — it drives max_contacts and
// the ceiling (§7), and is never entered by the owner. Verifies ownership
// server-side: it derives a billing input via the RLS-bypassing service-role
// client, so it must not rely on the caller alone.
export async function countUniqueContactsForEvent(
  eventId: string,
): Promise<number> {
  await requireOwnedEvent(eventId);
  const admin = createAdminClient();
  const { data: guests, error } = await admin
    .from('guests')
    .select('id, phone')
    .eq('event_id', eventId);
  if (error) throw new Error('טעינת המוזמנים נכשלה');
  return deriveContacts(guests ?? []).uniquePhones.length;
}

// Read-only list of an event's contacts (owner-scoped via RLS).
export async function listContacts(eventId: string): Promise<EventContact[]> {
  await requireOwnedEvent(eventId);

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
// whatsapp_consent_at is added by a pending migration and not in the generated
// types yet → cast to the un-generic client. These run only behind
// getOutreachEnabled() (false until the migration is applied), so they never hit
// a missing column at runtime.

// Record channel-specific WhatsApp consent for one contact (caller authorized).
export async function recordWhatsAppConsent(
  eventId: string,
  contactId: string,
): Promise<void> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin
    .from('contacts')
    .update({ whatsapp_consent_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('event_id', eventId);
  if (error) throw new Error('שמירת ההסכמה לוואטסאפ נכשלה');
}

// Contacts eligible for a WhatsApp send: not removal-requested AND with recorded
// WhatsApp consent. (Excluding already-reached contacts is added with B2, which
// sets the reached op_status / billed_results.)
export async function listSendableContacts(
  eventId: string,
): Promise<Array<{ id: string; normalized_phone: string }>> {
  await requireOwnedEvent(eventId);
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from('contacts')
    .select('id, normalized_phone')
    .eq('event_id', eventId)
    .eq('removal_requested', false)
    .not('whatsapp_consent_at', 'is', null);
  if (error) throw new Error('טעינת אנשי הקשר לשליחה נכשלה');
  return (data ?? []) as Array<{ id: string; normalized_phone: string }>;
}
