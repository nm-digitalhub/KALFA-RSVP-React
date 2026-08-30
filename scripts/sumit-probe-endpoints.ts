// Read-only-intent endpoint discovery (owner-instructed, 2026-08-30): probe a
// list of PLAUSIBLE-BUT-UNDOCUMENTED paths against the live SUMIT API with a
// minimal body ({Credentials} only) to distinguish "route doesn't exist"
// (HTTP 404 / a routing-framework error page) from "route exists but our
// body is incomplete" (a structured JSON business error, e.g. "missing
// required field"). Sends NO real payment/item data to any candidate — this
// is existence probing only, never a real transaction on a guessed endpoint.
//
//   node --env-file=.env.local dist/sumit-probe-endpoints.cjs

import { getSumitServerConfig } from '@/lib/data/payments';

const BASE = 'https://api.sumit.co.il';

const CANDIDATES = [
  // Modules that exist (per swagger) but whose only documented actions are
  // narrow — probing for undocumented siblings in the SAME module.
  '/accounting/customers/get/',
  '/accounting/customers/list/',
  '/accounting/customers/delete/',
  '/accounting/customers/search/',
  '/accounting/documents/update/',
  '/accounting/documents/delete/',
  '/accounting/documents/duplicate/',
  '/accounting/incomeitems/get/',
  '/accounting/incomeitems/update/',
  '/accounting/incomeitems/delete/',
  '/billing/payments/cancel/',
  '/billing/payments/release/',
  '/billing/payments/void/',
  '/billing/payments/update/',
  '/billing/payments/delete/',
  '/billing/payments/refund/',
  '/billing/paymentmethods/get/',
  '/billing/paymentmethods/list/',
  '/creditguy/gateway/cancel/',
  '/creditguy/gateway/void/',
  '/creditguy/gateway/release/',
  '/creditguy/billing/cancel/',
  '/creditguy/billing/release/',
  '/crm/data/search/',
  '/crm/schema/createfolder/',
  // Entirely NEW modules — SUMIT is a full business platform (reports,
  // inventory beyond stock, employees, exports, files) — none of these
  // appear anywhere in the 85 documented paths.
  '/reports/reports/list/',
  '/reports/reports/get/',
  '/reports/reports/run/',
  '/inventory/products/list/',
  '/inventory/products/create/',
  '/employees/employees/list/',
  '/employees/employees/create/',
  '/users/users/list/',
  '/users/users/get/',
  '/exports/exports/create/',
  '/files/files/upload/',
  '/files/files/list/',
  '/expenses/expenses/list/',
  '/expenses/expenses/create/',
  '/triggers/triggers/list/',
  '/triggers/triggers/history/',
  '/webhooks/webhooks/list/',
  '/company/company/getdetails/',
  '/company/settings/get/',
  // Controls — known-REAL documented endpoints, for comparison in this same run.
  '/billing/payments/get/',
  '/billing/payments/charge/',
  '/crm/schema/listfolders/',
];

async function probe(path: string, companyId: number, apiKey: string) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Credentials: { CompanyID: companyId, APIKey: apiKey } }),
    redirect: 'manual', // do NOT silently follow — a 302 IS the "route doesn't exist" signal here
  });
  const text = await res.text();
  let shape: string;
  try {
    const json = JSON.parse(text);
    shape = `JSON status=${JSON.stringify(json.Status)} err=${JSON.stringify(json.UserErrorMessage)}`;
  } catch {
    shape = `NON-JSON (len=${text.length}) ${text.slice(0, 80).replace(/\n/g, ' ')}`;
  }
  console.log(`${res.status} (${res.type})  ${path}  →  ${shape}`);
}

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');
  for (const path of CANDIDATES) {
    await probe(path, config.companyId, config.apiKey);
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
