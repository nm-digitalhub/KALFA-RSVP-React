// Controlled SUMIT document check (the admin/sumit-test route-B engine, run
// server-side): place a small J4 charge on a campaign's SAVED card token —
// exactly the production capture.ts wire shape (VATRate:null → company-default
// balances the document) — then download the produced receipt PDF so it can be
// inspected (osek-patur gate: the receipt must carry NO VAT line).
//
// The saved token / expiry / CitizenID are read server-side from the campaign
// row and NEVER printed or written anywhere; only non-sensitive routing facts
// are logged. Admin/off-band tool — run only with the owner's explicit
// instruction (real money moves).
//
//   CHECK_CAMPAIGN_ID=<uuid> [CHECK_AMOUNT=1] [CHECK_EMAIL=you@example.com] \
//   CHECK_OUT_PDF=/path/receipt.pdf \
//   node --env-file=.env.local dist/sumit-doc-check.cjs
//
// Bundle (same pattern as send-email-file):
//   esbuild scripts/sumit-doc-check.ts --bundle --platform=node --format=cjs \
//     --target=node20 --outfile=dist/sumit-doc-check.cjs --tsconfig=tsconfig.json \
//     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
//     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
//     --external:pg-native

import { writeFileSync } from 'node:fs';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSumitServerConfig } from '@/lib/data/payments';
import { chargeRaw } from '@/lib/sumit/raw-charge';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const CAMPAIGN_ID = requireEnv('CHECK_CAMPAIGN_ID');
const AMOUNT = process.env.CHECK_AMOUNT ?? '1';
const EMAIL = process.env.CHECK_EMAIL ?? '';
const OUT_PDF = requireEnv('CHECK_OUT_PDF');

async function main() {
  const admin = createAdminClient();
  const { data: c, error } = await admin
    .from('campaigns')
    .select(
      'id, capture_status, card_token_ref, card_exp_month, card_exp_year, card_citizen_id',
    )
    .eq('id', CAMPAIGN_ID)
    .maybeSingle();
  if (error || !c) throw new Error('campaign not found');
  if (
    c.capture_status !== 'authorized' ||
    !c.card_token_ref ||
    c.card_exp_month == null ||
    c.card_exp_year == null ||
    !c.card_citizen_id
  ) {
    throw new Error('campaign has no complete saved card (capture_status/token/expiry/citizen_id)');
  }

  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');

  const result = await chargeRaw({
    companyId: config.companyId,
    apiKey: config.apiKey,
    savedCardToken: c.card_token_ref,
    savedCardExpMonth: c.card_exp_month,
    savedCardExpYear: c.card_exp_year,
    savedCardCitizenId: c.card_citizen_id,
    amount: AMOUNT,
    vatRate: '18', // ignored on the saved-token path (explicit null is sent — production semantics)
    autoCapture: true, // J4 — a real small charge, so a real document is produced
    customerEmail: EMAIL || undefined,
    externalId: `doc-check-${Date.now()}`,
  });

  type Resp = {
    Status?: number | string | null;
    Data?: {
      Payment?: { ValidPayment?: boolean | null; Amount?: number | null } | null;
      DocumentID?: number | null;
      DocumentNumber?: number | null;
      DocumentDownloadURL?: string | null;
    } | null;
  };
  const raw = result.raw as Resp;
  const valid = raw?.Data?.Payment?.ValidPayment === true;
  const docId = raw?.Data?.DocumentID ?? null;
  const docNum = raw?.Data?.DocumentNumber ?? null;
  const docUrl = raw?.Data?.DocumentDownloadURL ?? null;

  // Safe facts only — never the token/AuthNumber/CitizenID/URL.
  console.log(
    `charge: http=${result.httpStatus} status=${String(raw?.Status)} valid_payment=${String(
      valid,
    )} amount=${AMOUNT} document_id=${String(docId)} document_number=${String(docNum)} has_doc_url=${String(
      !!docUrl,
    )}`,
  );
  if (!valid) throw new Error('charge not confirmed — no document to inspect');
  if (!docUrl) throw new Error('no DocumentDownloadURL in response');

  const pdfRes = await fetch(docUrl);
  if (!pdfRes.ok) throw new Error(`document download failed (http ${pdfRes.status})`);
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  writeFileSync(OUT_PDF, bytes);
  console.log(`receipt saved: ${OUT_PDF} (${bytes.length}B)`);
}

main().catch((err) => {
  console.error('doc-check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
