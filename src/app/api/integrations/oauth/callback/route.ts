import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import { createOAuthFlow } from '@/lib/integrations/oauth-flow';
import { resolveProvider } from '@/lib/integrations/registry';
import { getAppUrl, resolveAppRedirectPath } from '@/lib/url';

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
      // The URL as received. `complete` hands it to the library, which strips
      // the query to derive the `redirect_uri` for the token exchange — so it
      // must be the same origin and path the authorization request declared.
      callbackUrl: url,
      resolveProvider,
    });

    // Sanitised a SECOND time. It was already reduced to a path before being
    // stored, so this is defence in depth rather than the primary control — but
    // this is the boundary where a value becomes a Location header, and the
    // check costs one function call.
    const destination = await resolveAppRedirectPath(result.redirectTo);
    return NextResponse.redirect(await outcomeUrl(destination, 'connected'));
  } catch (error) {
    unstable_rethrow(error);
    // One destination for every failure. An expired state, a replayed one, a
    // provider that refused consent and a token exchange that failed all land
    // the same way: telling them apart in a URL would make this an oracle for
    // which states exist, and the operator reads the real reason in the panel.
    return NextResponse.redirect(await outcomeUrl(FALLBACK_DESTINATION, 'failed'));
  }
}

/** Appends the outcome without assuming the destination has no query of its own. */
async function outcomeUrl(destination: string, outcome: string): Promise<string> {
  const target = new URL(await getAppUrl(destination));
  target.searchParams.set('oauth', outcome);
  return target.href;
}
