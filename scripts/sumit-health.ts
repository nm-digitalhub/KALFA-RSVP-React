// Run the SUMIT connection check once, by hand, and print the verdict.
//   npm run sumit:health
//
// Read-only: one POST to website/companies/getdetails/, which takes nothing but the
// credentials. Nothing is charged, no document is created, no customer data is read.
// Same code path the panel uses, so a green result here is evidence about the page.
//
// The API key never reaches stdout — health.ts drops it by construction and its tests
// assert that.

import { getSumitServerConfig } from '@/lib/data/payments';
import { checkSumitHealth } from '@/lib/sumit/health';

async function main() {
  const config = await getSumitServerConfig();
  if (!config) {
    console.log('outcome:   not configured (no SUMIT credentials stored)');
    return;
  }
  const started = Date.now();
  const health = await checkSumitHealth({ companyId: String(config.companyId), apiKey: config.apiKey });
  const seconds = ((Date.now() - started) / 1000).toFixed(2);

  console.log(`outcome:   ${health.ok ? 'ok' : 'failed'}  (${seconds}s)`);
  if (!health.ok) {
    console.log(`kind:      ${health.kind}`);
    console.log(`message:   ${health.message}`);
    return;
  }
  console.log(`company:   ${health.companyName ?? '—'}`);
  console.log(`tax id:    ${health.corporateNumber ?? '—'}`);
  console.log(`doc email: ${health.documentsEmail ?? '—'}`);
}

main().catch((e) => {
  console.error('sumit health check could not run:', e instanceof Error ? e.message : e);
  process.exit(1);
});
