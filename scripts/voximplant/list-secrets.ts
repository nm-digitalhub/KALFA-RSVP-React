// READ-ONLY: which application secrets exist, by NAME.
//
// ⚠️ `GetSecretValue` IS DELIBERATELY NOT CALLED. GetSecrets returns names with
// the values masked by the API; a value would be a credential on a terminal.
// The only question this answers is "is it set at all" — which is exactly what
// ConsoleInbound's own `KALFA_APP_ORIGIN secret missing` log line raises.
//
//   npx tsx scripts/voximplant/list-secrets.ts [--app 11107202]
//
// Loads credentials the same way every other script here does — the CI
// credentials FILE, never the `server-only` DAL, which cannot be imported
// outside a request.
import { readFileSync } from 'node:fs';

import { voxRequest, type VoximplantConfig } from '@/lib/voximplant/core';

function val(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
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
  const app = val('app') ?? '11107202';
  const res = await voxRequest<{ result?: { secret_id?: number; secret_name?: string }[] }>(
    loadConfig(),
    'GetSecrets',
    { application_id: app },
  );
  const list = res.result ?? [];
  console.log(`סודות באפליקציה ${app}: ${list.length}`);
  for (const s of list) console.log(`  #${s.secret_id ?? '?'}  ${s.secret_name ?? '(ללא שם)'}`);
  for (const want of ['KALFA_APP_ORIGIN', 'KALFA_CONSOLE_SECRET', 'ELEVENLABS_API_KEY']) {
    console.log(`${want.padEnd(22)} ${list.some((s) => s.secret_name === want) ? '✅ קיים' : '❌ חסר'}`);
  }
}

void main();
