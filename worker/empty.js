// esbuild alias target: server-only / next/headers / next/cache resolve here in
// the worker bundle. The worker only ever calls the request-free (admin-client)
// data functions, so these request-scoped modules are never invoked at runtime.
module.exports = {};
