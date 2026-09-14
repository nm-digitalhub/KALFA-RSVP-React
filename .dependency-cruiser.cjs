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
  },
  {
    // ⚠️ A CYCLE IN THE SCHEDULER CORE IS NOT A STYLE COMPLAINT, and this rule
    // exists because nothing here checked for one. ESM live bindings usually
    // carry a cycle through, so it compiles, bundles and passes every test —
    // and then which module finishes initialising first depends on entry order,
    // and the failure is an undefined import at run time in the worker.
    //
    // Caught on 2026-09-14 by hand, only because a reviewer looked:
    // `enqueue.ts → wake.ts → enqueue.ts`, introduced while splitting the wake
    // CAS out so the worker could reuse it. `wake-store.ts` holds the CAS now
    // and imports neither. `npm run worker:deps` was green throughout.
    name: 'no-circular',
    comment:
      'No import cycles. ESM survives them often enough that a cycle ships green and fails later as an undefined import, in whichever module lost the initialisation race. Break it by moving the shared piece into a module that imports neither side.',
    severity: 'error',
    // `from: {}` is the documented shape for this rule (rules-reference.md), and
    // the empty object is deliberate rather than an omission: the cycle is a
    // property of the path, so there is no useful "from" to narrow it to. The
    // upstream example pairs it with `pathNot: '^(node_modules)'`, which this
    // config does not need — `options.doNotFollow` already stops the cruise at
    // the module boundary, so a dependency's own knots cannot be reported here.
    //
    // VERIFIED by fault injection on 2026-09-14: re-adding the
    // `wake-store → enqueue` edge produced
    // `error no-circular: enqueue.ts → wake-store.ts → enqueue.ts` and
    // `1 dependency violations (1 errors)`. A rule that has never been seen to
    // fail is not yet a guard.
    from: {},
    to: { circular: true },
  }],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
