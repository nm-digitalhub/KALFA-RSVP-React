import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';
import { isPlausibleServerActionId } from '@/lib/security/server-action-id';
import { addVary, isNegotiableRequest, negotiateMarkdown } from '@/lib/http/markdown-negotiation';
import { serveMarkdown } from '@/lib/http/serve-markdown';

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime by default). This
// is a thin wrapper — the Supabase session refresh + optimistic auth redirect
// live in the official-pattern helper (src/lib/supabase/proxy.ts::updateSession).

// Next sets this on every Server Action request (its own ACTION_HEADER
// constant, client/components/app-router-headers.js).
const ACTION_HEADER = 'next-action';

// EXACTLY what Next's own action handler returns for an unrecognized action
// (`handleUnrecognizedFetchAction`, server/app-render/action-handler.js): 404,
// `x-nextjs-action-not-found: 1`, plain-text body. Reproduced byte-for-byte and
// not improvised, because the client router keys its recovery off this precise
// shape — `unstable_isUnrecognizedActionError` is what drives our own
// version-skew reload (src/lib/version-skew.ts). A plain 400 here would look
// like a generic failure and leave a genuinely stale tab with a dead button.
//
// Next's comment on that handler explicitly invites this: "using a blank body +
// header means that unrecognized actions can also be handled at the infra level
// (i.e. without needing to invoke a lambda)".
const ACTION_NOT_FOUND_HEADER = 'x-nextjs-action-not-found';

function actionNotFound(): NextResponse {
  return new NextResponse('Server action not found.', {
    status: 404,
    headers: { [ACTION_NOT_FOUND_HEADER]: '1', 'content-type': 'text/plain' },
  });
}

// RFC 9110 §12.5.1 Accept negotiation for a small allowlist of public
// marketing/legal pages (see markdown-negotiation.ts) — AI agents that send
// `Accept: text/markdown` get a token-efficient Markdown response instead of
// the full HTML page. Every other route is entirely unaffected: `proxy` falls
// through to the exact same `updateSession(request)` call it always made.
function notAcceptable(): NextResponse {
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
  addVary(headers, 'Accept');
  return new NextResponse('Not Acceptable', { status: 406, headers });
}

export async function proxy(request: NextRequest) {
  // MEASURED 2026-08-16: 819 of these reached the action pipeline between 31.07
  // and 16.08, every one of them logging a warning line. 83 of the ids were
  // well-formed 40-hex strings, which reads like version skew until you look at
  // the timing — 16 DISTINCT ids inside 0.75s, repeating on separate days. A
  // stale tab replays the SAME id; that pattern is a scanner replaying 40-hex
  // strings scraped out of our client bundles (chunk hashes), because a real
  // Next 16 action id is 42 characters, not 40. The rest were literal junk
  // ("x" 427 times, "action", "0", "1").
  //
  // Nothing was breaking — Next already answers these correctly. The cost was
  // signal: the warnings buried the log, which is exactly how they cost an hour
  // of diagnosis. Answering here keeps the action pipeline out of it entirely.
  const actionId = request.headers.get(ACTION_HEADER);
  if (actionId !== null && !isPlausibleServerActionId(actionId)) {
    return actionNotFound();
  }

  if (isNegotiableRequest(request)) {
    const decision = negotiateMarkdown(request.headers.get('accept'));
    if (decision === 'not-acceptable') return notAcceptable();
    if (decision === 'markdown') return serveMarkdown(request);
    const response = await updateSession(request);
    addVary(response.headers, 'Accept');
    return response;
  }

  return await updateSession(request);
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
