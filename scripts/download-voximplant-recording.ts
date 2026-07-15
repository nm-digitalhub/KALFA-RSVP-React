// Download a Voximplant call recording (or any secure voxdata URL) using the
// Management-API service-account JWT. Voximplant records land on secure storage
// (voxdata-*-rec-secure) and return 401 to an anonymous GET — they require an
// `Authorization: Bearer <RS256 JWT>` signed with the same service account used
// for the Management API. This runner REUSES src/lib/voximplant/core.ts's
// signManagementJwt (never hand-rolls the JWT) and NEVER prints the token or key.
//
// Usage:
//   npx tsx scripts/download-voximplant-recording.ts "<record_url>" <out.mp3>
// Service account: env VOX_CI_CREDENTIALS (path to the SA JSON), else
// ./vox_ci_credentials.json — the same file voxengine-ci uses.

import { readFileSync, writeFileSync } from 'node:fs';

import { signManagementJwt, type VoximplantConfig } from '../src/lib/voximplant/core';

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// Read VOX_CI_CREDENTIALS from the process env or, if absent, from .env.local
// (this runner is not started with --env-file). Path only — never log the value.
function resolveKeyPath(): string {
  if (process.env.VOX_CI_CREDENTIALS) return process.env.VOX_CI_CREDENTIALS;
  try {
    const env = readFileSync('.env.local', 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('VOX_CI_CREDENTIALS='));
    if (line) return line.slice('VOX_CI_CREDENTIALS='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* ignore */
  }
  return './vox_ci_credentials.json';
}

async function main(): Promise<void> {
  const url = process.argv[2];
  const out = process.argv[3];
  if (!url || !out) fail('usage: download-voximplant-recording.ts "<url>" <out.mp3>');

  const keyPath = resolveKeyPath();
  let sa: { account_id: number | string; key_id: string; private_key: string };
  try {
    sa = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch {
    fail(`cannot read service-account JSON at ${keyPath}`);
  }
  const config: VoximplantConfig = {
    accountId: sa.account_id,
    keyId: sa.key_id,
    privateKey: sa.private_key,
  };

  const token = signManagementJwt(config);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) fail(`download failed: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(out, buf);
  console.log(`OK: wrote ${buf.length} bytes → ${out} (content-type: ${res.headers.get('content-type') ?? '?'})`);
}

main().catch((e) => fail(String(e)));
