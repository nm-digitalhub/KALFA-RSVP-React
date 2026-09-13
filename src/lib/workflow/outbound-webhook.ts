import 'server-only';

import { validateWebhookUrl, WEBHOOK_URL_REJECTION_LABELS } from './webhook-url';

import type { OutboundWebhookPort } from './engine/ports';

// The live `OutboundWebhookPort` — the only place in KALFA where a workflow
// reaches a system that is not ours.
//
// Everything security-relevant about `action.webhook` is in this file, on
// purpose: the handler cannot reach a socket except through here, so there is no
// second path that could skip the URL check.
//
// ⚠️ WHAT GOES OUT IS WHATEVER THE OWNER PUT IN THE BODY, AND THAT IS THE POINT.
// The body is template-resolved before it arrives, so it can legitimately carry
// a guest's first name, the event, and the text they sent us. That is the
// feature — a workflow that cannot say who it is about is not worth calling. The
// controls are therefore not on the CONTENT but on the destination and the
// record: https only, no private space, an audit row per call, and a platform
// admin with `manage_settings` as the only person who can type the URL.
//
// The residual risk this does NOT close is DNS: a public hostname that resolves
// into private space passes `validateWebhookUrl` and the worker will connect to
// it. Closing it needs resolve-then-pin-the-socket, which Node's stock `fetch`
// does not expose. Stated in webhook-url.ts too, so it is visible from either
// end.

/** Long enough for a slow endpoint, short enough not to hold a worker slot. */
const TIMEOUT_MS = 10_000;

/**
 * How much of the response we read before giving up on it.
 *
 * The body is NOT returned to the workflow and never stored — only the status
 * is. It is read at all so the connection completes cleanly, and capped so a
 * misbehaving endpoint streaming megabytes cannot pin a worker's memory.
 */
const MAX_RESPONSE_BYTES = 8 * 1024;

export function createOutboundWebhook(): OutboundWebhookPort {
  return {
    async post({ url, body, idempotencyKey }) {
      // Validated HERE and not in the handler, so every caller is covered by the
      // same check whatever else changes upstream.
      const checked = validateWebhookUrl(url);
      if (!checked.ok) {
        return {
          ok: false,
          status: null,
          reason: WEBHOOK_URL_REJECTION_LABELS[checked.reason],
        };
      }

      try {
        const res = await fetch(checked.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // The receiver's only defence against the replay the step lease can
            // cause. Deterministic per (run, node) — see OutboundWebhookPort.
            'X-Kalfa-Idempotency-Key': idempotencyKey,
            // Named so an endpoint owner can tell our calls apart in their logs
            // without guessing from the body.
            'User-Agent': 'KALFA-Workflow/1.0',
          },
          body,
          // No redirect following. A 3xx to `http://169.254.169.254/` would
          // otherwise walk straight past the check above — the classic way an
          // SSRF guard on the typed URL is defeated by the server it trusts.
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });

        // Drain a bounded amount and discard it. Nothing from a third party
        // enters the run store.
        await readAndDiscard(res);

        // `redirect: 'manual'` surfaces a 3xx as an ordinary response, so it
        // lands here rather than being followed. Not 2xx → the error branch.
        const ok = res.status >= 200 && res.status < 300;
        return ok
          ? { ok: true, status: res.status }
          : { ok: false, status: res.status, reason: `HTTP ${res.status}` };
      } catch (err) {
        // NEVER the caught error's message. It can contain the resolved URL and,
        // if the owner put one in a query string, a token — and this string
        // reaches the run's step row and the editor's log panel.
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        return {
          ok: false,
          status: null,
          reason: timedOut ? 'תם הזמן הקצוב לתגובה' : 'הפנייה לכתובת נכשלה',
        };
      }
    },
  };
}

async function readAndDiscard(res: Response): Promise<void> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return;
    let read = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value?.byteLength ?? 0;
      if (read >= MAX_RESPONSE_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // A body that fails mid-read says nothing about whether the request was
    // accepted — the status already answered that.
  }
}
