import { type Instrumentation } from 'next';

import { rateLimit } from '@/lib/security/rate-limit';

// Next.js server-error capture (file convention: instrumentation.ts). Placed in
// `src/` per the docs — "If you're using the `src` folder, then place the file
// inside `src` alongside `pages` and `app`"
// (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
//
// We only need `onRequestError`, the optional hook Next calls when the server
// captures a request error (docs: 01-app/03-api-reference/03-file-conventions/
// instrumentation.md). The `register` export is for run-once startup code and
// is not required for error capture, so it is intentionally omitted.
//
// `@slack/web-api` depends on Node's HTTP stack, so the actual send is loaded
// (dynamic import) and invoked ONLY in the Node.js runtime — mirroring the
// docs' NEXT_RUNTIME guard for runtime-specific code. This keeps the notifier
// out of any Edge bundle and keeps the hook fail-safe.
// Next.js throws "Failed to find Server Action" (framework error codes E974/E975,
// node_modules/next/dist/server/app-render/action-handler.js) when a POST carries
// an action id it cannot resolve in the module map. This class is dominated by
// forged/scanner traffic (junk `$ACTION_ID_*` fields — e.g. 57× id "x" in the prod
// logs); the genuine case is cross-deployment skew, which real users AUTO-RECOVER
// from client-side (`deploymentId` in next.config + version-skew.ts reload),
// independent of alerting. NOTE: some public routes DO have real Server Actions
// (e.g. /r/[token] RSVP submit, /join/[token]) — so we do NOT drop this silently;
// onRequestError DOWNGRADES it to an info breadcrumb (not a red error/page),
// preserving visibility of genuine skew on live forms without alert fatigue.
// Mirrors the benign-code handling in the WhatsApp (131049/131026) / SMS / SUMIT
// layers. Predicate is resilient: the stable framework code OR (forward-compat)
// the public message prefix. `unstable_isUnrecognizedActionError` is NOT usable
// here — it matches only the CLIENT UnrecognizedActionError class, never this
// server throw. Reading (not forwarding) error.message is PII-safe.
export function isUnknownServerActionError(error: {
  message?: string;
  __NEXT_ERROR_CODE?: string;
}): boolean {
  return (
    error.__NEXT_ERROR_CODE === 'E974' ||
    error.__NEXT_ERROR_CODE === 'E975' ||
    (typeof error.message === 'string' &&
      error.message.startsWith('Failed to find Server Action'))
  );
}

// "The destination stream closed early." — thrown by React's Flight/SSR
// renderer (createCancelHandler in react-server-dom-webpack-server /
// react-dom-server, node_modules/next/dist/compiled/...) when the client's
// HTTP connection closes before a streamed render finishes: an aborted RSC
// prefetch, a navigation away mid-stream, or a closed tab. This is the SAME
// class of "client went away" event `isAbortError` in Next's own
// pipe-readable.js is meant to swallow — but React's cancel handler wraps it
// in a plain `Error(reason)` with `.name === 'Error'` (not `'AbortError'`),
// so Next's isAbortError() check misses it and it surfaces here as if it
// were a genuine unhandled render error.
//
// Confirmed page-agnostic, not specific to any one route: investigated
// 13.8.2026 after a report attributed this to /admin/voice — the two
// historical ops_errors rows for this exact message (digest 608786559) show
// it firing on /admin/campaigns AND /admin/voice, at different times. That
// rules out "this page's render is unusually slow" as the trigger; it is a
// routine, low-frequency artifact of RSC streaming + client aborts that can
// happen on any page. Next.js/React have no public API to reclassify it
// (node_modules is not ours to patch), so this predicate is the app-level
// lever: it stops the Slack "Unhandled server error" page for a benign,
// already-rare event while still recording every occurrence to ops_errors
// (recordOpsError below runs unconditionally, before this check) so genuine
// frequency spikes stay visible.
//
// Exact-match on purpose (not `.includes('stream')`): a loose match risks
// silently downgrading a real streaming failure. The sibling message "The
// destination stream errored while writing data." (same cancel-handler
// idiom, fired from destination.on('error') instead of .on('close')) is
// deliberately NOT included here — it can also indicate a genuine write
// failure, not only a client disconnect, so it is left at full severity
// until it is itself observed and confirmed benign.
export function isDestinationStreamClosedError(error: { message?: string }): boolean {
  return error.message === 'The destination stream closed early.';
}

