// Read-only SUMIT CRM folder list (owner-instructed, 2026-08-30): find the
// Customers folder id so we can list all SUMIT customer entities.
//   node --env-file=.env.local dist/sumit-crm-list-folders.cjs

import { getSumitServerConfig } from '@/lib/data/payments';

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');
  const creds = { CompanyID: config.companyId, APIKey: config.apiKey };

  const res = await fetch('https://api.sumit.co.il/crm/schema/listfolders/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Credentials: creds }),
  });
  const json = await res.json();
  console.log('HTTP', res.status);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error('list failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
