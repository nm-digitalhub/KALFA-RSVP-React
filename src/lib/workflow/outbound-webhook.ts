import 'server-only';

import {
  DEFAULT_HTTP_METHOD,
  FORBIDDEN_HTTP_HEADERS,
  HTTP_METHODS,
  HTTP_METHODS_WITH_BODY,
  MAX_CAPTURED_RESPONSE_BYTES,
  type HttpHeader,
  type HttpMethod,
} from './catalogue/types';
import { hasUnresolvedSecretReference, substituteSecrets } from './secrets';
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
//
// ⚠️ THIS IS WHERE SECRETS BECOME VALUES, AND NOWHERE ELSE.
//
// Header values arrive still carrying `{{secrets.<NAME>}}` — `resolveTemplate`
// skips that namespace precisely so they do. They are substituted a few lines
// before the `fetch` and are never returned, never logged and never put in the
// result object. See secrets.ts for why the environment and not a table.

/** Long enough for a slow endpoint, short enough not to hold a worker slot. */
const TIMEOUT_MS = 10_000;

/**
 * How much of the response we read before giving up on it.
 *
 * Read at all so the connection completes cleanly, and capped so a misbehaving
 * endpoint streaming megabytes cannot pin a worker's memory. Whether any of it
 * is KEPT is the caller's choice (`captureResponse`); the cap applies either way.
 */
const MAX_RESPONSE_BYTES = MAX_CAPTURED_RESPONSE_BYTES;

const FORBIDDEN = new Set<string>(FORBIDDEN_HTTP_HEADERS);

type HeaderResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Turn the owner's header rows into what goes on the wire.
 *
 * Four things happen here, in this order, and the order matters:
 *
 *   1. Blank rows are dropped. The `ArrayFieldSchema` control adds an empty row
 *      as its affordance, so a saved node normally has one.
 *   2. Reserved names are REFUSED, not silently dropped — see
 *      FORBIDDEN_HTTP_HEADERS for why each one would break a guarantee made
 *      elsewhere. A refusal names the header; the owner can fix it.
 *   3. Secrets are substituted. A missing one fails the whole call rather than
 *      sending a half-authenticated request (see substituteSecrets).
 *   4. A leftover `{{secrets.…}}` — a name too malformed for the pattern to have
 *      matched at all — is caught by the last gate. Without it the literal token
 *      would go out as a header value.
 *
 * The `reason` strings are safe to surface: they carry header NAMES and secret
 * NAMES, never values. That separation is the entire point of the design.
 */
function buildHeaders(rows: HttpHeader[] | undefined, idempotencyKey: string): HeaderResult {
  const headers: Record<string, string> = {
    // Named so an endpoint owner can tell our calls apart in their logs without
    // guessing from the body.
    'User-Agent': 'KALFA-Workflow/1.0',
    // The receiver's only defence against the replay the step lease can cause.
    // Deterministic per (run, node) — see OutboundWebhookPort. Set FIRST so an
    // owner row cannot precede it, and the name is in FORBIDDEN so none can
    // overwrite it either.
    'X-Kalfa-Idempotency-Key': idempotencyKey,
  };

  for (const row of rows ?? []) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const rawValue = typeof row?.value === 'string' ? row.value : '';
    if (name === '') continue;

    if (FORBIDDEN.has(name.toLowerCase())) {
      return { ok: false, reason: `הכותרת "${name}" שמורה למערכת ואינה ניתנת לקביעה` };
    }
    // A newline in a header value is response/request splitting. `fetch` would
    // throw on it anyway; refusing here makes the message say what is wrong.
    if (/[\r\n]/.test(rawValue) || /[\r\n]/.test(name)) {
      return { ok: false, reason: `הכותרת "${name}" מכילה תו שורה חדשה` };
    }

    const substituted = substituteSecrets(rawValue);
    if (!substituted.ok) {
      return { ok: false, reason: missingSecretReason(substituted.missing) };
    }
    if (hasUnresolvedSecretReference(substituted.value)) {
      return { ok: false, reason: `הכותרת "${name}" מפנה לסוד בשם לא חוקי` };
    }

    headers[name] = substituted.value;
  }

  return { ok: true, headers };
}

/**
 * The refusal text for one or more unconfigured secrets.
 *
 * Carries NAMES, which are safe to show and are the whole reason the name and
 * the value were separated in the first place. Spelled once because three call
 * sites need it — url, headers and body.
 */
function missingSecretReason(missing: string[]): string {
  return `הסוד ${missing.map((n) => `"${n}"`).join(', ')} אינו מוגדר בשרת`;
}

function readMethod(method: HttpMethod | undefined): HttpMethod {
  return method && (HTTP_METHODS as readonly string[]).includes(method)
    ? method
    : DEFAULT_HTTP_METHOD;
}

