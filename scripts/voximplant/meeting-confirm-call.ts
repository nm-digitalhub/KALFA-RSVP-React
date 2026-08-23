// Voximplant ↔ ElevenLabs MEETING-CONFIRM bridge — gated single outbound call
// (ops tool). Sibling of bridge-call.ts (the RSVPAgent launcher), for the
// MeetingConfirmAgent surface: callback_request_attempts + mtg/ctx|cb routes,
// rule OutCallMeetingConfirm.
//
// This is a REAL dial path, not a test harness — it records the same rows the
// worker dispatcher does (createCallbackDispatchAttempt / dial audit /
// recordCallbackDialConfirmed), so its output is production data.
//
//   npm run mtgconfirm:call -- --request-id <uuid> --confirm
//
// Isolation + safety (mirrors bridge-call.ts's own contract):
//   * Places a REAL outbound call (Voximplant minutes + ElevenLabs credits) —
//     nothing runs without --confirm.
//   * Rule + caller id + auth come from getMeetingConfirmDispatchConfig() —
//     the SAME admin-config resolver the worker uses, so the kill switches
//     (voximplant_live_calls + voximplant_meeting_confirm_enabled + env) still
//     apply; a disabled channel refuses here exactly as it does in the worker.
//   * Destination defaults to the callback_requests row's own phone; --to
//     overrides it for an audio-path test against a different handset.
//   * NOT gated on consent/DNC/Shabbat/hours/balance/concurrency — those live
//     in dispatchMeetingConfirmCall, which this launcher deliberately
//     bypasses for a one-off owner-authorized dial (same stance as
//     bridge-call.ts: "Verify the destination yourself"). The dial audit IS
//     still written, so the shared 3-attempt budget stays honest.
//   * Refuses a row the mtg/ctx route would 404 (not scheduled / no calendar
//     item / no scheduled_at) — a dial whose ctx fails never bridges (the
//     scenario treats ctx failure as fatal by design).
//   * NEVER prints the access token — ids + byte count only.

import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  createCallbackDispatchAttempt,
  listCallbackDispatchAttemptsBySlot,
  recordCallbackDialConfirmed,
  recordCallbackDialAudit,
  DISPATCH_PRE_TERMINAL,
} from '@/lib/data/callback-request-attempts';
import { buildMeetingConfirmCustomData } from '@/lib/data/meeting-confirm-dispatch';
import { getMeetingConfirmDispatchConfig } from '@/lib/data/voximplant-config';
import { normalizePhone } from '@/lib/phone';
import { getAppOrigin } from '@/lib/url';
import { startScenarios } from '@/lib/voximplant/mutations';

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2h — same as the worker dispatcher

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
  const config = await getMeetingConfirmDispatchConfig();
  if (!config) {
    console.error(
      'ERROR: meeting-confirm channel is not configured (service account / ' +
        'caller id / rule id missing) — nothing to dial with.',
    );
    process.exitCode = 1;
    return;
  }
  if (!config.callsEnabled) {
    console.error(
      'ERROR: the meeting-confirm channel is switched OFF ' +
        '(voximplant_live_calls / voximplant_meeting_confirm_enabled / env). ' +
        'Enable it in /admin/channels before dialing.',
    );
    process.exitCode = 1;
    return;
  }

  // The row must be in the exact state mtg/ctx re-verifies, or the scenario
  // will fetch ctx, get the generic 404, and refuse to dial (by design).
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('callback_requests')
    .select('id, full_name, phone, status, scheduled_at, calendar_item_id')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !row) {
    console.error(`ERROR: callback_requests row ${requestId} not found.`);
    process.exitCode = 1;
    return;
  }
  if (row.status !== 'scheduled' || !row.calendar_item_id || !row.scheduled_at) {
    console.error(
      `ERROR: row is not dialable (status=${row.status}, calendar_item=` +
        `${row.calendar_item_id ? 'set' : 'null'}, scheduled_at=` +
        `${row.scheduled_at ?? 'null'}) — mtg/ctx would 404 and the scenario ` +
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
  const created = await createCallbackDispatchAttempt({
    callbackRequestId: requestId,
    accessToken,
    tokenExpiresAt,
    scheduledAtSnapshot: row.scheduled_at,
  });
  if (created) {
    attemptId = created.id;
  } else {
    const [existing] = await listCallbackDispatchAttemptsBySlot(requestId, row.scheduled_at);
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

  // Same shared audit action the worker writes — keeps the 3-attempt budget honest.
  await recordCallbackDialAudit(requestId);

  const origin = val('origin') ?? (await getAppOrigin());
  const { payload, bytes } = buildMeetingConfirmCustomData({
    to,
    from: config.callerId,
    tok,
    u: origin,
  });

  console.log('=== StartScenarios — LIVE MEETING-CONFIRM CALL (MeetingConfirmAgent) ===');
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

  const { applied } = await recordCallbackDialConfirmed(attemptId, resp.call_session_history_id);
  console.log(`dial recorded           : ${applied ? 'yes' : 'no (row already terminal)'}`);
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
