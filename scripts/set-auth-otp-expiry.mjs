#!/usr/bin/env node
// Controlled change of the email link/OTP expiry on the linked Supabase HOSTED
// project via the Management API.
//
// mailer_otp_exp is ONE value covering EVERY emailed link — signup confirmation,
// password recovery, email change, magic link, invite. Supabase exposes no
// per-flow expiry (the project's auth config carries only mailer_otp_exp and
// sms_otp_exp), so raising it to survive an overnight signup also lengthens how
// long a password-reset link stays usable in an inbox. Supabase's production
// checklist recommends 3600 or less; going above it is a deliberate owner
// decision, which is why this script states the trade-off and defaults to a
// dry run.
//
// Rollback is this same script with the previous number.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=<pat> node scripts/set-auth-otp-expiry.mjs 86400           # dry-run
//   SUPABASE_ACCESS_TOKEN=<pat> node scripts/set-auth-otp-expiry.mjs 86400 --apply   # apply

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const raw = process.argv.slice(2).find((a) => /^\d+$/.test(a));
if (!raw) fail('Usage: set-auth-otp-expiry.mjs <seconds> [--apply]');
const seconds = Number(raw);

// GoTrue rejects values below 60; 24h is the longest this script will set —
// beyond a day an emailed link is no longer "recent" in any useful sense, and a
// typo in seconds should not silently become a month.
if (seconds < 60 || seconds > 86400) {
  fail(`Refusing ${seconds}s — allowed range is 60..86400 (24h).`);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) fail('SUPABASE_ACCESS_TOKEN is not set — supply it via the environment.');

let ref = process.env.SUPABASE_PROJECT_REF?.trim();
if (!ref) {
  try {
    ref = readFileSync(join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim();
  } catch {
    fail('Project ref not found — set SUPABASE_PROJECT_REF or link the project.');
  }
}

const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const getRes = await fetch(API, { headers });
if (!getRes.ok) fail(`GET config/auth failed: ${getRes.status} ${getRes.statusText}`);
const current = await getRes.json();

const hours = (s) => `${s}s (${(s / 3600).toFixed(2)}h)`;
console.log(`Project: ${ref}`);
console.log(`Mode:    ${apply ? 'APPLY' : 'DRY-RUN (no changes)'}\n`);
console.log('--- mailer_otp_exp ---');
console.log(`current: ${hours(current.mailer_otp_exp)}`);
console.log(`new:     ${hours(seconds)}\n`);
console.log('Affects EVERY emailed link, not just signup:');
console.log('  signup confirmation · password recovery · email change · magic link · invite');
if (seconds > 3600) {
  console.log(
    `\n! Above Supabase's recommended ceiling of 3600s. A password-reset link will stay\n` +
      `  usable for ${(seconds / 3600).toFixed(0)}h in whatever inbox holds it.`,
  );
}
console.log(`\nWill PATCH ONLY: mailer_otp_exp  (site_url stays ${current.site_url})\n`);

if (current.mailer_otp_exp === seconds) {
  console.log('Remote already matches — nothing to do.');
  process.exit(0);
}
if (!apply) {
  console.log('Dry-run complete. Re-run with --apply to change it.');
  process.exit(0);
}

const patchRes = await fetch(API, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ mailer_otp_exp: seconds }),
});
if (!patchRes.ok) {
  const body = await patchRes.text().catch(() => '');
  fail(`PATCH failed: ${patchRes.status} ${patchRes.statusText} ${body}`);
}

// Fail-closed verification: the PATCH is a partial merge, so re-GET and PROVE
// the value landed and that nothing adjacent moved with it.
const afterRes = await fetch(API, { headers });
if (!afterRes.ok) {
  fail(`Post-apply GET failed (${afterRes.status}) — the change is UNVERIFIED. Investigate.`);
}
const after = await afterRes.json();
if (after.mailer_otp_exp !== seconds) {
  fail(`Deployed value is ${after.mailer_otp_exp}, expected ${seconds} — the PATCH did not land.`);
}
if (after.site_url !== current.site_url) {
  fail(`site_url changed unexpectedly (${current.site_url} → ${after.site_url}) — investigate.`);
}
if (String(after.uri_allow_list ?? '') !== String(current.uri_allow_list ?? '')) {
  fail('uri_allow_list changed unexpectedly during the change — investigate.');
}
console.log(`✓ mailer_otp_exp is now ${hours(after.mailer_otp_exp)}; site_url + uri_allow_list intact.`);
console.log(`  Rollback: node scripts/set-auth-otp-expiry.mjs ${current.mailer_otp_exp} --apply`);
