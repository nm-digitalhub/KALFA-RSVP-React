import 'server-only';

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
    await admin
      .from('guests')
      .update({ contact_id: contactId })
      .eq('id', guestId)
      .eq('event_id', eventId);
  }

  return {
    guests: guests?.length ?? 0,
    withValidPhone: derived.withValidPhone,
    uniqueContacts: derived.uniquePhones.length,
    invalid: derived.invalid,
  };
}

// Count of unique reachable contacts for an event, derived from the current
// guest list (dedup by E.164). This is a DATA fact — it drives max_contacts and
// the ceiling (§7), and is never entered by the owner. Caller must have already
// verified ownership.
export async function countUniqueContactsForEvent(
  eventId: string,
): Promise<number> {
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
