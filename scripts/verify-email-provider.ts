/**
 * Proves the live email path end to end, through the REAL production code —
 * getEmailSender(), the app_settings row, the selected transport — rather than
 * a hand-rolled API call that would only prove the vendor works.
 *
 * The recipient is the Microsoft 365 mailbox on purpose. That is a genuinely
 * external hop for the sending provider, so Microsoft evaluates SPF, DKIM and
 * DMARC and stamps the result into `Authentication-Results`. Reading that
 * header back is the only way to see what a real recipient sees.
 *
 * It also carries an attachment, because the traffic this path exists for is
 * the signed agreement, and that is a PDF.
 *
 * Build + run:
 *   npx esbuild scripts/verify-email-provider.ts --bundle --platform=node \
 *     --format=cjs --target=node20 --outfile=dist/verify-email.cjs \
 *     --tsconfig=tsconfig.json --alias:server-only=./worker/empty.js \
 *     --alias:next/headers=./worker/empty.js --alias:next/navigation=./worker/empty.js \
 *     --alias:next/cache=./worker/empty.js --external:pg-native --external:deasync
 *   node --env-file=.env.local dist/verify-email.cjs
 */
import { ClientCertificateCredential } from '@azure/identity';

import { getEmailSender, selectedEmailProvider } from '@/lib/email/sender';

const MAILBOX = 'netanel.kalfa@kalfa.me';
const SUBJECT = 'KALFA — אימות נתיב הדואר';

/** Reads the delivered message's own headers, which is where the verdict is. */
async function readAuthResults(sentAfter: number): Promise<Record<string, string> | null> {
  const cred = new ClientCertificateCredential(
    process.env.MS_GRAPH_TENANT_ID!,
    process.env.MS_GRAPH_CLIENT_ID!,
    { certificatePath: process.env.MS_GRAPH_CERT_PATH! },
  );
  const token = (await cred.getToken('https://graph.microsoft.com/.default')).token;
  const H = { Authorization: `Bearer ${token}` };

  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages` +
        `?$top=10&$select=subject,receivedDateTime,internetMessageHeaders&$orderby=receivedDateTime desc`,
      { headers: H },
    );
    const body = (await res.json()) as {
      value?: { subject?: string; receivedDateTime: string; internetMessageHeaders?: { name: string; value: string }[] }[];
    };
    const hit = (body.value ?? []).find(
      (m) => m.subject === SUBJECT && Date.parse(m.receivedDateTime) > sentAfter,
    );
    if (hit) {
      return Object.fromEntries(
        (hit.internetMessageHeaders ?? []).map((h) => [h.name.toLowerCase(), h.value]),
      );
    }
  }
  return null;
}

async function main() {
  console.log(`ספק פעיל: ${selectedEmailProvider()}`);
  const sender = await getEmailSender();
  const sentAt = Date.now();

  await sender.send({
    to: MAILBOX,
    subject: SUBJECT,
    html: '<p dir="rtl">בדיקת נתיב הדואר של KALFA. אין צורך להשיב.</p>',
    text: 'בדיקת נתיב הדואר של KALFA. אין צורך להשיב.',
    attachments: [
      {
        filename: 'kalfa-probe.pdf',
        content: new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
        contentType: 'application/pdf',
      },
    ],
  });
  console.log('✅ נשלח דרך getEmailSender (עם קובץ מצורף)');

  const headers = await readAuthResults(sentAt);
  if (!headers) {
    console.log('❌ ההודעה לא הגיעה לתיבה תוך שתי דקות');
    process.exit(1);
  }

  const auth = headers['authentication-results'] ?? '';
  const grab = (k: string) => auth.match(new RegExp(`${k}=(\\w+)`))?.[1] ?? '—';

  // A relayed message carries MORE THAN ONE DKIM signature — the sending
  // domain's and the carrier's. Reading only the first reports whichever
  // happened to be written first and hides whether OUR domain signed at all,
  // which is the part that has to align for DMARC.
  const signers = [...auth.matchAll(/header\.d=([^;\s]+)/g)].map((m) => m[1]);

  console.log(`\nReturn-Path : ${headers['return-path'] ?? '—'}`);
  console.log(`From        : ${headers.from ?? '—'}`);
  console.log(`DKIM חותמים : ${signers.length ? signers.join(', ') : '—'}`);
  console.log(`\nמה שמיקרוסופט קבעה:`);
  console.log(`  spf   = ${grab('spf')}`);
  console.log(`  dkim  = ${grab('dkim')}`);
  console.log(`  dmarc = ${grab('dmarc')}`);

  const ok = grab('spf') === 'pass' && grab('dkim') === 'pass' && grab('dmarc') === 'pass';
  console.log(ok ? '\n✅ שלושת האימותים עברו' : '\n❌ לא כל האימותים עברו');
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
