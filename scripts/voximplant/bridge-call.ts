// Voximplant ↔ ElevenLabs BRIDGE — gated single outbound call (ops tool).
//
// This is a REAL dial path, not a test harness. Until a campaign is enabled and
// the worker dispatcher runs, it is the ONLY path that places a bridged call —
// so it records the same provider identity the worker does (see
// recordDialConfirmed below). Treat its output as production data.
//
// Places ONE controlled bridged call: it stamps a random, NON-authorizing
// correlation nonce onto an EXISTING call_attempt, then StartScenarios the
// deployed RSVPAgent bridge. The scenario fetches ctx (which surfaces the nonce
// as kalfa_attempt_token), injects it as an ElevenLabs dynamic variable, and the
// post-call webhook echoes it → storeCallAnalysis links conversation → attempt.
//
//   npm run bridge:call -- \
//     --attempt-id <uuid> --to +9725XXXXXXXX --from 97237219347 --confirm
//
// Isolation + safety:
//   * Places a REAL outbound call and consumes BOTH Voximplant minutes AND
//     ElevenLabs credits — nothing runs without --confirm.
//   * Default rule = 1520915 (OutCallAgent → RSVPAgent on kalfa-rsvp). It
//     hard-refuses the DTMF production OutCall rule (1494311) — that rule's
//     scenario is not the bridge and is driven only by the worker dispatcher.
//   * Refuses an event that can no longer record an RSVP (not active / past
//     event day / passed deadline) — the same refusals submit_rsvp applies, and
//     the same gate the worker dispatcher enforces at 4b. --allow-closed-event
//     overrides it loudly, for audio-path testing only.
//   * NEVER prints the access token, the nonce, or any secret — ids + byte count
//     only.
//   * NOT gated on consent / DNC / balance / concurrency: those live in
//     dispatchOutreachCall, which this launcher bypasses. Verify the destination
//     yourself before dialling — nothing here does it for you.
//   * The nonce is stamped first-writer-wins (idempotent): a re-run reuses the
//     existing nonce, so ctx and the injected dynamic variable stay in sync.
//
// Reuses the committed client (startScenarios from src/lib/voximplant/mutations)
// and the request-free DAL — no hand-rolled JWT/fetch. Bundled via esbuild (see
// the `bridge:call` npm script) so `@/` + the service-role client resolve,
// and run with `--env-file=.env.local`.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  getCallAttemptById,
  recordDialConfirmed,
  stampElCorrelationNonce,
  TERMINAL_STATUSES,
} from '@/lib/data/call-attempts';
import { getCampaignContext } from '@/lib/data/outreach-engine';
import { closedEventRefusal } from '@/lib/voximplant/dial-preconditions';
import { getAppOrigin } from '@/lib/url';
import type { VoximplantConfig } from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';

// The DTMF production OutCall rule — this launcher must NEVER touch it (its
// scenario is RSVP.voxengine.js, not the bridge; only the worker dials it).
const PROD_OUTCALL_RULE = '1494311';
// OutCallAgent → RSVPAgent on kalfa-rsvp (rules metadata, promoted 2026-07-20).
const DEFAULT_AGENT_RULE = '1520915';

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

