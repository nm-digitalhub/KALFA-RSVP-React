import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { QUEUES, type OutreachCallRequest } from '@/lib/queue/queues';
import type { PgBoss } from 'pg-boss';

// The callback re-dial sweep.
//
// The agent's schedule_callback tool has always persisted the guest's request
// (callback_requested_at / callback_when_text / callback_iso) and stopped there
// — recordCallbackRequest's own comment said "Re-enqueuing the actual call is a
// KALFA dispatcher follow-up". So the agent promised a guest a callback, the
// promise was written to a column, and nothing ever called. This closes that.
//
// Same idiom as the auto-thankyou sweep and the outreach sweeper: a pg-boss
// cron tick that reads FRESH DB state every time, with nothing registered or
// cancelled pg-boss-side. Clearing callback_iso, closing the event or revoking
// consent is therefore just a DB write — the next tick sees it.
//
// Request-FREE (service-role only) so the worker bundle can import it.

type AdminClient = ReturnType<typeof createAdminClient>;
type CallAttemptUpdate = Database['public']['Tables']['call_attempts']['Update'];

// call_attempts is UNIQUE(campaign_id, contact_id, touchpoint_index). A
// callback re-dial needs an index that can never collide with a real campaign
// touchpoint, so it is offset into a band no schedule will ever reach: a
// touchpoint array of 1000+ entries is not a thing. The per-attempt
// callback_count (returned by the claim) separates repeat callbacks within the
// band. If a collision somehow happened anyway, createCallAttempt's ON CONFLICT
// DO NOTHING makes it a no-dial, which is the safe direction.
export const CALLBACK_TOUCHPOINT_BASE = 1000;

export type DueCallback = {
  id: string;
  campaign_id: string;
  event_id: string;
  contact_id: string;
  callback_iso: string;
  callback_when_text: string | null;
};

/**
 * Callbacks that are DUE and not yet claimed.
 *
 * Only rows with a parsed `callback_iso` are actionable: `callback_when_text`
 * alone ("מחר בערב") is the guest's words, not a schedule, and guessing an
 * absolute time from it would ring someone's phone at an hour nobody chose.
 * Those rows are reported separately by the sweep so the promise surfaces to a
 * human instead of dying quietly — see runCallbackSweep.
 */
export async function listDueCallbacks(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<DueCallback[]> {
  const { data, error } = await admin
    .from('call_attempts')
    .select('id, campaign_id, event_id, contact_id, callback_iso, callback_when_text')
    .not('callback_iso', 'is', null)
    .is('callback_dispatched_at', null)
    .lte('callback_iso', new Date(nowMs).toISOString())
    .order('callback_iso', { ascending: true })
    .limit(100);
  if (error || !data) return [];
  return data.filter((r): r is DueCallback => typeof r.callback_iso === 'string');
}

/**
 * Atomically claim one due callback. Returns the new callback_count on success,
 * or null when another tick already took it.
 *
 * Compare-and-set, never read-then-write: the filter on a NULL
 * callback_dispatched_at is what makes overlapping ticks safe. The claim lands
 * BEFORE the dial is attempted — a claimed callback whose dial then fails stays
 * claimed, because automatically re-ringing a guest's phone is a worse failure
 * than not ringing it. Recovering one is a deliberate act (clear the column).
 */
export async function claimCallback(
  admin: AdminClient,
  attemptId: string,
  currentCount: number,
): Promise<number | null> {
  const next = currentCount + 1;
  const { data, error } = await admin
    .from('call_attempts')
    .update({
      callback_dispatched_at: new Date().toISOString(),
      callback_count: next,
    } as CallAttemptUpdate)
    .eq('id', attemptId)
    .is('callback_dispatched_at', null)
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  return next;
}

async function getContactPhone(
  admin: AdminClient,
  contactId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('contacts')
    .select('normalized_phone')
    .eq('id', contactId)
    .maybeSingle();
  return data?.normalized_phone ?? null;
}

async function currentCallbackCount(
  admin: AdminClient,
  attemptId: string,
): Promise<number> {
  const { data } = await admin
    .from('call_attempts')
    .select('callback_count')
    .eq('id', attemptId)
    .maybeSingle();
  return typeof data?.callback_count === 'number' ? data.callback_count : 0;
}

/**
 * One sweep tick. Each callback is independent — one failure must not block the
 * rest, exactly as in the thank-you sweep.
 *
 * The job is only ENQUEUED here. Every safety gate stays where it belongs, in
 * dispatchOutreachCall: the master outreach switch, the live-call toggle,
 * consent, DNC, the event-closed gate, concurrency and balance are all re-read
 * at dial time. This sweep deliberately duplicates none of them — a second copy
 * of a gate is how the two dial paths diverged in the first place. The one gate
 * the job carries an exemption for is already-reached (see
 * OutreachCallRequest.isCallback).
 */
export async function runCallbackSweep(boss: PgBoss): Promise<{ enqueued: number }> {
  const admin = createAdminClient();
  const due = await listDueCallbacks(admin);
  let enqueued = 0;

  for (const row of due) {
    try {
      const phone = await getContactPhone(admin, row.contact_id);
      if (!phone) {
        // Cannot dial without a number, and no later tick will conjure one.
        // Claim it so the sweep does not re-examine it every 5 minutes forever.
        await claimCallback(admin, row.id, await currentCallbackCount(admin, row.id));
        await sendSlackAlert({
          level: 'warn',
          title: 'Callback owed but the contact has no phone number',
          source: 'callback-sweep',
          category: 'send_health',
          fields: { attemptId: row.id, eventId: row.event_id },
        });
        continue;
      }

      const count = await claimCallback(admin, row.id, await currentCallbackCount(admin, row.id));
      if (count === null) continue; // another tick won it

      const job: OutreachCallRequest = {
        campaignId: row.campaign_id,
        eventId: row.event_id,
        contactId: row.contact_id,
        normalizedPhone: phone,
        scriptKey: 'rsvp_v1',
        touchpointIndex: CALLBACK_TOUCHPOINT_BASE + count,
        isCallback: true,
        callbackFromAttemptId: row.id,
      };
      await boss.send(QUEUES.callRequest, job);
      enqueued += 1;
    } catch (err) {
      // One bad row must never stop the others. No PII in the log — ids only.
      console.error('[callback-sweep] failed for attempt', row.id, (err as Error)?.message);
    }
  }

  if (enqueued > 0) {
    console.log('[callback-sweep] enqueued callback re-dials', { enqueued });
  }
  return { enqueued };
}

/**
 * Callbacks a guest asked for that we cannot schedule, because the agent could
 * not resolve their words into an absolute time.
 *
 * These are NOT dispatched — ringing someone at a guessed hour is worse than
 * not ringing them. They are surfaced instead, so a person can decide. Without
 * this the request would be indistinguishable from one that was handled.
 */
export async function listUnschedulableCallbacks(
  admin: AdminClient,
): Promise<{ id: string; event_id: string; when_text: string | null }[]> {
  const { data } = await admin
    .from('call_attempts')
    .select('id, event_id, callback_when_text, callback_requested_at')
    .is('callback_iso', null)
    .not('callback_requested_at', 'is', null)
    .is('callback_dispatched_at', null)
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id,
    event_id: r.event_id,
    when_text: r.callback_when_text ?? null,
  }));
}
