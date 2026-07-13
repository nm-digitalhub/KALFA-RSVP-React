// worker/empty.js — shared alias target for server-only / next/headers /
// next/navigation / next/cache in the esbuild worker bundle (worker:build).
// The worker is a long-lived NON-request process, so these request-scoped Next
// APIs can never run here. This stub throws a CLEAR, actionable error the moment
// one is actually CALLED (not merely imported), replacing the cryptic
// "(0, import_headers.cookies) is not a function" from the 2026-07-13 incident.
//
// Why a Proxy with ownKeys (not module.exports = {}): esbuild's __toESM/
// __copyProps forwards keys by iterating Object.getOwnPropertyNames(stub); an
// empty object (or a bare get-trap Proxy, which reports no own keys) forwards
// nothing, so the imported binding is `undefined` and calling it gives the
// cryptic error. ownKeys/getOwnPropertyDescriptor expose the request-scoped
// export names so the forwarded getter reaches this get trap and returns a
// function that throws on call.
'use strict';

const HINT =
  "is a request-scoped Next.js API and cannot run in the long-lived kalfa-worker " +
  "process (no request/render context). The code path that reached it must be " +
  "request-free — use createAdminClient()/admin data functions instead of " +
  "cookies()/headers()/draftMode()/redirect()/notFound()/revalidate*().";

// esbuild/CJS-interop + thenable-probe keys must return a SAFE value, never a thrower.
const SAFE = new Set(['__esModule', 'default', 'then', 'catch', 'finally', 'constructor', 'prototype']);

// Union of the real request-scoped export names across next/headers|navigation|cache.
const NAMES = [
  'cookies', 'headers', 'draftMode',
  'redirect', 'permanentRedirect', 'notFound', 'forbidden', 'unauthorized',
  'unstable_rethrow', 'unstable_isUnrecognizedActionError',
  'revalidatePath', 'revalidateTag', 'unstable_cache', 'unstable_noStore',
  'cacheLife', 'cacheTag', 'unstable_cacheLife', 'unstable_cacheTag', 'refresh', 'updateTag',
];

const thrower = (name) => () => { throw new Error(`[kalfa-worker] '${name}()' ${HINT}`); };

module.exports = new Proxy({}, {
  get(_t, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (SAFE.has(prop)) return undefined;
    return thrower(prop);
  },
  ownKeys() { return NAMES.slice(); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true, value: undefined }; },
});