function loadConfig(): VoximplantConfig {
  const path =
    val('credentials') ??
    process.env.VOXIMPLANT_CREDENTIALS_FILE ??
    process.env.VOX_CI_CREDENTIALS ??
    'vox_ci_credentials.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    account_id: number | string;
    key_id: string;
    private_key: string;
  };
  return { accountId: raw.account_id, keyId: raw.key_id, privateKey: raw.private_key };
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

  const attemptId = val('attempt-id');
  const to = val('to');
  const from = val('from');
  const ruleId = val('rule') ?? DEFAULT_AGENT_RULE;

  if (!attemptId || !to || !from) {
    console.error('ERROR: --attempt-id, --to and --from are required (non-empty).');
    process.exitCode = 1;
    return;
  }
  // Hard isolation guard: refuse the production rule outright, whatever is passed.
  if (ruleId === PROD_OUTCALL_RULE) {
    console.error(
      `ERROR: refusing to run against the DTMF production OutCall rule (${PROD_OUTCALL_RULE}). ` +
        'This launcher only drives the ElevenLabs bridge rule (OutCallAgent).',
    );
    process.exitCode = 1;
    return;
  }

  // Load the attempt: identity + the access token that gates ctx/cb/agent-tool.
  const attempt = await getCallAttemptById(attemptId);
  if (!attempt) {
    console.error(`ERROR: no call_attempt found for id ${attemptId}.`);
    process.exitCode = 1;
    return;
  }
  // The link only completes if ctx serves the nonce — which it refuses for a
  // terminal attempt or an expired token. Fail loudly rather than dial a call
  // that silently produces an UNLINKED conversation.
  if ((TERMINAL_STATUSES as readonly string[]).includes(attempt.status)) {
    console.error(
      `ERROR: attempt ${attemptId} is terminal (status=${attempt.status}); ctx would 404 ` +
        'and the conversation would be unlinked. Use a fresh, non-terminal attempt.',
    );
    process.exitCode = 1;
    return;
  }
  if (!attempt.token_expires_at || Date.parse(attempt.token_expires_at) <= Date.now()) {
    console.error(
      `ERROR: attempt ${attemptId} token is expired; ctx would 404. Use a fresh attempt.`,
    );
    process.exitCode = 1;
    return;
  }

  // The event must still be able to RECORD an answer — the same three
  // submit_rsvp refusals dispatchOutreachCall enforces at gate 4b. This launcher
  // bypasses the dispatcher completely, so without this check it is the one
  // remaining way to place a call the database will refuse to write. That is
  // precisely what produced the three bridge calls on 2026-07-21: the bridge
  // worked, QA scored 100/100 on the transcript, and not one RSVP was written,
  // because the event day had already passed.
  //
  // getCampaignContext is reused for the event facts only; its campaign status is
  // deliberately NOT gated on here (an ops tool must still work against a closed
  // campaign — that is not what makes a call worthless).
  const cctx = await getCampaignContext(attempt.campaign_id);
  const closedReason = closedEventRefusal(cctx);
  if (closedReason) {
    // Escape hatch, because testing the AUDIO path (voice, disclosure, barge-in)
    // is legitimate on a closed event — but it must be a decision, never a
    // surprise. Silence here is what let three calls look like a success.
    if (flag('allow-closed-event') !== '__present__') {
      console.error(
        `ERROR: refusing to dial — ${closedReason}, so submit_rsvp will REJECT ` +
          'any answer this call collects. The guest would be asked to confirm and ' +
          'then apologised to, and the call would still bill as a reached contact. ' +
          'Use a future-dated active event, or pass --allow-closed-event to test ' +
          'the audio path knowingly.',
      );
      process.exitCode = 1;
      return;
    }
    console.warn(
      `WARNING: --allow-closed-event — ${closedReason}. save_rsvp WILL return ` +
        "'rejected' and NO RSVP will be written. Treat any QA score from this " +
        'call as measuring the audio path only.',
    );
  }

  // Generate + stamp a NON-authorizing correlation nonce (idempotent: a re-run
  // reuses the existing one). Never printed — presence + linkage only.
  const stamped = await stampElCorrelationNonce(attemptId, randomBytes(16).toString('hex'));
  if (!stamped) {
    console.error(`ERROR: could not stamp a correlation nonce on attempt ${attemptId}.`);
    process.exitCode = 1;
    return;
  }

  const origin = val('origin') ?? (await getAppOrigin());
  // Same tiny Branch B payload the scenario already parses ({to, from, tok, u}).
  const payload = JSON.stringify({ to, from, tok: attempt.access_token, u: origin });

  console.log('=== StartScenarios — LIVE BRIDGE TEST CALL (RSVPAgent) ===');
  console.log(`rule_id                 : ${ruleId}`);
  console.log(`attempt_id              : ${attemptId}`);
  console.log(`to                      : ${to}`);
  console.log(`from                    : ${from}`);
  console.log(`origin (u)              : ${origin}`);
  console.log(`correlation nonce       : stamped (value withheld)`);
  console.log(`script_custom_data bytes: ${Buffer.byteLength(payload, 'utf8')}`); // count only

  const cfg = loadConfig();
  const resp = await startScenarios(cfg, { rule_id: ruleId, script_custom_data: payload }, 30_000);
  console.log(`result                  : ${resp.result}`);
  console.log(`call_session_history_id : ${resp.call_session_history_id ?? '(none)'}`);
  if (resp.result !== 1 || !resp.call_session_history_id) {
    console.error('StartScenarios did not confirm a started call.');
    process.exitCode = 1;
    return;
  }

  // Persist the provider identity exactly as the worker dispatcher does
  // (dispatchOutreachCall → recordDialConfirmed). Same DAL, same CAS guard on
  // PRE_TERMINAL, so a cb callback that already advanced the row is never
  // clobbered.
  //
  // This launcher used to print the StartScenarios response and drop it, leaving
  // vox_call_session_history_id and media_session_access_url NULL. Since it is
  // the only path that actually dials today (no campaign is enabled, so the
  // worker never runs), those columns were empty on every row ever created — and
  // media_session_access_url is the server-side handle a live-session command
  // channel needs. Printing an id the database never learns is not a dial record.
  const { applied } = await recordDialConfirmed(attemptId, {
    callSessionHistoryId: resp.call_session_history_id,
    mediaSessionAccessUrl: resp.media_session_access_url ?? null,
    mediaSessionAccessSecureUrl: resp.media_session_access_secure_url ?? null,
  });
  console.log(`dial recorded           : ${applied ? 'yes' : 'no (row already terminal)'}`);
  console.log(
    `media handle            : ${resp.media_session_access_secure_url ? 'https stored' : resp.media_session_access_url ? 'http only' : '(not returned)'}`,
  );
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
