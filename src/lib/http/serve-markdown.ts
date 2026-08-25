import type { NextFetchEvent, NextRequest } from 'next/server';
import { withMarkdown } from '@markdown-for-agents/nextjs';

import { addVary } from './markdown-negotiation';
import { trustedAppOrigin } from './trusted-origin';

// Executes the documented @markdown-for-agents/nextjs pattern (README "How it
// works"): re-enter the SAME URL with `Accept: text/html` so the page renders
// normally, then convert the HTML to Markdown. No loop — the inner fetch's
// explicit Accept header makes the re-entrant request take proxy.ts's HTML
// branch, never this one again.
//
// The negotiation DECISION (is markdown actually preferred?) is made by the
// caller via `negotiateMarkdown` before this function is ever invoked — this
// module only executes the conversion once that's already settled.
//
// Only a synthetic `Accept: text/html` header is sent to the inner fetch —
// nothing from the original request is forwarded, so Cookie, Authorization,
// and any Next-internal headers never leave this function. These are public,
// unauthenticated pages; the inner fetch carries no identity at all.
//
// The inner fetch target is built from `trustedAppOrigin()` (APP_ORIGIN), not
// from `request.url` / `request.nextUrl.origin` — those are derived from the
// incoming Host header, which a client can set to anything on a self-hosted
// server. Only the path + query come from the request; the origin is always
// the app's own configured origin. Same reasoning `baseUrl` gets the trusted
// origin too: it resolves relative links/images inside the converted
// markdown, so it must not be attacker-steerable either.
export async function serveMarkdown(request: NextRequest): Promise<Response> {
  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    trustedAppOrigin(),
  );
  const handler = withMarkdown(
    async () => fetch(target, { headers: { accept: 'text/html' } }),
    { extract: true, deduplicate: true, baseUrl: target.origin },
  );
  // withMarkdown's type signature mirrors Next's NextProxy (request, event),
  // but reading its source (and our own inner handler above) confirms `event`
  // is only ever forwarded, never read — so a real NextFetchEvent buys
  // nothing here. Verified 2026-08-24 against @markdown-for-agents/nextjs
  // 1.3.4's compiled output.
  const response = await handler(request, undefined as unknown as NextFetchEvent);
  if (!response) throw new Error('markdown conversion produced no response');
  // Belt-and-braces on top of withMarkdown's own `headers.append('vary',
  // 'Accept')`: dedupe against whatever Vary the rendered page itself set.
  addVary(response.headers, 'Accept');
  return response;
}
