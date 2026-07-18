// Generic one-off email runner: send an HTML file (with optional plain-text
// alternative) through the app's real SMTP transport (getEmailSender →
// app_settings config). Used for operational sends like delivering the
// contract-review report to the owner. No PII/bodies are logged.
//
// Parameters come from the environment (never hardcode recipients — this file
// is committed):
//   SEND_TO=someone@example.com \
//   SEND_SUBJECT="..." \
//   SEND_HTML_FILE=/path/to/body.html \
//   [SEND_TEXT_FILE=/path/to/body.txt] \
//   [SEND_PDF_HTML_FILE=/path/to/doc.html SEND_PDF_NAME=doc.pdf] \
//   node --env-file=.env.local dist/send-email-file.cjs
//
// SEND_PDF_HTML_FILE, when set, is rendered to an A4 PDF with the SAME
// pipeline as the signed agreement (renderAgreementPdf — correct Hebrew BiDi)
// and attached as SEND_PDF_NAME.
//
// Bundle (matches the sync-voximplant-sa pattern in package.json):
//   esbuild scripts/send-email-file.ts --bundle --platform=node --format=cjs \
//     --target=node20 --outfile=dist/send-email-file.cjs --tsconfig=tsconfig.json \
//     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
//     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
//     --external:pg-native

import { readFileSync } from 'node:fs';

import { renderAgreementPdf } from '@/lib/agreements/pdf';
import { getEmailSender, type EmailAttachment } from '@/lib/email/sender';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const TO = requireEnv('SEND_TO');
const SUBJECT = requireEnv('SEND_SUBJECT');
const HTML_FILE = requireEnv('SEND_HTML_FILE');
const TEXT_FILE = process.env.SEND_TEXT_FILE;
const PDF_HTML_FILE = process.env.SEND_PDF_HTML_FILE;
const PDF_NAME = process.env.SEND_PDF_NAME ?? 'document.pdf';

async function main() {
  const html = readFileSync(HTML_FILE, 'utf8');
  const text = TEXT_FILE ? readFileSync(TEXT_FILE, 'utf8') : undefined;

  let attachments: EmailAttachment[] | undefined;
  if (PDF_HTML_FILE) {
    const pdfBytes = await renderAgreementPdf(readFileSync(PDF_HTML_FILE, 'utf8'));
    attachments = [
      { filename: PDF_NAME, content: pdfBytes, contentType: 'application/pdf' },
    ];
  }

  const sender = await getEmailSender();
  await sender.send({ to: TO, subject: SUBJECT, html, text, attachments });
  // Log only non-sensitive routing facts — never the body.
  console.log(
    `sent: subject="${SUBJECT}" to=${TO} htmlBytes=${html.length}` +
      (attachments ? ` pdf=${PDF_NAME} (${attachments[0].content.length}B)` : ''),
  );
}

main().catch((err) => {
  console.error('send failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
