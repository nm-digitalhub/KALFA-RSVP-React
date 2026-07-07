#!/usr/bin/env node
// Controlled deployment of the KALFA email-change template via Supabase
// Management API. Dry-run by default; applies only with --apply.
//
// This script PATCHes ONLY:
//   - mailer_subjects_email_change
//   - mailer_templates_email_change_content
//
// It never changes site_url or uri_allow_list.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(ROOT, 'supabase/templates/email_change.html');
const SUBJECT = 'אישור כתובת האימייל החדשה שלך ב־KALFA';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.some((arg) => arg !== '--apply')) {
  fail('Unknown argument. Supported usage: node scripts/deploy-email-change-template.mjs [--apply]');
}

const apply = args.includes('--apply');

// Validate local template before reading credentials or making any network request.
let html;

try {
  html = readFileSync(TEMPLATE_PATH, 'utf8');
} catch {
  fail(`Cannot read template at ${TEMPLATE_PATH}`);
}

const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');

if (activeHtml.includes('{{ .SiteURL }}')) {
  fail('Template uses {{ .SiteURL }}. The active link must use {{ .RedirectTo }}.');
}

if (activeHtml.includes('{{ .ConfirmationURL }}')) {
  fail('Template uses {{ .ConfirmationURL }}. The active link must use token_hash + {{ .RedirectTo }}.');
}

const EXPECTED_HREF =
  '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email_change&next=/app/settings';

