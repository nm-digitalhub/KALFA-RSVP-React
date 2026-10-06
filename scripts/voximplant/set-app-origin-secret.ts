// Create the `KALFA_APP_ORIGIN` application secret the console scenarios read.
//
//   npx tsx scripts/voximplant/set-app-origin-secret.ts                 # dry run
//   npx tsx scripts/voximplant/set-app-origin-secret.ts --confirm       # writes
//   npx tsx scripts/voximplant/set-app-origin-secret.ts --confirm --origin https://…
//
// ⚠️ WHY THIS EXISTS — the failure it fixes, measured on 2026-09-14.
//
// A WhatsApp call to +972 3-721-9347 reached Voximplant (session 8429738542,
// rule `incoming`, initiator 173.252.82.20 = Meta) and was rejected with SIP
// 603 in 165 ms. The scenario's own log said why:
//
//   [ConsoleInbound] KALFA_APP_ORIGIN secret missing — every call will be
//                    rejected fail-closed
//   [ConsoleInbound] rejecting fail-closed: gate_refused_code_404
//
// `VoxEngine.getSecretValue('KALFA_APP_ORIGIN')` returned '', so the gate call
// went to a relative URL with no host and 404'd. `GetSecrets` on application
// 11107202 confirms it: ELEVENLABS_API_KEY and KALFA_CONSOLE_SECRET exist, this
// one does not.
//
// ⚠️ AND IT IS NOT A WHATSAPP BUG. ConsoleInbound, ConsoleDial and
// ConsoleCallMeNow all read this secret, and `HOLD_MUSIC_URL` is built from it —
// so today EVERY inbound console call is rejected the same way. The relocation
// wizard sets it as step F6 (docs/relocation-wizard-plan-2026-08-23.md), and
// that wizard has only ever been dry-run.
//
// ⚠️ THE VALUE IS NEVER PRINTED. It is not a credential — it is a public origin
// — but the same discipline as copy-el-secret.ts applies: the script reports
// presence and length, never content. What it DOES print is the origin it is
// about to use, because writing the wrong one is the one mistake worth catching
// before it is made.
import { readFileSync } from 'node:fs';

import { voxRequest, type VoximplantConfig } from '@/lib/voximplant/core';
import { addApplicationSecret } from '@/lib/voximplant/mutations';

const SECRET_NAME = 'KALFA_APP_ORIGIN';
// kalfa-rsvp.kalfarsvp.voximplant.com — the production application that owns
// rule `incoming` (1494687), the one a WhatsApp SIP call lands on.
const DEFAULT_APP = '11107202';
const DEFAULT_ORIGIN = 'https://beta.kalfa.me';

function val(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

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
  const app = val('app') ?? DEFAULT_APP;
  const origin = (val('origin') ?? DEFAULT_ORIGIN).replace(/\/+$/, '');

  // A trailing slash would make every URL a double slash; an origin with a path
  // would silently prefix every gate call. Both are cheap to refuse here and
  // expensive to notice later.
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) {
    console.error(`origin לא תקין: ${origin}`);
    console.error('חייב להיות https:// ומארח בלבד, בלי נתיב ובלי סלאש בסוף.');
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig();

  // Read first: AddSecret errors "not unique" on a name that exists, and a
  // failed write is a worse way to learn that than a clean report.
  const existing = await voxRequest<{ result?: { secret_name?: string }[] }>(cfg, 'GetSecrets', {
    application_id: app,
  });
  const names = (existing.result ?? []).map((s) => s.secret_name);
  console.log(`אפליקציה ${app} — סודות קיימים: ${names.join(', ') || '(אין)'}`);

  if (names.includes(SECRET_NAME)) {
    console.log(`\n${SECRET_NAME} כבר קיים — הסקריפט לא נוגע בו.`);
    console.log('לשינוי ערך קיים משתמשים ב-SetSecretInfo, לא ב-AddSecret.');
    return;
  }

  console.log(`\nיעד : ${SECRET_NAME}`);
  console.log(`ערך : ${origin}`);

  if (!has('confirm')) {
    console.log('\nהרצה יבשה — לא נכתב דבר. להרצה אמיתית הוסיפו --confirm');
    return;
  }

  const res = await addApplicationSecret(cfg, app, SECRET_NAME, origin);
  // ⚠️ Voximplant answers a successful AddSecret with `{result: {secret_id: N}}`,
  // MEASURED 2026-09-14 — not with `1`. The first version of this line tested for
  // `1` and reported a write that had actually succeeded as "unexpected response":
  // the secret existed and the operator was told it might not.
  const r = res.result;
  const ok =
    r === 1 || (typeof r === 'object' && r !== null && typeof r.secret_id === 'number');
  console.log(`\nAddSecret → ${ok ? '✅ נוצר' : `תשובה לא צפויה: ${JSON.stringify(res)}`}`);

  if (ok) {
    console.log('\nהצעד הבא: להתקשר שוב למספר, ואז לשלוף את יומן הסשן —');
    console.log('  npm run voximplant -- history --app 11107202 --days 1');
    console.log('  npm run voximplant -- log --session <id>');
    console.log('הדחייה אמורה להיעלם; מה שנראה אז הוא מה ש-route-inbound מחזיר.');
  }
}

void main();
