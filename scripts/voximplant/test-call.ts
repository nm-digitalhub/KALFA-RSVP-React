/**
 * Voximplant — GATED single test call (ops tool, NOT part of the read-only CLI).
 *
 * The read-only `npm run voximplant` CLI can never dial (the `start` command was
 * removed with the mutations split). This separate, explicitly-guarded runner is
 * the plan's "gated live test" step (§8): ONE real outbound call to a test phone,
 * behind a mandatory --confirm interlock, reusing `startScenarios` from the
 * mutations module (no hand-rolled JWT/fetch).
 *
 *   npx tsx scripts/voximplant/test-call.ts --to +9725XXXXXXXX --from 97237219347 --confirm
 *
 * It places a REAL call and costs money. Nothing runs without --confirm. The
 * payload ({to,from,tok,u}) mirrors the deployed Branch B scenario; `tok`
 * defaults to a fake 32-hex → ctx 404 → the scenario still dials (DTMF-only, no
 * personalization / no Groq) — enough to produce a Voximplant session + log.
 * The payload is NEVER printed (byte count only); the key is never printed.
 */
import { readFileSync } from 'node:fs';

import type { VoximplantConfig } from '../../src/lib/voximplant/core';
import { startScenarios } from '../../src/lib/voximplant/mutations';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '__present__';
}

function loadConfig(): VoximplantConfig {
  const path =
    flag('credentials') && flag('credentials') !== '__present__'
      ? (flag('credentials') as string)
      : process.env.VOXIMPLANT_CREDENTIALS_FILE ??
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
      'ERROR: this places a REAL outbound call and is disabled by default. ' +
        'Re-run with --confirm after explicit approval.',
    );
    process.exitCode = 1;
    return;
  }
  const to = flag('to');
  const from = flag('from');
  const ruleId = flag('rule') ?? '1494311';
  if (!to || to === '__present__' || !from || from === '__present__') {
    console.error('ERROR: --to and --from are required (non-empty).');
    process.exitCode = 1;
    return;
  }
  const tok = flag('tok') && flag('tok') !== '__present__' ? (flag('tok') as string) : '0'.repeat(32);
  const origin =
    flag('origin') && flag('origin') !== '__present__'
      ? (flag('origin') as string)
      : 'https://beta.kalfa.me';

  const payload = JSON.stringify({ to, from, tok, u: origin });
  console.log('=== StartScenarios — LIVE TEST CALL ===');
  console.log(`rule_id                 : ${ruleId}`);
  console.log(`to                      : ${to}`);
  console.log(`from                    : ${from}`);
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
