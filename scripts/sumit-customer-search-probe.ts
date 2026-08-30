// One-off SUMIT probe (owner-instructed, 2026-08-27): does SearchMode=EmailAddress
// find an existing customer by email? Uses /accounting/customers/create/ — the ONLY
// endpoint that honours SearchMode — but deliberately sends NO `Name`, which the
// spec says is "Required for creating new customer (Leave empty to search by other
// fields)". So this call can only FIND, never CREATE: an unmatched email should come
// back as an error, not a new customer record.
//
// Credentials come from app_settings via getSumitServerConfig() (same as
// sumit-doc-check.ts) and are never printed. Only the response shape is logged.
//
//   PROBE_EMAIL=someone@example.com node --env-file=.env.local dist/sumit-customer-search-probe.cjs

import { getSumitServerConfig } from '@/lib/data/payments';

const EMAIL = process.env.PROBE_EMAIL;
if (!EMAIL) throw new Error('missing PROBE_EMAIL');

// Wire format: numeric enums, per SUMIT's own examples + the 2026-07-01 live capture.
// EmailAddress (6) in Accounting_Typed_CustomerSearchMode.
const SEARCH_MODE_EMAIL = 6;

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');

  const body = {
    Credentials: { CompanyID: config.companyId, APIKey: config.apiKey },
    Details: {
      SearchMode: SEARCH_MODE_EMAIL,
      EmailAddress: EMAIL,
      // NO Name → search-only; creation is impossible without it (spec).
    },
  };

  const res = await fetch('https://api.sumit.co.il/accounting/customers/create/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json: unknown = await res.json();
  // Print the full response — it carries no secrets (no token/PAN), only
  // Status/UserErrorMessage/Data{CustomerID, CustomerHistoryURL}.
  console.log('HTTP', res.status);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
