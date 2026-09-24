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
    // ⚠️ THE PACKAGE, NOT A FILE. The rule above names `catalogue/schemas.ts` by
    // path, so it cannot see the per-node editor files the one-folder-per-node
    // move creates (`nodes/<name>/schema.ts`, `uischema.ts`, …) — each of which
    // imports SDK runtime values exactly as the vendor starter does. This one
    // names the SDK itself, so whichever editor file a server module reaches,
    // directly or through any chain, the cruise fails.
    //
    // WHAT COUNTS AS SERVER: the worker, the engine and its step handlers, the
    // adapter, the SDK-free half of every node folder (`definition.ts`,
    // `runtime.ts`, `match.ts`), the SDK-free catalogue files, and the server
    // data layers — `src/lib/data` included, because that is exactly where the
    // 2026-09-23 SUMIT client-reference bug came in.
    //
    // `tsPreCompilationDeps` is on, so a TYPE-only SDK import counts too. That is
    // deliberate: the SDK-free files are a contract, and "only a type" is how a
    // value import usually starts.
    name: 'server-code-must-not-reach-the-editor-sdk',
    comment:
      'Server-side workflow code must not reach @workflowbuilder/sdk, directly or transitively. The SDK is browser-only; in the Next server a value from it arrives as a client reference, and in the worker it adds megabytes for nothing. Node folders split for this: definition.ts / runtime.ts / match.ts are SDK-free; schema.ts, uischema.ts, default-properties-data.ts and the palette file are the editor side.',
    severity: 'error',
    from: {
      path: '^(worker/|src/lib/workflow/(steps|engine|adapter)/|src/lib/workflow/nodes/[^/]+/(definition|runtime|match)\\.ts$|src/lib/workflow/catalogue/(types|nodes|arm-check)\\.ts$|src/lib/(data|queue|ops)/)',
    },
    to: { path: '@workflowbuilder/sdk', reachable: true },
  },
  {
    // ⚠️ AN ALLOW-LIST, NOT A DENY-LIST. A step handler reaches the outside world
    // ONLY through the ports on `ctx.deps` — the vendor's own ports-and-adapters
    // shape (`runGraph` is pure; activities are injected), and the reason the
    // editor's dry run can swap every side effect for a recording. Nothing
    // enforced it: the source scans only read the node's own files, so a
    // runtime that imported `@/lib/foo`, which imported `child_process` or a
    // SUMIT client, slipped past them.
    //
    // Measured 2026-09-24: the whole server-side step layer reaches exactly the
    // modules listed in `to.pathNot` below — all pure, no I/O, no core module.
    // Anything else reachable from it, directly or through any chain, fails the
    // cruise. Widening the list is a deliberate, reviewed edit of this rule.
    //
    // FROM: `steps/` and every node-folder file except the four editor-side ones
    // (schema, uischema, defaults, and the palette file named after its folder —
    // `\\1` is the folder name), which `server-code-must-not-reach-the-editor-sdk`
    // already fences off from the server.
    name: 'step-layer-reaches-only-pure-modules',
    comment:
      'A step handler may reach the outside world only through ctx.deps (the ports), so the dry run can swap every side effect. The server-side step layer may therefore reach only the pure modules allow-listed here. To add one, confirm it has no I/O, no core-module and no server-only import, then list it.',
    severity: 'error',
    from: {
      path: '^src/lib/workflow/(steps|nodes)/',
      pathNot:
        '(\\.test\\.tsx?$|^src/lib/workflow/nodes/[^/]+/(schema|uischema|default-properties-data)\\.ts$|^src/lib/workflow/nodes/([^/]+)/\\3\\.ts$)',
    },
    to: {
      pathNot:
        '^(src/lib/workflow/(steps|vendor/workflowbuilder)/|src/lib/workflow/nodes/[^/]+/(?!(schema|uischema|default-properties-data)\\.ts$)|src/lib/workflow/catalogue/types\\.ts$|src/lib/workflow/engine/(ports|wait-signal)\\.ts$|src/lib/workflow/voice-outcome\\.ts$|src/lib/constants\\.ts$|src/lib/integrations/errors\\.ts$|src/lib/sumit/hold-status\\.ts$)',
      reachable: true,
    },
  },
  {
    // The owner WhatsApp agent's read cores (plan §5, stage 5) run outside a
    // request — in the agent process, with a service-role client and no cookie
    // session. The DAL (src/lib/auth/dal.ts) and the request-scoped Next APIs
    // behind it would either throw there or quietly read no session, so the
    // cores must not reach them by any chain. The admin wrappers keep their
    // gates and import the cores — never the other way round.
    //
    // Cruised because `worker:deps` lists src/lib/owner-agent as a root. A rule
    // over a path the cruise never visits is no guard; that is why the root
    // was added in the same change.
    name: 'owner-agent-request-free',
    comment:
      'src/lib/owner-agent/** runs without a request. It may not reach src/lib/auth/dal.ts or next/headers|navigation|cache, directly or transitively. Authorization is resolved server-side by the caller and passed in; the admin wrappers in src/lib/data/admin/ import the cores, not the reverse.',
    severity: 'error',
    from: { path: '^src/lib/owner-agent/' },
    to: {
      path: '(node_modules/next/(headers|navigation|cache)|^src/lib/auth/dal\\.ts$)',
      reachable: true,
    },
  },
  {
    // dependency-cruiser cannot see a 'use client' directive, so this rule fences
    // off the DIRECTORIES that hold them. Measured 2026-09-24 (grep for a
    // leading 'use client' under src/): every such module lives in src/app,
    // src/components, src/hooks or src/lib/workflow, and none of those four is
    // reached from src/lib/owner-agent (42 modules, none under them). A client
    // module reached from server code arrives as a client REFERENCE (see
    // `server-code-must-not-reach-the-editor-schemas` above); the agent process
    // has no use for UI, hooks or the workflow editor either way.
    //
    // A 'use client' module added OUTSIDE these four directories is not caught
    // here; if one appears, add its directory.
    name: 'owner-agent-no-client-or-ui-modules',
    comment:
      "src/lib/owner-agent/** may not reach src/app, src/components, src/hooks or src/lib/workflow, directly or transitively. Those are the directories every 'use client' module under src/ lives in (measured 2026-09-24); dependency-cruiser cannot detect the directive itself, so a new 'use client' module elsewhere must add its directory here.",
    severity: 'error',
    from: { path: '^src/lib/owner-agent/' },
    to: { path: '^src/(app|components|hooks)/|^src/lib/workflow/', reachable: true },
  },
  {
    name: 'worker-no-request-scoped-next',
    comment: 'The pg-boss worker (worker/**) and the CLI scripts (scripts/**) are non-request processes; neither may (transitively) reach request-scoped Next APIs (next/headers|navigation|cache). Keep their send paths request-free (admin client) — see resolveSendableContacts. scripts/ was added 15.8: the rule covered only worker/, so `npm run worker:deps` passed while scripts/fleet-agent-cli.ts pulled the same next/headers chain in through sendPushToUser. A guard over one of two identical entry points is half a guard. src/lib/owner-agent/ was added 24.9 (owner agent plan §5, stage 5): its read cores and its nine Mastra tools (cores/, tools/) will run in the agent process, a third non-request process. `owner-agent-request-free` above already covers the same targets (plus dal.ts) for that path; listing it here too keeps the one rule that names every non-request process complete. The agent\'s two ENTRY POINTS (stage 6) both live under src/lib/owner-agent/: the stdio MCP server (mcp/main.ts → dist/owner-agent-mcp.cjs) and the reply consumer (consumer/main.ts → dist/owner-agent.cjs, pm2 kalfa-owner-agent). So this `from`, `owner-agent-request-free` and the src/lib/owner-agent root of `worker:deps` in package.json cover both with no entry of their own; an entry point added OUTSIDE that directory must be added to all three (a rule over a file the cruise never visits is no guard).',
    severity: 'error',
    from: { path: '^(worker|scripts|src/lib/owner-agent)/' },
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
