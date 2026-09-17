import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import {
  createOAuthFlow,
  INTEGRATION_OAUTH_CALLBACK_PATH,
} from '@/lib/integrations/oauth-flow';
import { readIntegrationRuntimeError } from '@/lib/integrations/errors';
import { readOAuthFailureDetail } from '@/lib/integrations/oauth-failure-detail';
import {
  isPopupRedirect,
  oauthPopupBridgeHtml,
  type OAuthPopupOutcome,
} from '@/lib/integrations/oauth-popup-bridge';
import { resolveProvider } from '@/lib/integrations/registry';
import { getAppOrigin, getAppUrl, resolveAppRedirectPath } from '@/lib/url';

// Where the provider sends the browser back.
//
// ⚠️ THIS ROUTE DELIBERATELY PERFORMS NO SESSION AUTHORIZATION, AND THAT IS NOT
// AN OVERSIGHT.
//
// A callback is not a new administrative action. It is the continuation of an
// authorization that `start` already gated on `integrations.manage`, and the
// identity it was gated on is already frozen into the state row:
//
//   created_by     NOT NULL, and outside the column-level UPDATE grant
//   state_hash     only sha256 is stored; the raw value never touches the DB
//   consumed_at    the only writable column, which is what makes it single-use
//   expires_at     immutable, compared against the DATABASE clock
//   code_verifier  immutable — PKCE binds this callback to that start
//
// Re-checking the session here would add a dependency the flow's security does
// not need, and would break legitimate cases: between pressing "connect" and
// returning from the consent screen, a session can be renewed or replaced, or
// the person may have signed in to the provider in another window. The OAuth
// transaction stays cryptographically valid through all of that — state and
// PKCE are what prove it — while a session check would reject it and lose the
// authorization the user just granted.
//
// So the boundary is:
//   start     → SESSION authorization  (requirePlatformPermission)
//   callback  → TRANSACTION authorization (state + single-use + TTL + PKCE)
//
// The route itself is transport. It never inspects `code`, never decides what a
// failure means, and never builds the redirect_uri — `complete()` owns all three.

export const dynamic = 'force-dynamic';

