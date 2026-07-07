#!/usr/bin/env node
// Controlled deploy of the KALFA recovery (password-reset) email template to the
// linked Supabase HOSTED project via the Management API.
//
// Why a script (not config.toml `config push`): the repo's supabase/config.toml
// is the LOCAL-dev config (site_url = http://127.0.0.1:3000). `config push` would
// clobber the remote site_url + redirect URLs. This script PATCHes ONLY the two
// recovery fields and never touches site_url / redirect / any other setting.
//
// Safety model:
//   • Dry-run by DEFAULT — prints the remote-vs-file diff and exits.
//   • Applies ONLY with an explicit `--apply` flag.
//   • Access token is read from the ENVIRONMENT only — never stored in the repo.
//   • Guardrails refuse to deploy a template that violates the /auth/confirm
//     token_hash contract (no {{ .SiteURL }}; must carry token_hash+type+next).
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=<pat> node scripts/deploy-recovery-email-template.mjs            # dry-run
//   SUPABASE_ACCESS_TOKEN=<pat> node scripts/deploy-recovery-email-template.mjs --apply     # apply

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(ROOT, 'supabase/templates/recovery.html');
const SUBJECT = 'איפוס הסיסמה שלך ב־KALFA';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// 1. Load + validate the LOCAL template FIRST — fail fast, no credentials or
// network needed. Guardrails run on the ACTIVE template (HTML comments stripped):
// a comment may mention SiteURL / tokens for documentation without tripping the
// checks, and Supabase renders {{ }} anywhere, so the real <a> body is what
// actually matters.
let html;
try {
  html = readFileSync(TEMPLATE_PATH, 'utf8');
} catch {
  fail(`Cannot read template at ${TEMPLATE_PATH}`);
}
const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
if (activeHtml.includes('{{ .SiteURL }}')) {
  fail('Template link uses {{ .SiteURL }} — the contract requires {{ .RedirectTo }}. Aborting.');
}
// The recovery link must match the EXACT contract — the host comes from
// {{ .RedirectTo }} (never a hardcoded origin), with exact params. Extract the
// <a href> carrying token_hash and compare after decoding &amp; (so both the
// `&` and `&amp;` encodings are accepted, but nothing else is).
const EXPECTED_HREF =
  '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password';
const recoveryHref = [...activeHtml.matchAll(/href="([^"]*)"/g)]
  .map((m) => m[1])
  .find((h) => h.includes('token_hash'));
const hrefDecoded = (recoveryHref ?? '').replace(/&amp;/g, '&');
if (hrefDecoded !== EXPECTED_HREF) {
  fail(
    'Recovery link href does not match the exact contract.' +
      `\n  expected (after HTML-decode): ${EXPECTED_HREF}` +
      `\n  got:                         ${hrefDecoded || '(no token_hash <a href> found)'}` +
      '\nAborting.',
  );
}

// 2. Credentials are only needed for the remote GET/PATCH below.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  fail('SUPABASE_ACCESS_TOKEN is not set — supply it via the environment (never commit it).');
}

