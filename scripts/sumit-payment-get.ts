// Read-only SUMIT payment lookup (/billing/payments/get/): fetch an existing
// payment/authorization by PaymentID — no charge, no mutation. Per
// swagger.json: "PaymentID — Returned from the BeginRedirect or the Charge API
// methods."
//
//   CHECK_PAYMENT_ID=2297030749 node --env-file=.env.local dist/sumit-payment-get.cjs
//
// Bundle:
//   esbuild scripts/sumit-payment-get.ts --bundle --platform=node --format=cjs \
//     --target=node20 --outfile=dist/sumit-payment-get.cjs --tsconfig=tsconfig.json \
//     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
//     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
//     --external:pg-native

import { getSumitServerConfig } from '@/lib/data/payments';

const SUMIT_PAYMENTS_GET_URL = 'https://api.sumit.co.il/billing/payments/get/';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const PAYMENT_ID = Number(requireEnv('CHECK_PAYMENT_ID'));

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');

  const res = await fetch(SUMIT_PAYMENTS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Credentials: { CompanyID: config.companyId, APIKey: config.apiKey },
      PaymentID: PAYMENT_ID,
    }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  type Resp = {
    Status?: number | string | { IsError?: boolean } | null;
    UserErrorMessage?: string | null;
    Data?: {
      Payment?: {
        ID?: number | null;
        CustomerID?: number | null;
        Date?: string | null;
        ValidPayment?: boolean | null;
        Status?: string | null;
        StatusDescription?: string | null;
        Amount?: number | null;
      } | null;
    } | null;
  };
  const r = json as Resp;
  const p = r?.Data?.Payment;

  // Safe facts only — never the raw payload (could carry customer PII / tokens).
  console.log(
    `http=${res.status} status=${String(r?.Status)} error=${String(r?.UserErrorMessage)} id=${String(
      p?.ID,
    )} customer_id=${String(p?.CustomerID)} date=${String(p?.Date)} valid=${String(
      p?.ValidPayment,
    )} payment_status=${String(p?.Status)} status_desc=${String(p?.StatusDescription)} amount=${String(
      p?.Amount,
    )}`,
  );
}

main().catch((err) => {
  console.error('payment-get failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
