import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { DAYS, readPolicyRow } from '@/lib/callbacks/policy-config';

// Admin-form half of policy-config.ts, deliberately split into its own file —
// see that module's own comment for why: it imports requireAdmin/createClient
// (session-scoped, next/headers), which must never reach the worker bundle via
// callback-scheduling.ts's import of getCallbackPolicy(). This file is safe to
// import ONLY from admin-page (request-scoped) code.

export type CallbackPolicyFormValues = {
  [K in (typeof DAYS)[number] as `${K}Open` | `${K}Start` | `${K}End`]: string | boolean;
} & {
  [K in (typeof DAYS)[number] as `dial${Capitalize<K>}Open` | `dial${Capitalize<K>}Start` | `dial${Capitalize<K>}End`]: string | boolean;
} & {
  minNoticeMinutes: string;
  horizonDays: string;
  durationMinutes: string;
  dailyCap: string;
  motzashResumeMinutes: string;
  maxAttempts: string;
  attemptWindowDays: string;
};

/** Admin-form prefill: session client + requireAdmin, mirrors getAgreementConfigForAdmin. */
export async function getCallbackPolicyForAdmin(): Promise<CallbackPolicyFormValues> {
  await requireAdmin();
  const supabase = await createClient();
  const row = (await readPolicyRow(supabase)) ?? {};
  const dayFields = Object.fromEntries(
    DAYS.flatMap((d) => {
      const start = row[`${d}_start_min`];
      const end = row[`${d}_end_min`];
      return [
        [`${d}Open`, start !== null && start !== undefined],
        [`${d}Start`, start != null ? String(start) : ''],
        [`${d}End`, end != null ? String(end) : ''],
      ];
    }),
  );
  const dialDayFields = Object.fromEntries(
    DAYS.flatMap((d) => {
      const cap = `${d[0].toUpperCase()}${d.slice(1)}`;
      const start = row[`dial_${d}_start_min`];
      const end = row[`dial_${d}_end_min`];
      return [
        [`dial${cap}Open`, start !== null && start !== undefined],
        [`dial${cap}Start`, start != null ? String(start) : ''],
        [`dial${cap}End`, end != null ? String(end) : ''],
      ];
    }),
  );
  return {
    ...dayFields,
    ...dialDayFields,
    minNoticeMinutes: row.min_notice_minutes != null ? String(row.min_notice_minutes) : '',
    horizonDays: row.horizon_days != null ? String(row.horizon_days) : '',
    durationMinutes: row.duration_minutes != null ? String(row.duration_minutes) : '',
    dailyCap: row.daily_cap != null ? String(row.daily_cap) : '',
    motzashResumeMinutes: row.motzash_resume_minutes != null ? String(row.motzash_resume_minutes) : '',
    maxAttempts: row.max_attempts != null ? String(row.max_attempts) : '',
    attemptWindowDays: row.attempt_window_days != null ? String(row.attempt_window_days) : '',
  } as CallbackPolicyFormValues;
}
