import { NextResponse, type NextRequest } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { enqueueWorkflowRun } from '@/lib/workflow/enqueue';
import { MAX_WEBHOOK_BODY_BYTES, startRunFromWebhook } from '@/lib/workflow/webhook-trigger';

// `trigger.webhook` — an external system POSTs here and a workflow runs.
//
// THE FIRST PUBLIC, SESSION-LESS ENDPOINT THIS SUBSYSTEM HAS. Everything about
// what it may do is decided in `webhook-trigger.ts`, not here: this file is
// transport — read the body, rate-limit, hand over, map the answer to a status.
// Keeping the decision there means there is no second route that could reach the
// same work with a looser check.
//
// WHAT A LEAKED TOKEN BUYS. The run it starts carries no event and no contact,
// so every guest-touching node refuses inside it (`requireGuestContext`). The
// worst case is "someone can make this workflow run", never "someone can read or
// write our data". That is the property the token length is chosen against, and
// it is why this endpoint needs no session.
//
// THE RESPONSE IS DELIBERATELY UNINFORMATIVE. A wrong token, a token for a
// DISARMED workflow and a token that never existed all answer 404 with the same
// body. Anything finer turns this into an oracle for which tokens are live.

export const dynamic = 'force-dynamic';

/**
 * Per-IP ceiling. Generous enough for a busy integration, low enough that a
 * loose token cannot be used to manufacture unbounded runs — each one is a row
 * and a pg-boss job.
 */
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

/**
 * What a browser gets, and it is deliberately the same for every token.
 *
 * ⚠️ NOT COSMETIC. The editor hands an operator this address and invites them to
 * use it, so the first thing many will do is paste it into a browser — which
 * sends GET. Without a handler, Next answers 405 with NO `Content-Type` at all,
 * and the response also carries `X-Content-Type-Options: nosniff`, so the
 * browser is forbidden from guessing. Safari therefore treats it as opaque bytes
 * and offers to DOWNLOAD A FILE NAMED AFTER THE TOKEN — reported from a phone on
 * 2026-09-17, and indistinguishable from "my webhook is broken".
 *
 * ⚠️ IT MUST TELL A CALLER NOTHING ABOUT THE TOKEN. A constant response: no
 * lookup, no rate-limit consumption, no branch. A GET that answered differently
 * for a real token than for a made-up one would be a free oracle for guessing
 * them — which is the whole reason `POST` answers 404 for both a wrong token and
 * a disarmed workflow.
 *
 * ⚠️ `charset=utf-8` IS SET BY HAND, AND THE HINT IS UNREADABLE WITHOUT IT.
 * `Response.json()` — which `NextResponse.json` wraps — sets a bare
 * `application/json` and never a charset. JSON is UTF-8 by definition (RFC 8259
 * §8.1), but a browser shown an unlabelled body falls back to its own default:
 * measured on iOS Safari 2026-09-17, the Hebrew sentence below rendered as
 * `×©×œ×—×•`, which is these exact UTF-8 bytes read as Windows-1252.
 * `/guest-list-template.csv` beside it has always spelled its charset out for
 * the same reason.
 *
 * `Allow` is set explicitly because Next's own 405 omits it. NOTE, MEASURED: it
 * leaves this handler (verified on the Response object) but does NOT reach the
 * wire on the deployed stack, while `content-type` and the body do — nginx holds
 * no `proxy_hide_header`, and a 200 route's `content-disposition` survives
 * intact. Unresolved, and cosmetic: the status carries the meaning. The test
 * pins what this function returns, which is the part this file controls.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'method_not_allowed',
      hint: 'שלחו POST עם גוף JSON לכתובת הזו. פתיחה בדפדפן שולחת GET ולעולם לא תפעיל את התהליך.',
    },
    {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp((name) => request.headers.get(name));
  // Keyed on the IP alone, NOT on the token: keying on the token would let an
  // attacker spend someone else's quota by guessing, and would also mean an
  // unknown token got its own fresh budget on every guess.
  const limited = rateLimit(`workflow-hook:${ip}`, RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limited.resetAt - Date.now()) / 1000)) } },
    );
  }

  const { token } = await params;

  // Read as TEXT, not `request.json()`. The size check has to happen on the raw
  // bytes before anything parses them, and a parse failure has to be OUR answer
  // rather than a framework error page.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'unreadable_body' }, { status: 400 });
  }

  const result = await startRunFromWebhook({
    token,
    rawBody,
    // The caller opts into deduplication by sending a key — the same header
    // shape `action.webhook` SENDS on the way out, so a KALFA workflow calling
    // another KALFA workflow deduplicates without anyone configuring it.
    idempotencyKey: request.headers.get('x-kalfa-idempotency-key'),
  });

  if (!result.ok) {
    if (result.reason === 'too_large') {
      return NextResponse.json(
        { ok: false, error: 'body_too_large', limit: MAX_WEBHOOK_BODY_BYTES },
        { status: 413 },
      );
    }
    if (result.reason === 'bad_json') {
      return NextResponse.json({ ok: false, error: 'expected_json_object' }, { status: 400 });
    }
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // `undefined` means the dedupe key matched an existing run. 200 with
  // `duplicate: true` rather than an error: the caller did nothing wrong, and a
  // 4xx would make a well-behaved retrying client escalate.
  if (!result.runId) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // ENQUEUE AFTER the row exists. A failure here leaves a 'pending' run visible
  // in /admin — recoverable and obvious — which is strictly better than
  // reporting success for work that was never scheduled.
  try {
    // The same sender the manual-run path uses — the web process has no
    // long-lived pg-boss instance of its own.
    await enqueueWorkflowRun(await getWebJobSender(), result.runId);
  } catch {
    return NextResponse.json(
      { ok: true, runId: result.runId, queued: false },
      { status: 202 },
    );
  }

  return NextResponse.json({ ok: true, runId: result.runId }, { status: 202 });
}
