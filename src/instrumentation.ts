import { type Instrumentation } from 'next';

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
// `@slack/webhook` depends on Node's HTTP stack, so the actual send is loaded
// (dynamic import) and invoked ONLY in the Node.js runtime — mirroring the
// docs' NEXT_RUNTIME guard for runtime-specific code. This keeps the notifier
// out of any Edge bundle and keeps the hook fail-safe.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const { sendSlackAlert } = await import('@/lib/alerts/slack');
    const error = err as Error & { digest?: string };
    // PII-SAFE: this is a GLOBAL catch-all, so error.message can embed personal
    // data (Zod messages, DB constraint text, interpolated names/emails). NEVER
    // forward it. Send a constant title + only the error NAME and Next's server
    // `digest`, which lets ops correlate with the full server-side log without
    // leaking PII to Slack. NEVER include request.headers or any request body.
    const detailParts = [error.name || 'Error'];
    if (error.digest) detailParts.push(`digest=${error.digest}`);
    await sendSlackAlert({
      level: 'error',
      title: 'Unhandled server error',
      source: `${context.routeType} ${context.routePath}`,
      detail: detailParts.join(' · '),
      fields: { method: request.method, path: request.path },
    });
  } catch {
    // Fail-safe: an error hook must never throw.
  }
};
