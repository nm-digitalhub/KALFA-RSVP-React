import { normalizePhone } from '@/lib/phone';

// The guests → contacts derivation: normalize each guest's phone to E.164 and de-duplicate, so guests that share a
// phone share one contact (§2–3, §13). Pure — no I/O and no Next or Supabase import — so the request-bound builders in
// contacts.ts and the worker's link repair (authorized-topup.ts) both use it; the worker may not import anything that
// reaches next/headers (dependency-cruiser rule worker-no-request-scoped-next).

export type GuestPhone = { id: string; phone: string | null };

export type DerivedContacts = {
  guestToPhone: Map<string, string | null>; // guestId → E.164 | null (invalid/missing)
  uniquePhones: string[]; // distinct E.164 keys
  withValidPhone: number;
  invalid: number;
};

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