const hrefs = [...activeHtml.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const tokenHashHrefs = hrefs.filter((href) => href.includes('token_hash'));

if (tokenHashHrefs.length !== 1) {
  fail(
    `Expected exactly one active href containing token_hash; found ${tokenHashHrefs.length}.`,
  );
}

const decodedHref = tokenHashHrefs[0].replace(/&amp;/g, '&');

if (decodedHref !== EXPECTED_HREF) {
  fail(
    'Email-change link href does not match the exact contract.' +
      `\n  expected (after HTML decode): ${EXPECTED_HREF}` +
      `\n  got:                         ${decodedHref}` +
      '\nAborting.',
  );
}

// Credentials are required only after local validation passes.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();

if (!token) {
  fail('SUPABASE_ACCESS_TOKEN is not set. Supply it through the environment only.');
}

let projectRef = process.env.SUPABASE_PROJECT_REF?.trim();

if (!projectRef) {
  try {
    projectRef = readFileSync(
      join(ROOT, 'supabase/.temp/project-ref'),
      'utf8',
    ).trim();
  } catch {
    fail('Project ref not found. Set SUPABASE_PROJECT_REF or link the Supabase project.');
  }
}

function validatedAppOrigin() {
  const raw = process.env.APP_ORIGIN?.trim();

  if (!raw) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    fail('APP_ORIGIN is not a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('APP_ORIGIN must use http:// or https://.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    fail('APP_ORIGIN must not include credentials.');
  }

  if (
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    fail('APP_ORIGIN must not include a path, query, or fragment.');
  }

  return parsed.origin;
}

function globToRegExp(glob) {
  let expression = '';

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];

    if (character === '*') {
      if (glob[index + 1] === '*') {
        expression += '.*';
        index += 1;
      } else {
        expression += '[^./]*';
      }
    } else if (character === '?') {
      expression += '[^./]';
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${expression}$`);
}

const appOrigin = validatedAppOrigin();
const confirmUrl = appOrigin ? `${appOrigin}/auth/confirm` : null;

const API = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

console.log(`Project:  ${projectRef}`);
console.log(`Template: ${TEMPLATE_PATH} (${html.length} bytes)`);
console.log(`Mode:     ${apply ? 'APPLY' : 'DRY-RUN (no changes)'}\n`);

const getResponse = await fetch(API, { headers: authHeaders });

if (!getResponse.ok) {
  fail(`GET config/auth failed: ${getResponse.status} ${getResponse.statusText}`);
}

const current = await getResponse.json();

const currentSubject = current.mailer_subjects_email_change ?? '(default)';

const currentContent =
  current.mailer_templates_email_change_content ??
  '(default — {{ .ConfirmationURL }})';

const allowList = String(current.uri_allow_list ?? '');

const allowEntries = allowList
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const covered =
  confirmUrl !== null &&
  allowEntries.some(
    (entry) => entry === confirmUrl || globToRegExp(entry).test(confirmUrl),
  );

console.log('--- current remote email-change template ---');
console.log(`subject: ${currentSubject}`);
console.log(
  `content: ${
    currentContent.length > 140
      ? `${currentContent.slice(0, 140)}…`
      : currentContent
  }`,
);
console.log(
  `uses {{ .ConfirmationURL }}? ${currentContent.includes('{{ .ConfirmationURL }}')}`,
);
console.log(
  `routes via token_hash email_change? ${
    currentContent.includes('token_hash') && currentContent.includes('type=email_change')
  }`,
);

const subjectChanged = currentSubject !== SUBJECT;
const contentChanged = currentContent !== html;

console.log('\n--- diff (file vs remote) ---');
console.log(`subject changes: ${subjectChanged}`);
console.log(`content changes: ${contentChanged}`);
console.log(
  '\nWill PATCH ONLY: mailer_subjects_email_change, mailer_templates_email_change_content',
);
console.log(`site_url remains untouched: ${current.site_url}`);

console.log('\n--- redirect allow-list (fail-closed on --apply) ---');
console.log(
  `email-change link target: ${confirmUrl ?? '(APP_ORIGIN not set in environment)'}`,
);
console.log(`remote site_url:        ${current.site_url}`);
console.log(`remote uri_allow_list:  ${allowList || '(empty)'}`);
console.log(`provably covers /auth/confirm? ${covered ? 'yes' : 'no'}`);

if (!apply) {
  console.log('\nDry-run complete. No remote changes were made.');
  process.exit(0);
}

if (!appOrigin) {
  fail(
    'APP_ORIGIN is not set. Cannot verify that /auth/confirm is covered before --apply.',
  );
}

if (allowEntries.length === 0) {
  fail('Remote uri_allow_list is empty. Aborting --apply.');
}

if (!covered) {
  fail(
    `uri_allow_list does not provably cover ${confirmUrl}. ` +
      'Add an appropriate redirect URL before running --apply.',
  );
}

if (!subjectChanged && !contentChanged) {
  console.log('\nRemote template already matches the local file. Nothing to apply.');
  process.exit(0);
}

const patchResponse = await fetch(API, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify({
    mailer_subjects_email_change: SUBJECT,
    mailer_templates_email_change_content: html,
  }),
});

if (!patchResponse.ok) {
  const body = await patchResponse.text().catch(() => '');
  fail(`PATCH failed: ${patchResponse.status} ${patchResponse.statusText} ${body}`);
}

const verifyResponse = await fetch(API, { headers: authHeaders });

if (!verifyResponse.ok) {
  fail(
    `Post-apply GET failed: ${verifyResponse.status} ${verifyResponse.statusText}. Deployment is unverified.`,
  );
}

const after = await verifyResponse.json();

if (after.site_url !== current.site_url) {
  fail(`site_url changed unexpectedly: ${current.site_url} → ${after.site_url}`);
}

if (String(after.uri_allow_list ?? '') !== allowList) {
  fail('uri_allow_list changed unexpectedly during deployment.');
}

if (after.mailer_subjects_email_change !== SUBJECT) {
  fail('Deployed email-change subject does not match the local subject.');
}

if (after.mailer_templates_email_change_content !== html) {
  fail('Deployed email-change template does not match the local file.');
}

console.log(
  '✓ Email-change template deployed and verified: content + subject match; site_url + uri_allow_list unchanged.',
);
