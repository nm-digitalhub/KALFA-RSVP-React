module.exports = {
  forbidden: [
    {
      // ⚠️ THE RULE A PRODUCTION OUTAGE BOUGHT (2026-09-14).
      //
      // `src/lib/workflow/catalogue/schemas.ts` imports runtime values from
      // `@workflowbuilder/sdk` and is reached from a `'use client'` editor, so
      // Next compiles it into the CLIENT module graph. A server module that
      // imports it does not receive the values — it receives a client REFERENCE,
      // and every property access on it throws at request time:
      //
      //   TypeError: PALETTE_ITEMS.find is not a function
      //
      // `tsc` accepts it (the import is perfectly typed), vitest accepts it (no
      // Next bundling), and the pre-existing worker rule never looked here. The
      // result was that arming ANY workflow 500'd in production while every gate
      // was green.
      //
      // The catalogue's SDK-free half (`types.ts`, `nodes.ts`) is what server
      // code reads instead — the same split `nodes.ts` documents for the worker.
      name: 'server-code-must-not-reach-the-editor-schemas',
      comment:
        'Server-side workflow code must not import catalogue/schemas.ts — it lives in the client graph and resolves to a client reference on the server. Read NODE_REQUIRED_FIELDS / NODE_NUMBER_RANGES from catalogue/types.ts instead.',
      severity: 'error',
      from: { path: '^src/lib/(workflow|data|queue|ops)/' },
      to: { path: '^src/lib/workflow/catalogue/schemas\\.ts$', reachable: true },
    },
{
    name: 'worker-no-request-scoped-next',
    comment: 'The pg-boss worker (worker/**) and the CLI scripts (scripts/**) are non-request processes; neither may (transitively) reach request-scoped Next APIs (next/headers|navigation|cache). Keep their send paths request-free (admin client) — see resolveSendableContacts. scripts/ was added 15.8: the rule covered only worker/, so `npm run worker:deps` passed while scripts/fleet-agent-cli.ts pulled the same next/headers chain in through sendPushToUser. A guard over one of two identical entry points is half a guard.',
    severity: 'error',
    from: { path: '^(worker|scripts)/' },
    to: { path: 'node_modules/next/(headers|navigation|cache)', reachable: true },
  }],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
