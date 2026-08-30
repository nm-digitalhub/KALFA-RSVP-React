// Read-only SUMIT document lookup (GetDetails, /accounting/documents/getdetails/):
// fetch an existing document by its DocumentID (the "כרטיס"/"תיקייה" number shown
// in the SUMIT UI) and print its status/type — no charge, no mutation. Verified
// against swagger.json's Accounting_Documents_GetDetails_Request: DocumentID
// alone is sufficient (mutually exclusive with DocumentType+DocumentNumber).
//
//   CHECK_DOCUMENT_ID=1076735289 node --env-file=.env.local dist/sumit-doc-getdetails.cjs
//
// Bundle (same pattern as sumit-doc-check):
//   esbuild scripts/sumit-doc-getdetails.ts --bundle --platform=node --format=cjs \
//     --target=node20 --outfile=dist/sumit-doc-getdetails.cjs --tsconfig=tsconfig.json \
//     --alias:server-only=./worker/empty.js --alias:next/headers=./worker/empty.js \
//     --alias:next/navigation=./worker/empty.js --alias:next/cache=./worker/empty.js \
//     --external:pg-native

import { getSumitServerConfig } from '@/lib/data/payments';

const SUMIT_GETDETAILS_URL = 'https://api.sumit.co.il/accounting/documents/getdetails/';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const DOCUMENT_ID = Number(requireEnv('CHECK_DOCUMENT_ID'));

async function main() {
  const config = await getSumitServerConfig();
  if (!config) throw new Error('SUMIT server config missing');

  const res = await fetch(SUMIT_GETDETAILS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Credentials: { CompanyID: config.companyId, APIKey: config.apiKey },
      DocumentID: DOCUMENT_ID,
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
      Document?: {
        ID?: number | null;
        Number?: number | null;
        Type?: string | null;
        Status?: string | null;
        IsDraft?: boolean | null;
        Date?: string | null;
        Total?: number | null;
        VATTotal?: number | null;
        Customer?: { ID?: number | null; ExternalIdentifier?: string | null } | null;
      } | null;
    } | null;
  };
  const r = json as Resp;
  const d = r?.Data?.Document;

  // Safe facts only — never the raw payload (could carry customer PII / tokens).
  console.log(
    `http=${res.status} status=${String(r?.Status)} error=${String(r?.UserErrorMessage)} id=${String(d?.ID)} number=${String(
      d?.Number,
    )} type=${String(d?.Type)} status_field=${String(d?.Status)} is_draft=${String(
      d?.IsDraft,
    )} date=${String(d?.Date)} total=${String(d?.Total)} customer_external_id=${String(
      d?.Customer?.ExternalIdentifier,
    )}`,
  );
}

main().catch((err) => {
  console.error('getdetails failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
