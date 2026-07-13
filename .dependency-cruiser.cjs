module.exports = {
  forbidden: [{
    name: 'worker-no-request-scoped-next',
    comment: 'The pg-boss worker (worker/**) is a long-lived non-request process; it must never (transitively) reach request-scoped Next APIs (next/headers|navigation|cache). Keep the worker send path request-free (admin client) — see resolveSendableContacts.',
    severity: 'error',
    from: { path: '^worker/' },
    to: { path: 'node_modules/next/(headers|navigation|cache)', reachable: true },
  }],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