// "The router state header was sent but could not be parsed." — Next's own
// throw (E10, node_modules/next/dist/server/app-render/parse-and-validate-
// flight-router-state.js) when an RSC request's `Next-Router-State-Tree`
// header fails JSON.parse or its superstruct schema. Next builds this header
// from the CLIENT's own router state, so it fails when a stale/foreign client
// sends one the current server no longer recognises — a bot or link-checker
// replaying a captured `_rsc=` URL without a genuine Next.js router behind it,
// or a tab that survives a deploy in a way `deploymentId` doesn't catch for
// this particular header. Either way it is thrown before any component ever
// renders (`parseRequestHeaders` runs ahead of the tree), so it is provably
// not an app bug — there is no request data our own code touched yet.
//
// MEASURED 17.08 against ops_errors + the live Slack alert: every occurrence
// in the last 2 days is route_path=/(public)/(site)/page, method=GET,
// digest=null (consistent with the pre-render throw above), always in pairs
// ~1s apart — the signature of a single non-browser client retrying, not
// distinct real visitors. Same class of problem, same fix, as the two
// predicates above: downgrade instead of drop, so ops keeps full visibility
// via ops_errors (recordOpsError runs unconditionally, before this check)
// without paging on every recurrence.
export function isRouterStateParseError(error: {
  message?: string;
  __NEXT_ERROR_CODE?: string;
}): boolean {
  return (
    error.__NEXT_ERROR_CODE === 'E10' ||
    error.message === 'The router state header was sent but could not be parsed.'
  );
}

// "aborted" with `code: 'ECONNRESET'` — Node's own error when the CLIENT closes the
// socket while the server is still reading the request body. Same family as the two
// predicates above: a fault in someone else's network, reported as ours.
//
// MEASURED 2026-08-17, and the correlation is what settles it. The native agent console
// streams diagnostics to POST /api/agents/telemetry, and the alert fired at
// 14:47:43.091 — 668ms after the device wrote its own `app.crash` line at 14:47:42.423.
// The severed upload WAS the app dying mid-POST. Paging a human about it inverts cause
// and effect: the actionable fault was on the phone, and the server did nothing wrong
// except notice.
//
// Deliberately NOT narrowed to the telemetry route. Any endpoint that accepts a body
// from a mobile client on cellular can see this — a tunnel dropping, a process killed,
// a user walking into a lift — and a predicate that only recognised the one route we
// happened to hit first would re-raise this alert from the next one.
//
// KEYED ON THE MESSAGE, NOT ON `code` ALONE — and that is the whole care in this
// function.
//
// The first version of this matched `code === 'ECONNRESET'` on its own, which is too
// broad in a direction that matters: ECONNRESET is equally what an OUTBOUND call gets
// when Supabase, SUMIT or Voximplant resets the connection mid-flight. That is a real
// server-side fault and must keep paging. A predicate that cannot tell "the phone went
// away while POSTing to us" from "our request to the payment provider was reset" would
// silence the second while aiming at the first, and its failure mode is silence — the
// worst kind for an alert filter.
//
// `message === 'aborted'` IS Node's inbound signature specifically: it is what the HTTP
// server raises when the client closes the socket while the request body is still being
// read. An outbound reset surfaces as "socket hang up" or "read ECONNRESET" instead, and
// neither is matched here on purpose, even though both are also disconnects — proving
// the disconnect happened on the INBOUND side is the property being tested, and those
// two do not prove it.
//
// `code` is therefore corroboration, never the trigger: the object reaching
// onRequestError has already been through Next's error handling, which promises to
// preserve neither field, so a match is accepted on the message with or without it.
export function isClientDisconnectError(error: {
  message?: string;
  code?: string;
}): boolean {
  const message = error.message?.trim().toLowerCase();
  if (message === 'aborted') return true;
  return error.code === 'ECONNRESET' && message?.includes('aborted') === true;
}

