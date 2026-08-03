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
  const error = err as Error & { digest?: string; __NEXT_ERROR_CODE?: string };
  // Benign unknown/forged Server Action id (scanner POST or auto-recovered deploy
  // skew): DOWNGRADE to an info breadcrumb instead of paging as a red error — see
  // isUnknownServerActionError above. Genuine render errors stay level 'error'.
  const benign = isUnknownServerActionError(error);

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
      title: benign ? 'Unknown Server Action (benign)' : 'Unhandled server error',
      source: `${context.routeType} ${context.routePath}`,
      detail: detailParts.join(' · '),
      fields: { method: request.method, path: request.path },
      category: 'errors',
    });
  } catch {
    // Fail-safe: an error hook must never throw.
  }
};
