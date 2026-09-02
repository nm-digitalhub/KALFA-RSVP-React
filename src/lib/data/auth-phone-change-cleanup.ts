import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Periodic cleanup of abandoned phone-change attempts in auth.users.
//
// Supabase's own troubleshooting guide ("Unexpected behavior with
// auth.updateUser({ phone })") documents the hazard and prescribes exactly this
// remedy: phone verification locates the user by SEARCHING auth.users for the
// number in `phone_change` rather than by the session, and `phone_change` —
// unlike `phone` — carries no uniqueness constraint. Two rows holding the same
// pending number therefore let a successful OTP attach that number to the wrong
// account. Nothing in Auth ever expires `phone_change`, so without this sweep
// every abandoned attempt stays a hazard forever.
//
// All the actual work is in the SECURITY DEFINER function; auth.users is owned
// by supabase_auth_admin and is not in PostgREST's exposed schemas, so there is
// no from('users') path to it and service_role holds no UPDATE on it. See
// supabase/migrations/20260902011703_auth_phone_change_cleanup.sql.
//
// The 24-hour floor lives in the function, not here, so it cannot be weakened
// from the caller.

export async function runPhoneChangeCleanup(): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('purge_stale_phone_change');

    if (error) {
      console.error('[auth-phone-change] cleanup sweep failed', {
        code: error.code,
        message: error.message,
      });
      return;
    }

    // Only when something was actually cleared: a daily no-op line for the
    // normal case would bury the one that matters. The count is not PII — the
    // function deliberately returns a number and never a row from auth.users
    // (lint 0002_auth_users_exposed).
    if (typeof data === 'number' && data > 0) {
      console.warn('[auth-phone-change] cleared stale pending phone changes', {
        rows: data,
      });
    }
  } catch (e) {
    // Never throws — same contract as the other retention sweeps: a failed run
    // simply happens again tomorrow, and the queue must not be poisoned.
    console.error('[auth-phone-change] cleanup sweep threw', {
      detail: e instanceof Error ? e.message : 'unknown error',
    });
  }
}
