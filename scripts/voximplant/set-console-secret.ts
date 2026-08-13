// Provision the KALFA_CONSOLE_SECRET application Secret on kalfa-rsvp.
//
// The console scenarios (ConsoleDial/ConsoleInbound) read it via
// VoxEngine.getSecretValue and send it IN THE POST BODY to the three
// /api/voximplant/console/* gate endpoints, which compare it against
// process.env.KALFA_CONSOLE_SECRET — so the SAME value must live in BOTH
// places. Flow: the owner first appends the value to .env.local, then runs
// this to push it platform-side. Searched first (2026-08-12): consumers exist,
// no provisioner did — this is it, built on copy-el-secret's exact blocks.
//
// Idempotent: if the secret name already exists on the app, reports and exits
// without writing (AddSecret has no upsert; rotation = delete in the panel,
// then re-run). The value is NEVER printed — presence + length only.
//
// Run (owner): npm run set:console-secret -- --confirm
import { readFileSync } from 'node:fs';

import { voxRequest, type VoximplantConfig } from '@/lib/voximplant/core';
import { addApplicationSecret } from '@/lib/voximplant/mutations';

const SECRET_NAME = 'KALFA_CONSOLE_SECRET';
// kalfa-rsvp.kalfarsvp.voximplant.com — the production application.
const APP_ID = '11107202';

function loadConfig(): VoximplantConfig {
  const path =
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

interface GetSecretsResponse {
  result?: Array<{ secret_name?: string }>;
}

async function secretExists(cfg: VoximplantConfig): Promise<boolean> {
  // GetSecrets is read-only and the API masks values — names only.
  const res = await voxRequest<GetSecretsResponse>(cfg, 'GetSecrets', {
    application_id: APP_ID,
  });
  return (res.result ?? []).some((s) => s.secret_name === SECRET_NAME);
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error('mutating op — re-run with --confirm');
  }
  const value = process.env.KALFA_CONSOLE_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'KALFA_CONSOLE_SECRET missing/short in the environment — add it to .env.local first ' +
        '(e.g. a 64-hex value), then re-run',
    );
  }

  const cfg = loadConfig();
  if (await secretExists(cfg)) {
    console.log(`[console-secret] ${SECRET_NAME} already exists on app ${APP_ID} — no change`);
    return;
  }

  await addApplicationSecret(cfg, APP_ID, SECRET_NAME, value);
  const present = await secretExists(cfg);
  console.log('[console-secret] done', {
    app: APP_ID,
    name: SECRET_NAME,
    length: value.length, // length only — NEVER the value
    verifiedPresent: present,
  });
  if (!present) throw new Error('post-write verification did not find the secret');
}

main().catch((e) => {
  console.error('[console-secret] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