export function createOutboundWebhook(): OutboundWebhookPort {
  return {
    async post({ url, method, headers: headerRows, body, idempotencyKey, captureResponse }) {
      // ⚠️ SECRETS ARE SUBSTITUTED FIRST, AND THE URL IS VALIDATED AFTER.
      //
      // The order is deliberate and it is the reason a Slack incoming webhook
      // works: its URL is entirely a secret
      // (`https://hooks.slack.com/services/T…/B…/X…`), so validating the
      // pre-substitution string would be judging `https://hooks.slack.com/
      // {{secrets.SLACK_HOOK}}` — a string that is not the destination. Checking
      // after substitution means https-only and the private-space refusal apply
      // to the address actually dialled.
      const resolvedUrl = substituteSecrets(url);
      if (!resolvedUrl.ok) {
        return { ok: false, status: null, reason: missingSecretReason(resolvedUrl.missing) };
      }
      if (hasUnresolvedSecretReference(resolvedUrl.value)) {
        return { ok: false, status: null, reason: 'הכתובת מפנה לסוד בשם לא חוקי' };
      }

      // Validated HERE and not in the handler, so every caller is covered by the
      // same check whatever else changes upstream.
      const checked = validateWebhookUrl(resolvedUrl.value);
      if (!checked.ok) {
        return {
          ok: false,
          status: null,
          // The rejection label NEVER echoes the URL — it would now be the
          // substituted one.
          reason: WEBHOOK_URL_REJECTION_LABELS[checked.reason],
        };
      }

      // BEFORE the fetch and before anything is sent: a missing secret must cost
      // nothing at the far end.
      const built = buildHeaders(headerRows, idempotencyKey);
      if (!built.ok) {
        return { ok: false, status: null, reason: built.reason };
      }

      // The body too. An API that wants its key in the JSON payload or in a form
      // field is ordinary, and refusing it bought nothing — the value still only
      // ever exists between here and the socket.
      const resolvedBody = substituteSecrets(body);
      if (!resolvedBody.ok) {
        return { ok: false, status: null, reason: missingSecretReason(resolvedBody.missing) };
      }
      if (hasUnresolvedSecretReference(resolvedBody.value)) {
        return { ok: false, status: null, reason: 'גוף הבקשה מפנה לסוד בשם לא חוקי' };
      }

      const verb = readMethod(method);
      const sendsBody = (HTTP_METHODS_WITH_BODY as readonly string[]).includes(verb);

      // Content-Type only when there is a body, and only when the owner did not
      // set one: a header row naming it wins, which is how an owner sends form
      // encoding or XML without the node knowing those exist.
      const hasOwnContentType = Object.keys(built.headers).some(
        (name) => name.toLowerCase() === 'content-type',
      );
      if (sendsBody && !hasOwnContentType) {
        built.headers['Content-Type'] = 'application/json';
      }

      // The one place a secret exists as a value. It is not logged, not returned
      // and not held beyond this call.
      const requestHeaders = built.headers;

      try {
        const res = await fetch(checked.url, {
          method: verb,
          headers: requestHeaders,
          // `undefined`, not `''`. A GET or DELETE with an empty-string body is
          // still a request with a body as far as undici is concerned, and some
          // servers reject it.
          body: sendsBody ? resolvedBody.value : undefined,
          // No redirect following. A 3xx to `http://169.254.169.254/` would
          // otherwise walk straight past the check above — the classic way an
          // SSRF guard on the typed URL is defeated by the server it trusts.
          //
          // It is also what stops a redirect from replaying our Authorization
          // header at a host the owner never named.
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });

        // Bounded either way. `captureResponse` decides whether it is KEPT.
        const read = await readBounded(res);

        // `redirect: 'manual'` surfaces a 3xx as an ordinary response, so it
        // lands here rather than being followed. Not 2xx → the error branch.
        const ok = res.status >= 200 && res.status < 300;
        const captured = captureResponse
          ? { body: read.text, truncated: read.truncated }
          : {};

        return ok
          ? { ok: true, status: res.status, ...captured }
          : { ok: false, status: res.status, reason: `HTTP ${res.status}`, ...captured };
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

/**
 * Read at most MAX_RESPONSE_BYTES and say whether there was more.
 *
 * Decoded as UTF-8 with `stream: true` across chunks, so a multi-byte character
 * split across a chunk boundary is not mangled — the naive per-chunk decode
 * produces replacement characters in the middle of Hebrew text.
 */
async function readBounded(res: Response): Promise<{ text: string; truncated: boolean }> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return { text: '', truncated: false };

    const decoder = new TextDecoder('utf-8');
    let text = '';
    let read = 0;
    let truncated = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = MAX_RESPONSE_BYTES - read;
      if (value.byteLength >= remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: false });
        truncated = value.byteLength > remaining;
        await reader.cancel();
        break;
      }

      text += decoder.decode(value, { stream: true });
      read += value.byteLength;
    }

    return { text, truncated };
  } catch {
    // A body that fails mid-read says nothing about whether the request was
    // accepted — the status already answered that.
    return { text: '', truncated: false };
  }
}
