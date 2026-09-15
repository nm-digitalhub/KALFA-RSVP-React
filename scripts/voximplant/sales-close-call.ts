// Voximplant ↔ ElevenLabs SALES-CLOSE bridge — gated single outbound call
// (ops tool). The fourth launcher alongside bridge-call.ts (RSVPAgent),
// meeting-confirm-call.ts (MeetingConfirmAgent) and outreach-call.ts, for the
// SalesCloseAgent surface: sales_call_attempts + sls/ctx|cb|tool routes, rule
// OutCallSalesClose.
//
// WHY IT EXISTS. Every other persona had a way to place one deliberate call;
// sales-close was reachable only through the scheduling sweep, so there was no
// way to exercise it on demand. This mirrors meeting-confirm-call.ts line for
// line with the sales substitutions — nothing here is a new mechanism.
//
//   npm run salesclose:call -- --request-id <uuid> --confirm
//
// Isolation + safety (the same contract the sibling launchers carry):
//   * Places a REAL outbound call (Voximplant minutes + ElevenLabs credits) —
//     nothing runs without --confirm.
//   * Rule + caller id + auth come from getSalesCallDispatchConfig() — the SAME
//     admin-config resolver the worker uses, so the kill switches
//     (voximplant_live_calls + voximplant_sales_calls_enabled + env) still
//     apply; a disabled channel refuses here exactly as it does in the worker.
//   * Destination defaults to the callback_requests row's own phone; --to
//     overrides it for an audio-path test against a different handset.
//   * NOT gated on consent/DNC/Shabbat/hours/balance/concurrency — those live
//     in dispatchSalesCall, which this launcher deliberately bypasses for a
//     one-off owner-authorized dial (same stance as bridge-call.ts: verify the
//     destination yourself).
//   * Refuses a row sls/ctx would 404. That route requires status='scheduled',
//     a scheduled_at, and scheduled_at === the attempt's snapshot — and unlike
//     meeting-confirm it does NOT require a calendar_item_id. A dial whose ctx
//     fails never bridges: the scenario treats a non-200 ctx as fatal.
//   * Refuses a row whose topic is not the sales topic — dialing the
//     sales-closing agent at someone who asked for something else is the kind
//     of mistake this check exists to make impossible.
//   * NEVER prints the access token — ids + byte count only.

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  createSalesDispatchAttempt,
  getSalesDispatchAttemptBySlot,
  recordSalesDialConfirmed,
  DISPATCH_PRE_TERMINAL,
} from '@/lib/data/sales-call-attempts';
import { buildSalesCallCustomData } from '@/lib/data/sales-call-dispatch';
import { getSalesCallDispatchConfig } from '@/lib/data/voximplant-config';
import { normalizePhone } from '@/lib/phone';
import { getAppOrigin } from '@/lib/url';
import { startScenarios } from '@/lib/voximplant/mutations';

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2h — same as the worker dispatcher
const SALES_TOPIC = 'מכירות';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '__present__';
}
function val(name: string): string | undefined {
  const v = flag(name);
  return v && v !== '__present__' ? v : undefined;
}

