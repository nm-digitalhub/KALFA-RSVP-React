import { NextResponse, type NextRequest } from 'next/server';

import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { enqueueWorkflowRun } from '@/lib/workflow/enqueue';
import { MAX_WEBHOOK_BODY_BYTES, startRunFromWebhook } from '@/lib/workflow/webhook-trigger';
import { WEBHOOK_SECRET_HEADER } from '@/lib/workflow/webhook-token';
import type { WebhookMethod } from '@/lib/workflow/catalogue/types';

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
// ⚠️ NOT EXPORTED, AND NEXT ENFORCES THAT. A route file may export only the HTTP
// method handlers and a fixed set of config names; anything else fails the
// generated type check with "Property 'browserHint' is incompatible with index
// signature". Caught by `npm run build` 2026-09-22 — `tsc --noEmit` alone did
// NOT catch it, because the rule lives in types Next generates during a build.
function browserHint(): Response {
  // ⚠️ text/plain, NOT JSON — AND THE REASON IS MEASURED, NOT STYLISTIC.
  //
  // The owner opened the address in Chrome and it DOWNLOADED A FILE instead of
  // showing the sentence. Nothing sets `Content-Disposition` (checked live: the
  // response carries only content-type, the four security headers and `allow`).
  // The cause is the combination this app sets deliberately and correctly:
  // `X-Content-Type-Options: nosniff` on `/(.*)` plus `application/json`, which
  // a top-level navigation in Chrome saves rather than renders.
  //
  // The header stays. The RESPONSE changes: this body exists for exactly one
  // reader — a human who pasted the URL into a browser — and no machine consumes
  // it, so a media type that renders is strictly better than one that is parsed
  // by nobody and downloaded by everybody.
  return new Response(
    'שלחו POST עם גוף JSON לכתובת הזו.\n' +
      'אם התהליך מוגדר לאימות בכותרת — הוסיפו את הסוד ב-x-kalfa-webhook-secret.\n' +
      'פתיחה בדפדפן שולחת GET ולעולם לא תפעיל את התהליך.\n',
    {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' },
    },
  );
}

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> },
  method: WebhookMethod,
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

  const { endpoint } = await params;

  // ⚠️ THIS FILE DOES NOT DECIDE WHICH HALF IS THE CREDENTIAL, and must not
  // learn to. A node in `header` mode is authenticated by this header against a
  // public path id; a node in `address` mode is authenticated by the path
  // segment itself and reads no header. Only `findWorkflowForEndpoint` knows
  // which, so both values are handed over unread and every failure — unknown
  // path, wrong secret, wrong verb, disarmed workflow — comes back as the same
  // 404. See plans/webhook-address-vs-secret.md.
  const secret = request.headers.get(WEBHOOK_SECRET_HEADER) ?? '';

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
    endpointId: endpoint,
    secret,
    method,
    // Flattened: a repeated key keeps its LAST value, which is what a template
    // naming `{{trigger.query.x}}` can actually use. A caller that needs arrays
    // sends a body.
    query: Object.fromEntries(new URL(request.url).searchParams),
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
      { status: result.acceptedStatus },
    );
  }

  // 202 for `trigger.webhook`, 200 for SUMIT — the node type decides, in
  // `startRunFromWebhook`, and this route only transports it.
  return NextResponse.json({ ok: true, runId: result.runId }, { status: result.acceptedStatus });
}

// ⚠️ ONE HANDLER, FIVE EXPORTS — and the export list is the ONLY place a verb is
// enabled. Next dispatches by exported name, so a method with no export here can
// never reach `handle` no matter what a node's `methods` says; and a method
// exported here still gets nowhere unless that node allows it. Two gates, and
// the strict one (the node's allow-list) is checked AFTER the secret, so a
// caller who cannot authenticate learns nothing about which verbs are open.
//
export const POST = (request: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) =>
  handle(request, ctx, 'POST');
export const PUT = (request: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) =>
  handle(request, ctx, 'PUT');
export const PATCH = (request: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) =>
  handle(request, ctx, 'PATCH');
export const DELETE = (request: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) =>
  handle(request, ctx, 'DELETE');

/**
 * GET is BOTH a browser visit and a legitimate webhook verb, and this splits
 * them on one signal: the secret header.
 *
 * ⚠️ THE NO-ORACLE PROPERTY IS PRESERVED, WHICH IS WHY THE SPLIT IS ON THE
 * HEADER AND NOT ON THE PATH. A browser never sends `x-kalfa-webhook-secret`, so
 * every address-bar visit gets the SAME constant sentence — it cannot be used to
 * ask whether an endpoint exists. Only a caller that already presents a
 * credential reaches resolution, and there every failure is the same 404.
 *
 * Without this, a webhook whose upstream can only send GET simply could not be
 * built — the gap the owner raised on 2026-09-22 from n8n's own HTTP Method
 * parameter.
 *
 * ⚠️ WHICH IS WHY `address` MODE CANNOT OFFER GET, AND ARM-CHECK REFUSES THE
 * PAIR. There the credential is the path, so a legitimate caller sends no
 * header — and this split would hand it the browser hint forever. The
 * alternative, resolving a headerless GET, is exactly the oracle the split
 * exists to prevent: the answer would differ between a real address and a
 * made-up one. Refusing at arming is the only place that costs nobody a live
 * request.
 */
export function GET(request: NextRequest, ctx: { params: Promise<{ endpoint: string }> }) {
  if (!request.headers.get(WEBHOOK_SECRET_HEADER)) return browserHint();
  return handle(request, ctx, 'GET');
}
