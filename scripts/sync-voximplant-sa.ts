// One-off, idempotent: sync the Voximplant SERVICE-ACCOUNT JSON from the local
// gitignored credentials file into app_settings.voximplant_service_account_json,
// so the /admin/channels Voximplant tab reports the service account as
// configured. The app reads config from the DB (getVoximplantConfig →
// app_settings), NOT from disk — this bridges the committed CLI credential file
// to the DB-backed admin config.
//
// SECURITY: the file holds an RSA private_key. This runner reads it and writes
// the RAW verbatim JSON string to the DB, but NEVER prints private_key (only
// non-secret status: account_id, byte length, serviceAccountConfigured). The
// credentials file itself is gitignored; nothing secret is embedded here.
//
// File resolution mirrors the CLI: --key <path> | env VOX_CI_CREDENTIALS |
// default ./vox_ci_credentials.json (run from the repo root).
//
// Run (server-only/next aliased to empty, env from .env.local):
//   npm run sync:voximplant-sa
// or directly after bundling:
//   node --env-file=.env.local dist/sync-voximplant-sa.cjs

import { readFileSync } from 'node:fs';

import { resolveKeyPath } from '@/lib/voximplant/cli-support';
import { createAdminClient } from '@/lib/supabase/admin';

// Same required-field contract as voximplant-config.ts parseServiceAccount
// (that fn is not exported): account_id (string|number), key_id + private_key
// (non-empty strings). Returns the non-secret account_id for status logging, or
// throws a non-secret error. NEVER returns/logs private_key.
function assertValidServiceAccount(raw: string): { accountId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('credentials file is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('credentials JSON is not an object');
  }
  const p = parsed as {
    account_id?: unknown;
    key_id?: unknown;
    private_key?: unknown;
  };
  const accountIdOk =
    typeof p.account_id === 'string' || typeof p.account_id === 'number';
  const keyIdOk = typeof p.key_id === 'string' && p.key_id.length > 0;
  const privateKeyOk =
    typeof p.private_key === 'string' && p.private_key.length > 0;
  if (!accountIdOk || !keyIdOk || !privateKeyOk) {
    throw new Error(
      'credentials JSON missing a valid account_id / key_id / private_key',
    );
  }
  return { accountId: String(p.account_id) };
}

async function main(): Promise<void> {
  // Resolve the credentials file the same way the CLI does (no hardcoded path).
  const keyFlag = process.argv.includes('--key')
    ? process.argv[process.argv.indexOf('--key') + 1]
    : undefined;
  const keyPath = resolveKeyPath(
    keyFlag ? { key: keyFlag } : {},
    process.env.VOX_CI_CREDENTIALS,
    'vox_ci_credentials.json',
  );

  const raw = readFileSync(keyPath, 'utf8').trim();
  const { accountId } = assertValidServiceAccount(raw); // throws if invalid

  const admin = createAdminClient();
  const { error } = await admin
    .from('app_settings')
    .update({ voximplant_service_account_json: raw })
    .eq('id', true);
  if (error) {
    throw new Error(`DB write failed: ${error.message}`);
  }

  // Verify presence WITHOUT reading the secret back into a log: select the
  // column and report length + configured boolean only.
  const { data, error: readErr } = await admin
    .from('app_settings')
    .select('voximplant_service_account_json')
    .eq('id', true)
    .maybeSingle();
  if (readErr) {
    throw new Error(`verify read failed: ${readErr.message}`);
  }
  const stored = data?.voximplant_service_account_json ?? '';
  const serviceAccountConfigured = stored.length > 0;

  // Non-secret status only.
  console.log('[sync-voximplant-sa] done', {
    source: keyPath,
    accountId, // non-secret account identifier
    bytes: raw.length,
    serviceAccountConfigured,
  });
  if (!serviceAccountConfigured) {
    throw new Error('post-write verification found the column empty');
  }
}

main().catch((e) => {
  console.error(
    '[sync-voximplant-sa] failed:',
    e instanceof Error ? e.message : 'unknown error',
  );
  process.exit(1);
});