// Global cap on ops_errors writes per minute — protects the DB from a true
// fault-storm hammering it with inserts. Deliberately NOT a per-(route+error)
// dedup like sendSlackAlert's: that dedup is exactly what makes ops_alerts an
// incomplete error log (135 suppressed errors in a measured 30-day window,
// none written anywhere) — the whole point of ops_errors is to not repeat
// that gap. A single generous global ceiling is enough to bound worst-case
// volume without recreating per-error suppression.
const OPS_ERROR_MAX_PER_MIN = 120;
const OPS_ERROR_RATE_KEY = 'ops-error:global';

// Best-effort, fail-safe write to ops_errors — runs INDEPENDENTLY of the
// Slack alert below (own try/catch, own gating), so a disabled/deduped/
// rate-capped Slack alert still leaves a row here. Uses the service-role
// client (this runs server-side only, never in a browser) since ops_errors'
// RLS restricts INSERT to service-role and SELECT to the platform owner.
async function recordOpsError(
  error: Error & { digest?: string },
  request: { method: string; path: string },
  context: { routeType: string; routePath: string },
  runtime: string,
): Promise<void> {
  if (!rateLimit(OPS_ERROR_RATE_KEY, { limit: OPS_ERROR_MAX_PER_MIN, windowMs: 60_000 }).allowed) return;
  try {
    const [{ createAdminClient }, { readDeployId }] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/lib/alerts/slack'),
    ]);
    const admin = createAdminClient();
    // PII-SAFE — same discipline as the Slack send below: no error.message,
    // no headers, no request body. Only name/digest/route/deploy-id.
    await admin.from('ops_errors').insert({
      route_path: context.routePath,
      route_type: context.routeType,
      method: request.method,
      error_name: error.name || 'Error',
      digest: error.digest ?? null,
      deploy_id: readDeployId(),
      runtime,
    });
  } catch {
    // Fail-safe: never throw into the caller.
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  // `code` is Node's own field on system errors (ECONNRESET and friends) — see
  // isClientDisconnectError. Widened here rather than cast at the call site so every
  // predicate below sees the same shape.
  const error = err as Error & {
    digest?: string;
    __NEXT_ERROR_CODE?: string;
    code?: string;
  };
  // Benign, known-noisy patterns: DOWNGRADE to an info breadcrumb instead of
  // paging as a red error. Genuine render errors stay level 'error'. Order
  // matters only for the title below; both predicates are independent checks.
  const benignTitle = isUnknownServerActionError(error)
    ? 'Unknown Server Action (benign)'
    : isDestinationStreamClosedError(error)
      ? 'Client disconnected mid-stream (benign)'
      : isRouterStateParseError(error)
        ? 'Unparseable router state header (benign)'
        : isClientDisconnectError(error)
          ? 'Client disconnected mid-upload (benign)'
          : null;
  const benign = benignTitle !== null;

  await recordOpsError(error, request, context, process.env.NEXT_RUNTIME ?? 'nodejs');

  try {
    const { sendSlackAlert } = await import('@/lib/alerts/slack');
    // PII-SAFE: this is a GLOBAL catch-all, so error.message can embed personal
    // data (Zod messages, DB constraint text, interpolated names/emails). NEVER
    // forward it. Send a constant title + only the error NAME and Next's server
    // `digest`, which lets ops correlate with the full server-side log without
    // leaking PII to Slack. NEVER include request.headers or any request body.
    const detailParts = [error.name || 'Error'];
    if (error.digest) detailParts.push(`digest=${error.digest}`);
    await sendSlackAlert({
      level: benign ? 'info' : 'error',
      title: benignTitle ?? 'Unhandled server error',
      source: `${context.routeType} ${context.routePath}`,
      detail: detailParts.join(' · '),
      fields: { method: request.method, path: request.path },
      category: 'errors',
    });
  } catch {
    // Fail-safe: an error hook must never throw.
  }
};
