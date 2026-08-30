// Owner-instructed one-off (2026-08-30): charge ₪1 on an EXISTING saved card
// token (a fresh J4, AutoCapture:true — mirrors production capture.ts exactly),
// to hand SUMIT support the exact request/response for their review. Reuses
// raw-charge.ts's chargeRaw — never a bespoke fetch. Token/expiry/CitizenID come
// from env vars ONLY (never hardcoded, never written to a file) and are NOT
// printed in the echoed request body (redacted below); the response IS printed
// in full because that's the artifact requested.
//
//   CHARGE_TOKEN=<uuid> CHARGE_EXP_MONTH=4 CHARGE_EXP_YEAR=2030 \
//   CHARGE_CITIZEN_ID=<id> CHARGE_AMOUNT=1 \
//   node --env-file=.env.local dist/sumit-charge-token.cjs

import { getSumitServerConfig } from '@/lib/data/payments';
import { chargeRaw } from '@/lib/sumit/raw-charge';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const TOKEN = requireEnv('CHARGE_TOKEN');
const EXP_MONTH = Number(requireEnv('CHARGE_EXP_MONTH'));
const EXP_YEAR = Number(requireEnv('CHARGE_EXP_YEAR'));
const CITIZEN_ID = requireEnv('CHARGE_CITIZEN_ID');
const AMOUNT = process.env.CHARGE_AMOUNT ?? '1';
const CUSTOMER_ID = process.env.CHARGE_CUSTOMER_ID
  ? Number(process.env.CHARGE_CUSTOMER_ID)
  : undefined;

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');

  const result = await chargeRaw({
    companyId: config.companyId,
    apiKey: config.apiKey,
    savedCardToken: TOKEN,
    savedCardExpMonth: EXP_MONTH,
    savedCardExpYear: EXP_YEAR,
    savedCardCitizenId: CITIZEN_ID,
    amount: AMOUNT,
    vatRate: '18', // ignored on the saved-token path (explicit null is sent)
    autoCapture: true, // J4 — a real charge
    externalId: `owner-charge-${Date.now()}`,
    customerId: CUSTOMER_ID,
  });

  console.log('=== REQUEST SENT (Credentials redacted) ===');
  console.log(JSON.stringify(result.sentBody, null, 2));
  console.log('=== RESPONSE (HTTP ' + result.httpStatus + ') ===');
  console.log(JSON.stringify(result.raw, null, 2));
}

main().catch((err) => {
  console.error('charge failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
