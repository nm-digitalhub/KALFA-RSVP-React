// Read-only SUMIT CRM list (owner-instructed, 2026-08-30): list the most recent
// entities in the "תפיסות מסגרת" (frame holds) folder, with properties loaded,
// to verify hold statuses (2=בוצע חיוב, 3=שוחרר, etc.) after manual releases.
//
//   node --env-file=.env.local dist/sumit-crm-list-holds.cjs

import { getSumitServerConfig } from '@/lib/data/payments';

const FOLDER_ID = '1076735289'; // תפיסות מסגרת

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');
  const creds = { CompanyID: config.companyId, APIKey: config.apiKey };

  const res = await fetch('https://api.sumit.co.il/crm/data/listentities/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Credentials: creds,
      Folder: FOLDER_ID,
      Order: { Property: 'Billing_Date', Descending: true },
      Paging: { StartIndex: 0, PageSize: 15 },
      LoadProperties: true,
    }),
  });
  const json = await res.json();
  console.log('HTTP', res.status);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error('list failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