let ref = process.env.SUPABASE_PROJECT_REF?.trim();
if (!ref) {
  try {
    ref = readFileSync(join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim();
  } catch {
    fail('Project ref not found — set SUPABASE_PROJECT_REF or link the project.');
  }
}

const apply = process.argv.includes('--apply');
const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

console.log(`Project:  ${ref}`);
console.log(`Template: ${TEMPLATE_PATH} (${html.length} bytes)`);
console.log(`Mode:     ${apply ? 'APPLY' : 'DRY-RUN (no changes)'}\n`);

// 1. Read the remote config FIRST and show the diff.
const getRes = await fetch(API, { headers: authHeaders });
if (!getRes.ok) {
  fail(`GET config/auth failed: ${getRes.status} ${getRes.statusText}`);
}
const current = await getRes.json();
const curSubject = current.mailer_subjects_recovery ?? '(default)';
const curContent = current.mailer_templates_recovery_content ?? '(default — {{ .ConfirmationURL }})';

console.log('--- current remote recovery template ---');
console.log(`subject: ${curSubject}`);
console.log(`content: ${curContent.length > 140 ? curContent.slice(0, 140) + '…' : curContent}`);
console.log(`  uses {{ .SiteURL }}?              ${curContent.includes('{{ .SiteURL }}')}`);
console.log(`  routes via /auth/confirm token_hash? ${curContent.includes('token_hash')}\n`);

const subjectChanged = curSubject !== SUBJECT;
const contentChanged = curContent !== html;
console.log('--- diff (file vs remote) ---');
console.log(`subject changes: ${subjectChanged}`);
console.log(`content changes: ${contentChanged}`);
console.log(`\nWill PATCH ONLY: mailer_subjects_recovery, mailer_templates_recovery_content`);
console.log(`(site_url stays untouched: ${current.site_url})\n`);

// The recovery link's {{ .RedirectTo }} is <APP_ORIGIN>/auth/confirm. If that URL
// is NOT in GoTrue's redirect allow-list, GoTrue silently substitutes site_url and
// the emailed link lands on `/` with the token unconsumed. This script never
// changes the allow-list — but --apply refuses to run unless it can PROVE the exact
// /auth/confirm URL is covered (fail-closed; a warning is not enough).
// APP_ORIGIN must be a bare http(s) origin (mirrors src/lib/url.ts originFromEnv):
// no credentials / path / query / fragment. Unset → null (dry-run tolerates it;
// --apply refuses below). Set-but-invalid → hard fail, never a guessed origin.
function validatedAppOrigin() {
  const raw = process.env.APP_ORIGIN?.trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail('APP_ORIGIN is not a valid absolute URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    fail('APP_ORIGIN must use http:// or https://.');
  }
  if (u.username !== '' || u.password !== '') {
    fail('APP_ORIGIN must not include credentials.');
  }
  if ((u.pathname !== '' && u.pathname !== '/') || u.search !== '' || u.hash !== '') {
    fail('APP_ORIGIN must not include a path, query, or fragment.');
  }
  return u.origin;
}
const appOrigin = validatedAppOrigin();
const confirmUrl = appOrigin ? `${appOrigin}/auth/confirm` : null;
const allowList = String(current.uri_allow_list ?? '');

// GoTrue glob (docs/guides/auth/redirect-urls): separators are `.` AND `/`.
// `*` = a run of non-separators, `**` = anything, `?` = one non-separator.
// Character classes ([a-z], [!a-z]) are treated literally here — conservative, so
// coverage is never OVER-claimed (fail-closed).
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^./]*';
      }
    } else if (c === '?') {
      re += '[^./]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}
const allowEntries = allowList.split(',').map((s) => s.trim()).filter(Boolean);
const covered =
  confirmUrl != null &&
  allowEntries.some((e) => e === confirmUrl || globToRegExp(e).test(confirmUrl));

console.log('--- redirect allow-list (fail-closed on --apply) ---');
console.log(`recovery-link target : ${confirmUrl ?? '(APP_ORIGIN not set in env)'}`);
console.log(`remote site_url      : ${current.site_url}`);
console.log(`remote uri_allow_list: ${allowList || '(empty)'}`);
console.log(`  provably covers /auth/confirm? ${covered ? 'yes' : 'no'}\n`);

if (!apply) {
  console.log('Dry-run complete. Re-run with --apply to deploy.');
  process.exit(0);
}

// --apply enforcement — do NOT rely on the warning above. Refuse unless coverage
// is proven, so we never deploy a template whose link GoTrue would silently
// rewrite to site_url.
if (!appOrigin) {
  fail('APP_ORIGIN is not set — cannot verify the /auth/confirm redirect allow-list. Aborting --apply.');
}
if (allowEntries.length === 0) {
  fail('Remote uri_allow_list is empty — the recovery link would fall back to site_url. Aborting --apply.');
}
if (!covered) {
  fail(
    `uri_allow_list does not provably cover ${confirmUrl} — add it (e.g. "${appOrigin}/**") to the project's redirect URLs first. Aborting --apply.`,
  );
}

if (!subjectChanged && !contentChanged) {
  console.log('Remote already matches the file — nothing to apply.');
  process.exit(0);
}

const patchRes = await fetch(API, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify({
    mailer_subjects_recovery: SUBJECT,
    mailer_templates_recovery_content: html,
  }),
});
if (!patchRes.ok) {
  const body = await patchRes.text().catch(() => '');
  fail(`PATCH failed: ${patchRes.status} ${patchRes.statusText} ${body}`);
}

// Post-apply verification — fail-closed. The PATCH is a partial merge, so re-GET
// and PROVE: the GET itself succeeded; content + subject landed EXACTLY; and no
// collateral change to site_url / uri_allow_list. Any doubt → non-zero exit.
const afterRes = await fetch(API, { headers: authHeaders });
if (!afterRes.ok) {
  fail(
    `Post-apply GET failed (${afterRes.status} ${afterRes.statusText}) — the deploy is UNVERIFIED. Investigate.`,
  );
}
const after = await afterRes.json();
if (after.site_url !== current.site_url) {
  fail(`site_url changed unexpectedly (${current.site_url} → ${after.site_url}) — investigate immediately.`);
}
if (String(after.uri_allow_list ?? '') !== allowList) {
  fail('uri_allow_list changed unexpectedly during the deploy — investigate immediately.');
}
if (after.mailer_templates_recovery_content !== html) {
  fail('Deployed recovery content does not match the file — the PATCH did not land as sent.');
}
if (after.mailer_subjects_recovery !== SUBJECT) {
  fail('Deployed recovery subject does not match the file — the PATCH did not land as sent.');
}
console.log('✓ Recovery template deployed AND verified: content + subject landed; site_url + uri_allow_list intact.');
console.log('Next: run a real end-to-end test email on beta.');
