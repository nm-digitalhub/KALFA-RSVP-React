// Voximplant ↔ ElevenLabs BRIDGE — gated single test call (ops tool).
//
// Places ONE controlled bridged call: it stamps a random, NON-authorizing
// correlation nonce onto an EXISTING call_attempt, then StartScenarios the
// deployed RSVPAgent bridge (promoted from VoiceAgentTest, 2026-07-20). The
// scenario fetches ctx (which surfaces the nonce as kalfa_attempt_token),
// injects it as an ElevenLabs dynamic variable, and the post-call webhook
// echoes it → storeCallAnalysis links conversation → attempt.
//
//   npm run bridge:test-call -- \
//     --attempt-id <uuid> --to +9725XXXXXXXX --from 97237219347 --confirm
//
// Isolation + safety:
//   * Places a REAL outbound call and consumes BOTH Voximplant minutes AND
//     ElevenLabs credits — nothing runs without --confirm.
//   * Default rule = 1520915 (OutCallAgent → RSVPAgent on kalfa-rsvp). It
//     hard-refuses the DTMF production OutCall rule (1494311) — that rule's
//     scenario is not the bridge and is driven only by the worker dispatcher.
//   * NEVER prints the access token, the nonce, or any secret — ids + byte count
//     only.
//   * The nonce is stamped first-writer-wins (idempotent): a re-run reuses the
//     existing nonce, so ctx and the injected dynamic variable stay in sync.
//
// Reuses the committed client (startScenarios from src/lib/voximplant/mutations)
// and the request-free DAL — no hand-rolled JWT/fetch. Bundled via esbuild (see
// the `bridge:test-call` npm script) so `@/` + the service-role client resolve,
// and run with `--env-file=.env.local`.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  getCallAttemptById,
  stampElCorrelationNonce,
  TERMINAL_STATUSES,
} from '@/lib/data/call-attempts';
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
  }
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
