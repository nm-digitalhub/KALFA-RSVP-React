import { defineConfig } from 'orval';

// Generates the typed SUMIT client from the vendor's OpenAPI document:   npx orval --config orval.config.ts
//
//   openapi/sumit.openapi.json  --(transformer: known differences from the live API)-->  src/lib/sumit/generated/
//
// The output directory is Orval's: `clean` empties it on every run, so nothing hand-written may live there. The
// hand-written parts are src/lib/sumit/mutator.ts (every call goes through it) and src/lib/sumit/orval/transformer.ts.
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
});
