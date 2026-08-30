import { getSumitServerConfig } from '@/lib/data/payments';

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');
  const creds = { CompanyID: config.companyId, APIKey: config.apiKey };

  const res = await fetch('https://api.sumit.co.il/crm/data/listentities/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Credentials: creds,
      Folder: '1076734599',
      Paging: { StartIndex: 0, PageSize: 50 },
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
