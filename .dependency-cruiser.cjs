module.exports = {
  forbidden: [
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
    // src/components or src/hooks, and none of them is reached from
    // src/lib/owner-agent. A client module reached from
    // server code arrives as a client REFERENCE — on the server every property
    // access on it throws at request time; the agent process has no use for UI
    // or hooks either way.
    //
    // A 'use client' module added OUTSIDE these three directories is not caught
    // here; if one appears, add its directory.
    name: 'owner-agent-no-client-or-ui-modules',
    comment:
      "src/lib/owner-agent/** may not reach src/app, src/components or src/hooks, directly or transitively. Those are the directories every 'use client' module under src/ lives in; dependency-cruiser cannot detect the directive itself, so a new 'use client' module elsewhere must add its directory here.",
    severity: 'error',
    from: { path: '^src/lib/owner-agent/' },
    to: { path: '^src/(app|components|hooks)/', reachable: true },
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
    //
    // ONE DELIBERATE, NARROW EXCEPTION (8.10.2026): cycles that start inside src/lib/cardcom/generated/. That directory is Orval's
    // output of CardCom's whole OpenAPI document (orval.config.ts), and the vendor's own schemas reference each other
    // (`models/banks.ts` <-> `models/banksBranches.ts`). Orval writes those references as `import type`, which the compiler
    // erases, so no module is ever initialised in a cycle at run time - the failure this rule exists for. The files cannot be
    // edited by hand (the directory is emptied on every generation), and the application imports a handful of its functions.
    // `from.pathNot` skips only a cycle whose modules are all in that directory: a cycle that runs through any hand-written module
    // is still reported. VERIFIED by fault injection the same day: a two-module cycle outside the directory still produced
    // `1 dependency violations (1 errors)`.
    from: { pathNot: '^src/lib/cardcom/generated/' },
    to: { circular: true },
  }],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