const FALLBACK_DESTINATION = '/admin/integrations';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');

  if (!state) {
    return NextResponse.redirect(await outcomeUrl(FALLBACK_DESTINATION, 'invalid_state'));
  }

  try {
    const result = await createOAuthFlow().complete({
      state,
      // ⚠️ REBUILT ON THE CONFIGURED ORIGIN. NOT `request.url`.
      //
      // `authorizationCodeGrant` derives the `redirect_uri` it sends to the
      // token endpoint from this URL — `redirectUri = stripParams(currentUrl)`,
      // openid-client/build/index.js:909 — so this value IS the redirect_uri,
      // and it must equal the one the authorization leg declared.
      //
      // `request.url` is NOT that value here. Next builds it from the address
      // the server LISTENS on, not from the Host header:
      //
      //   next-server.js:1280
      //     const initUrl = this.fetchHostname && this.port
      //       ? `${protocol}://${this.fetchHostname}:${this.port}${req.url}`
      //
      // and `next start -H 127.0.0.1 -p 3002` — which is the DOCUMENTED
      // production shape, a reverse proxy in front rather than the server
      // exposed directly — sets both. So `request.url` reads
      // `https://127.0.0.1:3002/…` while the authorization leg declared
      // `https://beta.kalfa.me/…`, and the provider rejects the exchange. Every
      // connection failed this way, from the first one, with the state row
      // consumed and nothing written.
      //
      // Taking the origin from configuration and only the path and query from
      // the request is also what the App Router gives us: `nextUrl` exposes
      // `pathname` and `searchParams` and NO origin, and Next's own answer to
      // "what is my absolute origin" — `metadataBase` — is a configured value.
      // `getAppOrigin()` is that configured value, and `src/lib/url.ts` refuses
      // to derive it from a Host header precisely so this cannot be spoofed.
      //
      // The path is the CONSTANT, not `url.pathname`: the authorization leg
      // built its redirect_uri from the same constant, so the two legs now have
      // one shared source rather than two that happen to agree.
      callbackUrl: new URL(
        `${INTEGRATION_OAUTH_CALLBACK_PATH}${url.search}`,
        await getAppOrigin(),
      ),
      resolveProvider,
    });

    // Sanitised a SECOND time. It was already reduced to a path before being
    // stored, so this is defence in depth rather than the primary control — but
    // this is the boundary where a value becomes a Location header, and the
    // check costs one function call.
    const destination = await resolveAppRedirectPath(result.redirectTo);

    // A popup has no editor to return to — its opener does. See
    // `oauth-popup-bridge.ts`.
    if (isPopupRedirect(destination)) {
      return popupBridge({ ok: true, connectionId: result.connectionId });
    }

    return NextResponse.redirect(await outcomeUrl(destination, 'connected'));
  } catch (error) {
    // FIRST, and the order is load-bearing: `unstable_rethrow` re-throws Next's
    // own control-flow signals (NEXT_REDIRECT and friends). Logging before it
    // would record a successful redirect as an OAuth failure.
    unstable_rethrow(error);

    // ⚠️ THE ONLY PLACE THIS FAILURE IS EVER RECORDED.
    //
    // It used to be recorded nowhere. On 2026-09-17 every connection ended at
    // `?oauth=failed`, and finding out why took reconstructing the state row
    // from the database and reading two libraries' source, because the catch
    // below answered the browser and dropped the error on the floor. The
    // comment that stood here claimed "the operator reads the real reason in
    // the panel" — but a failure at this point has written no connection row,
    // and `last_error` is surfaced only for Exchange, webhooks and the debug
    // panel. There was no panel and no reason.
    //
    // ⚠️ THE CODE, NOT THE MESSAGE. `IntegrationRuntimeError` carries a stable
    // `code` and `classification`; the message of anything else may have
    // travelled up from the OAuth library, whose `cause` chain can hold the
    // token endpoint's response body. A class name is enough to tell "the
    // provider refused" from "the database was unreachable", and it cannot
    // carry a token.
    //
    // `oauthError` and `providerCode` say WHY, and they are the only two things
    // from the provider's answer that may be logged — see
    // `oauth-failure-detail.ts` for why everything else is dropped.
    const known = readIntegrationRuntimeError(error);
    const detail = readOAuthFailureDetail(error);
    console.error('[oauth-callback] authorization could not be completed', {
      code: known?.code ?? 'unknown',
      classification: known?.classification ?? 'unknown',
      errorName: error instanceof Error ? error.name : typeof error,
      oauthError: detail.oauthError ?? 'none',
      providerCode: detail.providerCode ?? 'none',
      status: detail.status ?? 'none',
    });

    // ⚠️ ALWAYS THE BRIDGE, AND THE PAGE DECIDES WHAT IT IS.
    //
    // This branch used to ask whether the flow had been started from a popup by
    // reading `oauthMode` off the request — a parameter that CANNOT be here.
    // The callback URL is built by the provider and carries `code` and `state`;
    // our flag rode on the START url and is never echoed back, so the test was
    // always false and a popup was redirected instead of being told. Observed
    // live: the popup landed on /admin/integrations and the editor waiting for
    // it learned nothing until the five-minute timeout.
    //
    // The success path still reads the STORED `redirect_to`, which is
    // authoritative. The failure path cannot: reaching the state row is exactly
    // what may have failed. So the answer is the same document either way, and
    // its script branches on `window.opener` — the one signal that is always
    // correct, available in both cases, and impossible to lose in transit.
    return popupBridge({ ok: false, reason: 'failed' });
  }
}

/**
 * The bridge document, with the headers that keep it a dead end.
 *
 * `no-store` because it names a connection that has just been created, and
 * `frame-ancestors 'none'` because nothing should ever embed a page whose only
 * job is to talk to its opener.
 */
async function popupBridge(outcome: OAuthPopupOutcome): Promise<Response> {
  return new NextResponse(oauthPopupBridgeHtml(outcome, await getAppOrigin()), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors 'none'",
    },
  });
}

/** Appends the outcome without assuming the destination has no query of its own. */
async function outcomeUrl(destination: string, outcome: string): Promise<string> {
  const target = new URL(await getAppUrl(destination));
  target.searchParams.set('oauth', outcome);
  return target.href;
}
