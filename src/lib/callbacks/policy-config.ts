import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { DEFAULT_CALLBACK_POLICY, type CallbackPolicy, type DayWindow } from '@/lib/callbacks/schedule-policy';

// Admin-editable version of DEFAULT_CALLBACK_POLICY (schedule-policy.ts stays
// pure/DB-free by design — this is the DB-facing counterpart).
//
// WORKER-SAFE ON PURPOSE, matching callback-scheduling.ts's own contract
// (service-role only, no requireUser/no cookies) — this file must NEVER import
// requireAdmin/createClient(session)/next-headers, since callback-scheduling.ts
// (imported by worker/main.ts) imports this module. The admin-form counterpart
// (session client + requireAdmin) lives in policy-config-admin.ts instead,
// specifically so the worker bundle never pulls in next/headers transitively —
// dependency-cruiser's worker-no-request-scoped-next rule enforces this split.

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const POLICY_COLUMNS =
  DAYS.flatMap((d) => [`${d}_start_min`, `${d}_end_min`]).join(', ') +
  ', ' +
  DAYS.flatMap((d) => [`dial_${d}_start_min`, `dial_${d}_end_min`]).join(', ') +
  ', min_notice_minutes, horizon_days, duration_minutes, daily_cap, motzash_resume_minutes' +
  ', max_attempts, attempt_window_days';

export type PolicyRow = Record<string, number | null>;

function windowFor(row: PolicyRow, day: (typeof DAYS)[number], prefix: '' | 'dial_' = ''): DayWindow {
  const start = row[`${prefix}${day}_start_min`];
  const end = row[`${prefix}${day}_end_min`];
  return start === null || end === null || start === undefined || end === undefined
    ? null
    : { startMin: start, endMin: end };
}

// The DB CHECK constraints already reject a malformed single column at write
// time; this is the read-time guard for the one thing they cannot express — a
// cross-column relationship (e.g. duration_minutes longer than every open
// window). Falling back to the full default policy rather than a patched-up
// partial one avoids serving a policy that searches forever without a slot.
function toCallbackPolicy(row: PolicyRow | null): CallbackPolicy {
  if (!row) return DEFAULT_CALLBACK_POLICY;
  const weekday = DAYS.map((d) => windowFor(row, d)) as unknown as CallbackPolicy['weekday'];
  const dialWeekday = DAYS.map((d) => windowFor(row, d, 'dial_')) as unknown as CallbackPolicy['dialWeekday'];
  const minNoticeMs = (row.min_notice_minutes ?? 0) * 60_000;
  const horizonMs = (row.horizon_days ?? 0) * 86_400_000;
  const durationMs = (row.duration_minutes ?? 0) * 60_000;
  const dailyCap = row.daily_cap ?? 0;
  const motzashResumeMs = (row.motzash_resume_minutes ?? 0) * 60_000;
  const maxAttempts = row.max_attempts ?? 0;
  const attemptWindowMs = (row.attempt_window_days ?? 0) * 86_400_000;
  if (
    ![minNoticeMs, horizonMs, durationMs, dailyCap, motzashResumeMs, maxAttempts, attemptWindowMs].every(
      Number.isFinite,
    ) ||
    dailyCap < 1 ||
    maxAttempts < 1
  ) {
    return DEFAULT_CALLBACK_POLICY;
  }
  return {
    weekday,
    dialWeekday,
    minNoticeMs,
    horizonMs,
    durationMs,
    dailyCap,
    motzashResumeMs,
    maxAttempts,
    attemptWindowMs,
  };
}

export async function readPolicyRow(client: SupabaseClient<Database>): Promise<PolicyRow | null> {
  const { data, error } = await client
    .from('callback_schedule_policies')
    .select(POLICY_COLUMNS)
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as PolicyRow;
}

/** Live scheduling-path read: service-role, fail-safe to DEFAULT_CALLBACK_POLICY on any error or missing row. */
export async function getCallbackPolicy(): Promise<CallbackPolicy> {
  try {
    const admin = createAdminClient();
    return toCallbackPolicy(await readPolicyRow(admin));
  } catch {
    return DEFAULT_CALLBACK_POLICY;
  }
}
