/**
 * Voximplant — READ-ONLY verification of the session-log download path (A4).
 *
 * Given a call_session_history_id, this fetches the session's log_file_url via
 * GetCallHistory(with_other_resources) and runs the SAME SSRF-hardened
 * downloadLogFile() the export job uses — verifying the two genuine unknowns:
 *   (1) does the log host match the allowlist?  (2) is a JWT required?
 * Reuses core.ts + log-download.ts (no hand-rolled JWT/fetch). Never places a
 * call, never prints the key. Prints only metadata (host, size, sha256, auth).
 *
 *   npx tsx scripts/voximplant/fetch-session-log.ts --session 6863133650 [--days 7]
 */
import { createHash, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  getCallHistory,
  signManagementJwt,
  type VoximplantConfig,
} from '../../src/lib/voximplant/core';
import { downloadLogFile, validateLogUrl } from '../../src/lib/voximplant/log-download';
import { normalizeSessionLogPointer } from '../../src/lib/validation/vox-payloads';

void createHash;
void createSign;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function loadConfig(): VoximplantConfig {
  const path =
    flag('credentials') ??
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

const pad = (n: number) => String(n).padStart(2, '0');
const fmtUTC = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

async function main(): Promise<void> {
  const session = flag('session');
  if (!session) {
    console.error('ERROR: --session <call_session_history_id> is required.');
    process.exitCode = 1;
    return;
  }
  const days = flag('days') ? Number(flag('days')) : 7;
  const cfg = loadConfig();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);

  console.log(`=== session ${session} — log lookup ===`);
  const hist = await getCallHistory(cfg, {
    from_date: fmtUTC(from),
    to_date: fmtUTC(to),
    call_session_history_id: Number(session),
    with_other_resources: true,
    with_records: true,
  });
  const sessions = hist.result ?? [];
  console.log(`sessions returned       : ${sessions.length}`);
  if (sessions.length === 0) {
    console.log('(no session yet — the call may still be in progress; retry in a bit)');
    return;
  }
  const ptr = normalizeSessionLogPointer(sessions[0]);
  const logUrl = ptr.logFileUrl;
  console.log(`log_file_url present    : ${logUrl ? 'yes' : 'no'}`);
  if (!logUrl) {
    console.log('(no log_file_url — the log may not be generated yet, or the session ended abnormally)');
    return;
  }

  // Verify unknown #1: does the host match the allowlist?
  let host = '';
  try {
    host = new URL(logUrl).hostname;
  } catch {
    /* ignore */
  }
  const check = validateLogUrl(logUrl);
  console.log(`log host                : ${host}`);
  console.log(`host allowlisted        : ${check.ok ? 'YES ✓' : `NO ✗ (${check.reason})`}`);

  if (!check.ok) {
    console.log(
      '\n>>> ACTION: the real log host is NOT in the allowlist. Add it to ' +
        'LOG_HOST_EXTRA (or widen LOG_HOST_PATTERN) in src/lib/voximplant/log-download.ts.',
    );
    return;
  }

  // Verify unknown #2 + the full download: anon-first, JWT only on 401.
  const dl = await downloadLogFile(logUrl, { jwtProvider: () => signManagementJwt(cfg) });
  if (!dl.ok) {
    console.log(`download                : FAILED (${dl.reason}${dl.status ? ` ${dl.status}` : ''})`);
    process.exitCode = 1;
    return;
  }
  const sha = createHash('sha256').update(dl.bytes).digest('hex');
  console.log(`download                : OK ✓`);
  console.log(`  auth used (JWT?)      : ${dl.authUsed ? 'yes (needed a JWT)' : 'no (anonymous)'}`);
  console.log(`  content_type          : ${dl.contentType || '(none)'}`);
  console.log(`  size_bytes            : ${dl.bytes.byteLength}`);
  console.log(`  sha256                : ${sha}`);
  console.log('\n>>> The A4 log-download path is verified end-to-end against a real log.');
}

main().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
