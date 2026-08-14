module.exports = {
  forbidden: [{
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