async function main(): Promise<void> {
  if (flag('confirm') !== '__present__') {
    console.error(
      'ERROR: this places a REAL bridged call (Voximplant minutes + ElevenLabs ' +
        'credits) and is disabled by default. Re-run with --confirm after approval.',
    );
    process.exitCode = 1;
    return;
  }

  const requestId = val('request-id');
  if (!requestId) {
    console.error('ERROR: --request-id is required (a callback_requests uuid).');
    process.exitCode = 1;
    return;
  }

  // Same config resolver as the worker — kill switches still apply.
  const config = await getSalesCallDispatchConfig();
  if (!config) {
    console.error(
      'ERROR: sales-close channel is not configured (service account / caller ' +
        'id / rule id missing) — nothing to dial with.',
    );
    process.exitCode = 1;
    return;
  }
  if (!config.callsEnabled) {
    console.error(
      'ERROR: the sales-close channel is switched OFF ' +
        '(voximplant_live_calls / voximplant_sales_calls_enabled / env). ' +
        'Enable it in /admin/channels before dialing.',
    );
    process.exitCode = 1;
    return;
  }

  // The row must be in the exact state sls/ctx re-verifies, or the scenario
  // fetches ctx, gets the generic 404, and refuses to dial (by design).
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('callback_requests')
    .select('id, full_name, phone, topic, status, scheduled_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !row) {
    console.error(`ERROR: callback_requests row ${requestId} not found.`);
    process.exitCode = 1;
    return;
  }
  if (row.topic !== SALES_TOPIC) {
    console.error(
      `ERROR: row topic is "${row.topic ?? 'null'}", not "${SALES_TOPIC}". ` +
        'This launcher only drives the sales-closing agent.',
    );
    process.exitCode = 1;
    return;
  }
  if (row.status !== 'scheduled' || !row.scheduled_at) {
    console.error(
      `ERROR: row is not dialable (status=${row.status}, scheduled_at=` +
        `${row.scheduled_at ?? 'null'}) — sls/ctx would 404 and the scenario ` +
        'would refuse to dial.',
    );
    process.exitCode = 1;
    return;
  }

  const to = val('to') ?? normalizePhone(row.phone);
  if (!to) {
    console.error('ERROR: no valid destination phone (row phone unparseable and no --to).');
    process.exitCode = 1;
    return;
  }

  // Atomic create on the (request, slot) unique index — a re-run against the
  // same slot reuses the existing pre-terminal attempt (and its token) instead
  // of erroring, so a second invocation cannot double-book the slot.
  const accessToken = randomBytes(16).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  let attemptId: string;
  let tok = accessToken;
  const created = await createSalesDispatchAttempt({
    callbackRequestId: requestId,
    accessToken,
    tokenExpiresAt,
    scheduledAtSnapshot: row.scheduled_at,
  });
  if (created) {
    attemptId = created.id;
  } else {
    const existing = await getSalesDispatchAttemptBySlot(requestId, row.scheduled_at);
    if (!existing) {
      console.error('ERROR: attempt create lost a race and no existing row was found.');
      process.exitCode = 1;
      return;
    }
    const preTerminal = (DISPATCH_PRE_TERMINAL as readonly string[]).includes(
      existing.dispatch_status,
    );
    const tokenValid =
      !!existing.token_expires_at && Date.parse(existing.token_expires_at) > Date.now();
    if (!preTerminal || !tokenValid) {
      console.error(
        `ERROR: an attempt already exists for this slot (status=` +
          `${existing.dispatch_status}, token ${tokenValid ? 'valid' : 'expired'}) ` +
          'and cannot be reused. This slot has already been dialed.',
      );
      process.exitCode = 1;
      return;
    }
    attemptId = existing.id;
    tok = existing.access_token;
    console.log('note: reusing the existing pre-terminal attempt for this slot.');
  }

  const origin = val('origin') ?? (await getAppOrigin());
  const { payload, bytes } = buildSalesCallCustomData({
    to,
    from: config.callerId,
    tok,
    u: origin,
  });

  console.log('=== StartScenarios — LIVE SALES-CLOSE CALL (SalesCloseAgent) ===');
  console.log(`rule_id                 : ${config.ruleId}`);
  console.log(`request_id              : ${requestId}`);
  console.log(`attempt_id              : ${attemptId}`);
  console.log(`to                      : ${to}`);
  console.log(`from                    : ${config.callerId}`);
  console.log(`origin (u)              : ${origin}`);
  console.log(`script_custom_data bytes: ${bytes}`); // count only — never the token

  const resp = await startScenarios(
    config.auth,
    { rule_id: config.ruleId, script_custom_data: payload },
    30_000,
  );
  console.log(`result                  : ${resp.result}`);
  console.log(`call_session_history_id : ${resp.call_session_history_id ?? '(none)'}`);
  if (resp.result !== 1 || !resp.call_session_history_id) {
    console.error('StartScenarios did not confirm a started call.');
    process.exitCode = 1;
    return;
  }

  const { applied } = await recordSalesDialConfirmed(attemptId, resp.call_session_history_id);
  console.log(`dial recorded           : ${applied ? 'yes' : 'no (row already terminal)'}`);
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
