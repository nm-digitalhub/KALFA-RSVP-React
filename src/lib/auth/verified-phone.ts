import 'server-only';

import type { User } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/phone';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

// The phone number a user has PROVED, read from Supabase Auth — the only place
// it is recorded. Auth sets auth.users.phone and phone_confirmed_at when a
// `phone_change` OTP is verified (settings/actions.ts), and keeps a pending,
// unproved number in phone_change instead, so `phone` with a non-null
// phone_confirmed_at is a proved number. A user cannot write auth.users
// through the Data API, unlike public.profiles (own_profile_write covers every
// column of the row).
//
// Auth stores the number as bare digits ("972501234567", measured on the live
// project 2026-10-11); the product compares E.164 ("+972501234567").
export function verifiedPhoneOf(
  user: Pick<User, 'phone' | 'phone_confirmed_at'> | null | undefined,
): string | null {
  if (!user?.phone || !user.phone_confirmed_at) return null;
  return normalizePhone(`+${user.phone.replace(/^\+/, '')}`);
}

export type VerifiedPhoneRead =
  | { phone: string | null; error: null }
  | { phone: null; error: { code: string } };

// Another user's proved phone, for server code that already holds the
// service-role client. A user Auth does not know is "no proved phone", not a
// failure; any other Auth error is returned so the caller keeps its own
// fail-closed handling.
export async function readVerifiedPhone(
  admin: AdminClient,
  userId: string,
): Promise<VerifiedPhoneRead> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === 'user_not_found') return { phone: null, error: null };
    return { phone: null, error: { code: error.code ?? String(error.status ?? 'unknown') } };
  }
  return { phone: verifiedPhoneOf(data.user), error: null };
}
