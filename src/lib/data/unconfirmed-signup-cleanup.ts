import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Delete signups still unconfirmed after 30 days.
//
// The risk this closes is not a tidy database. A mistyped address is usually
// one character off a real inbox, so the confirmation mail lands with a
// stranger — and Supabase does NOT gate password recovery on a confirmed
// email (Studio gates "Reset password" on isEmailAuth alone, while gating the
// confirmation mail on isVerified). A stranger can therefore reset the password
// and take an account that carries the real signer's name and phone.
//
// 30 days matches Supabase's own documented cleanup for anonymous users, where
// they note automatic cleanup is not available and delete anything older than
// 30 days. It also sits well past the reminder sweep's 7-day window, so nothing
// is deleted while it could still be reminded.
//
// Deletion goes through auth.admin.deleteUser (documented: hard delete by
// default, cascades auth.sessions and invalidates refresh tokens) rather than a
// raw DELETE, so the documented Storage-ownership guard still applies and any
// refusal surfaces as an error instead of a silent partial delete.
// public.profiles is ON DELETE CASCADE, so the profile row goes with it.

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_AGE_DAYS = 30;

// A cap, because deletion is irreversible: if the candidate query ever returns
// something unexpected, a single run can only ever do bounded damage.
const MAX_PER_RUN = 50;

export interface StaleSignup {
  user_id: string;
  email: string;
  created_at: string;
}

export interface CleanupResult {
  deleted: number;
  failed: number;
  candidates: number;
}

/** Kill-switch — false (and the sweep a no-op) unless an admin explicitly arms it. */
export async function getUnconfirmedCleanupEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('unconfirmed_cleanup_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.unconfirmed_cleanup_enabled === true;
  } catch {
    return false;
  }
}

export async function listStaleSignups(admin: AdminClient): Promise<StaleSignup[]> {
  const { data, error } = await admin.rpc('stale_unconfirmed_signups', {
    max_age_days: MAX_AGE_DAYS,
  });
  if (error) throw new Error(`stale_unconfirmed_signups failed: ${error.message}`);
  return (data ?? []) as StaleSignup[];
}

export async function runUnconfirmedCleanupSweep(): Promise<CleanupResult> {
  const admin = createAdminClient();
  const candidates = (await listStaleSignups(admin)).slice(0, MAX_PER_RUN);

  let deleted = 0;
  const failedIds: string[] = [];

  for (const candidate of candidates) {
    const { error } = await admin.auth.admin.deleteUser(candidate.user_id);
    if (error) failedIds.push(candidate.user_id);
    else deleted += 1;
  }

  const result: CleanupResult = {
    deleted,
    failed: failedIds.length,
    candidates: candidates.length,
  };

  // Deleting accounts is irreversible, so every run that touched anything is
  // reported — ids only, never the addresses.
  if (result.candidates > 0) {
    void sendSlackAlert({
      level: result.failed > 0 ? 'warn' : 'info',
      category: 'security',
      source: 'unconfirmed-cleanup',
      title: 'נמחקו הרשמות שלא אומתו',
      detail: [
        `מועמדים ${result.candidates} · נמחקו ${result.deleted} · נכשלו ${result.failed}`,
        failedIds.length ? `נכשלו (מזהי משתמש): ${failedIds.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  return result;
}
