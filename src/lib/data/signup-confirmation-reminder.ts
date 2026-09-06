import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl } from '@/lib/url';
import { sendSlackAlert } from '@/lib/alerts/slack';

// One reminder, once, to a signup that never confirmed its email address.
//
// The gap this closes: signing up creates the auth user immediately, but the
// account is unusable until the emailed link is clicked. Someone who misses that
// mail is simply gone — no event, no lead, no trace anywhere an admin looks. On
// 2026-09-06 a real signup (2026-08-12) turned out to have never received the
// mail at all, because the Resend sending domain was only verified on 08-15.
//
// Deliberately NOT a cascade like inquiry-followup.ts. One nudge:
//   • a second nudge to someone who ignored the first is spam-adjacent, and
//   • "signed up a day ago, still unconfirmed" is exactly where typo'd and
//     throwaway addresses concentrate, so every extra send is extra hard-bounce
//     exposure on the same Resend domain that carries the signed agreements.
// The candidate query (signup_reminder_candidates) already excludes addresses
// whose confirmation mail hard-bounced before.
//
// The content is the ordinary confirmation template — no offers, no features.
// "Finish the signup you started" completes a process the recipient initiated,
// so it is not a דבר פרסומת under §30א; adding a pitch would make it one.

type AdminClient = ReturnType<typeof createAdminClient>;

/** How old a signup must be before it counts as "did not click", and how old is too old to still be part of that signup. */
const MIN_AGE_HOURS = 24;
const MAX_AGE_DAYS = 7;

// Supabase's project-wide email budget is rate_limit_email_sent (100/hour as
// configured). This cap keeps a backlog burst from eating the headroom that
// live signups and password resets need in the same hour; the leftovers are
// simply picked up by tomorrow's tick.
const MAX_PER_RUN = 25;

export interface SignupReminderCandidate {
  user_id: string;
  email: string;
  created_at: string;
}

export interface SignupReminderResult {
  sent: number;
  failed: number;
  candidates: number;
}

/** Kill-switch — false (and the sweep a no-op) unless an admin explicitly arms it. */
export async function getSignupReminderEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('signup_reminder_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return false;
    return data.signup_reminder_enabled === true;
  } catch {
    return false;
  }
}

// auth.users is not reachable through PostgREST, so this goes through the
// SECURITY DEFINER function rather than a table read. The function returns only
// unconfirmed, un-reminded, recent, non-bounced signups — never a general
// window onto auth.users.
export async function listReminderCandidates(
  admin: AdminClient,
): Promise<SignupReminderCandidate[]> {
  const { data, error } = await admin.rpc('signup_reminder_candidates', {
    min_age_hours: MIN_AGE_HOURS,
    max_age_days: MAX_AGE_DAYS,
  });
  if (error) throw new Error(`signup_reminder_candidates failed: ${error.message}`);
  return (data ?? []) as SignupReminderCandidate[];
}

export async function runSignupReminderSweep(): Promise<SignupReminderResult> {
  const admin = createAdminClient();
  const candidates = (await listReminderCandidates(admin)).slice(0, MAX_PER_RUN);
  const emailRedirectTo = await getAppUrl('/auth/confirm');

  let sent = 0;
  const failedIds: string[] = [];

  for (const candidate of candidates) {
    // Latch FIRST, then send. A crash between the two costs this user their one
    // reminder; latching after the send would instead risk mailing them twice on
    // the next tick. Given the choice, a missed nudge beats a duplicate — so the
    // failures below are reported by id rather than retried.
    const { error: latchError } = await admin
      .from('profiles')
      .update({ signup_reminder_sent_at: new Date().toISOString() })
      .eq('id', candidate.user_id)
      .is('signup_reminder_sent_at', null);
    if (latchError) {
      failedIds.push(candidate.user_id);
      continue;
    }

    const { error } = await admin.auth.resend({
      type: 'signup',
      email: candidate.email,
      options: { emailRedirectTo },
    });
    if (error) failedIds.push(candidate.user_id);
    else sent += 1;
  }

  const result: SignupReminderResult = {
    sent,
    failed: failedIds.length,
    candidates: candidates.length,
  };

  // Only speak up when there was something to do. Ids only, never the addresses
  // themselves — the same rule the archive alerts follow.
  if (result.candidates > 0) {
    void sendSlackAlert({
      level: result.failed > 0 ? 'warn' : 'info',
      category: 'customer_inquiry',
      source: 'signup-reminder',
      title: 'תזכורת אימות מייל נשלחה להרשמות שלא הושלמו',
      detail: [
        `מועמדים ${result.candidates} · נשלחו ${result.sent} · נכשלו ${result.failed}`,
        failedIds.length ? `נכשלו (מזהי משתמש): ${failedIds.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  return result;
}
