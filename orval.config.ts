import { defineConfig } from 'orval';

// Generates the typed SUMIT, CardCom and DNC clients from each vendor's OpenAPI document:
//   npx orval --config orval.config.ts --project sumit      (or --project cardcom / dnc; run one at a time)
//
//   openapi/sumit.openapi.json    --(transformer: known differences from the live API)-->  src/lib/sumit/generated/
//   openapi/cardcom.openapi.json  --(no transformer: the vendor's whole document, split by tag)-->  src/lib/cardcom/generated/
//   openapi/dnc.openapi.json      --(no transformer: written from real responses, see its description)-->  src/lib/dnc/generated/
//
// The output directories are Orval's: `clean` empties them on every run, so nothing hand-written may live there. The
// hand-written parts are src/lib/<provider>/mutator.ts (every call goes through it) and src/lib/sumit/orval/transformer.ts.
// CardCom's client is generated in full, so it holds every operation of CardCom's API, money-moving ones included: the
// application calls only LowProfile Create / GetLpResult and Transactions Transaction (a refund, src/lib/payments/cardcom-*.ts).
export default defineConfig({
  sumit: {
    input: {
      target: './openapi/sumit.openapi.json',
      override: { transformer: './src/lib/sumit/orval/transformer.ts' },
    },
    output: {
      client: 'fetch',
      mode: 'split',
      clean: true,
      target: 'src/lib/sumit/generated/api.ts',
      baseUrl: 'https://api.sumit.co.il',
      override: {
        mutator: { path: 'src/lib/sumit/mutator.ts', name: 'sumitFetch' },
        // getpdf answers with a file, not JSON: its own mutator (the key is the spec's operationId).
        operations: { AccountingDocumentsGetPDF: { mutator: { path: 'src/lib/sumit/mutator.ts', name: 'sumitFetchPdf' } } },
        // The functions resolve with SUMIT's envelope directly; failures are thrown as SumitError by the mutator.
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  cardcom: {
    input: {
      target: './openapi/cardcom.openapi.json',
    },
    output: {
      client: 'fetch',
      mode: 'tags-split',
      schemas: 'src/lib/cardcom/generated/models',
      clean: true,
      target: 'src/lib/cardcom/generated/api.ts',
      baseUrl: 'https://secure.cardcom.solutions',
      override: {
        mutator: { path: 'src/lib/cardcom/mutator.ts', name: 'cardcomFetch' },
        // The functions resolve with CardCom's answer directly; failures of the CALL are thrown as CardcomError.
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  // "אל תתקשר אליי" (the Do-Not-Call registry). No vendor OpenAPI exists: openapi/dnc.openapi.json was written from the
  // authority's PDF and Postman collection and corrected by real responses (openapi/DNC-API/samples/).
  dnc: {
    input: {
      target: './openapi/dnc.openapi.json',
    },
    output: {
      client: 'fetch',
      mode: 'split',
      schemas: 'src/lib/dnc/generated/models',
      clean: true,
      target: 'src/lib/dnc/generated/api.ts',
      // No baseUrl: the two services live on different hosts (path-level `servers` in the spec, which Orval does not
      // read), so each mutator owns its host. Both add the name/token headers from the server environment and throw
      // DncError on a failed call.
      override: {
        mutator: { path: 'src/lib/dnc/mutator.ts', name: 'dncFetch' },
        // Phone-Query: another host, and a sorted gzip body (the key is the spec's operationId).
        operations: { queryPhones: { mutator: { path: 'src/lib/dnc/mutator.ts', name: 'dncQueryFetch' } } },
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
});
