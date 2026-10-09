import { defineConfig } from 'orval';

// Generates the typed SUMIT and CardCom clients from each vendor's OpenAPI document:
//   npx orval --config orval.config.ts --project sumit      (or --project cardcom; run one at a time)
//
//   openapi/sumit.openapi.json    --(transformer: known differences from the live API)-->  src/lib/sumit/generated/
//   openapi/cardcom.openapi.json  --(no transformer: the vendor's whole document, split by tag)-->  src/lib/cardcom/generated/
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
});
