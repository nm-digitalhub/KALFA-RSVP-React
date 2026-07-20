// Copy the ELEVENLABS_API_KEY application Secret between Voximplant apps —
// one-time promotion op (kalfatest → kalfa-rsvp, 2026-07-20).
//
//   npm run copy:el-secret -- --confirm
//   npm run copy:el-secret -- --from-app 11107302 --to-app 11107202 --confirm
//
// Reads the secret from the source application via GetSecretValue and writes it
// to the target application via AddSecret (Management API "Secrets" folder).
// The value is held in memory only — NEVER printed, logged, or persisted. On
// success the script reports presence ("copied") and byte length parity only.
//
// Reuses the committed client (src/lib/voximplant/{core,mutations}) — no
// hand-rolled JWT/fetch. Bundled via esbuild like bridge-test-call.ts and run
// with `--env-file=.env.local`.

import { readFileSync } from 'node:fs';

import { voxRequest, type VoximplantConfig } from '@/lib/voximplant/core';
import {
  addApplicationSecret,
  getApplicationSecretValue,
} from '@/lib/voximplant/mutations';

const SECRET_NAME = 'ELEVENLABS_API_KEY';
// kalfatest.kalfarsvp.voximplant.com — where the secret was created for the bridge PoC.
const DEFAULT_FROM_APP = '11107302';
// kalfa-rsvp.kalfarsvp.voximplant.com — the production application (rule OutCallAgent).
const DEFAULT_TO_APP = '11107202';

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

// GetSecrets — read-only, values MASKED by the API; prints names only. Used to
// establish where the secret already exists (AddSecret errors "not unique").
interface SecretListItem {
  secret_name?: string;
}
interface GetSecretsResponse {
  result?: SecretListItem[];
}
async function listSecretNames(cfg: VoximplantConfig, appId: string): Promise<string[]> {
  const res = await voxRequest<GetSecretsResponse>(cfg, 'GetSecrets', {
    application_id: appId,
  });
  return (res.result ?? []).map((s) => s.secret_name ?? '(unnamed)');
}

async function main(): Promise<void> {
  if (flag('check') === '__present__') {
    const cfg = loadConfig();
    const fromApp = val('from-app') ?? DEFAULT_FROM_APP;
    const toApp = val('to-app') ?? DEFAULT_TO_APP;
    for (const app of [fromApp, toApp]) {
      const names = await listSecretNames(cfg, app);
      console.log(`app ${app} secrets: ${names.length ? names.join(', ') : '(none)'}`);
    }
    // When the secret exists on BOTH apps, compare the VALUES in memory only —
    // "identical"/"DIFFERENT" is printed, never a value or a hash of one.
    const extract = (r: Awaited<ReturnType<typeof getApplicationSecretValue>>): string =>
      (typeof r.result === 'object' && r.result?.secret_value) || r.secret_value || '';
    const [a, b] = await Promise.all([
      getApplicationSecretValue(cfg, fromApp, SECRET_NAME).then(extract).catch(() => ''),
      getApplicationSecretValue(cfg, toApp, SECRET_NAME).then(extract).catch(() => ''),
    ]);
    if (a && b) {
      console.log(`${SECRET_NAME} values: ${a === b ? 'identical on both apps' : 'DIFFERENT between apps'}`);
    } else {
      console.log(`${SECRET_NAME} value comparison skipped (missing on ${!a ? fromApp : toApp})`);
    }
    return;
  }
  if (flag('confirm') !== '__present__') {
    console.error(
      'ERROR: this writes an application Secret on the live Voximplant account. ' +
        'Re-run with --confirm after approval.',
    );
    process.exitCode = 1;
    return;
  }
  const fromApp = val('from-app') ?? DEFAULT_FROM_APP;
  const toApp = val('to-app') ?? DEFAULT_TO_APP;
  if (fromApp === toApp) {
    console.error('ERROR: --from-app and --to-app must differ.');
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();
  const read = await getApplicationSecretValue(cfg, fromApp, SECRET_NAME);
  const value =
    (typeof read.result === 'object' && read.result?.secret_value) ||
    read.secret_value ||
    '';
  if (!value) {
    console.error(
      `ERROR: GetSecretValue returned no value for ${SECRET_NAME} on application ${fromApp}.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`source secret           : present (${Buffer.byteLength(value, 'utf8')} bytes, value withheld)`);

  const added = await addApplicationSecret(cfg, toApp, SECRET_NAME, value);
  const ok =
    added.result === 1 ||
    (typeof added.result === 'object' && added.result !== null);
  console.log(`AddSecret → app ${toApp} : ${ok ? 'copied' : `unexpected result ${JSON.stringify(added.result)}`}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
