// One-off SUMIT CRM read (owner-instructed, 2026-08-27): fetch a folder and an
// entity by id. Both endpoints are pure reads (get*). Credentials from
// app_settings via getSumitServerConfig(); never printed.
//
//   PROBE_KIND=folder PROBE_ID=1076735289 node --env-file=.env.local dist/sumit-crm-probe.cjs
//   PROBE_KIND=entity PROBE_ID=2297036470 node --env-file=.env.local dist/sumit-crm-probe.cjs

import { getSumitServerConfig } from '@/lib/data/payments';

const KIND = process.env.PROBE_KIND;
const ID = process.env.PROBE_ID;
if (!KIND || !ID) throw new Error('missing PROBE_KIND / PROBE_ID');

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');
  const creds = { CompanyID: config.companyId, APIKey: config.apiKey };

  const url =
    KIND === 'folder'
      ? 'https://api.sumit.co.il/crm/schema/getfolder/'
      : 'https://api.sumit.co.il/crm/data/getentity/';
  const body =
    KIND === 'folder'
      ? { Credentials: creds, Folder: Number(ID), IncludeProperties: true }
      : { Credentials: creds, EntityID: Number(ID), IncludeFields: true, IncludeIncomingProperties: true };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('HTTP', res.status);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
