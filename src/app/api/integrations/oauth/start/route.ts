import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createOAuthFlow } from '@/lib/integrations/oauth-flow';
import { resolveProvider } from '@/lib/integrations/registry';
import { resolveAppRedirectPath } from '@/lib/url';

// Begin an interactive integration authorization.
//
// THIS IS WHERE THE SESSION IS CHECKED, AND THE ONLY PLACE IT IS. An admin with
// `integrations.manage` presses a button here, and the identity that answers is
// written into `integration_oauth_states.created_by` — immutable, NOT NULL, and
// the sole source of provenance for the connection the callback will create.
// The callback deliberately re-checks nothing about the session; see the note
// there.
//
// The route is transport. It reads the query, resolves the destination, and
// hands over — every decision about scopes, PKCE and state lives in
// `oauth-flow.ts`, so there is no second entry point that could reach the same
// work with a looser check.
//
// ⚠️ IT NEVER BUILDS A `redirect_uri`. The flow owns that, from
// `INTEGRATION_OAUTH_CALLBACK_PATH` and `getAppOrigin()`. A copy here would be a
// second definition of a value that has to match the token exchange EXACTLY —
// and the failure of a mismatch is an opaque `invalid_grant` from the provider
// minutes later.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Outside the try on purpose. `requirePlatformPermission` signals failure by
  // calling `redirect()`, which throws NEXT_REDIRECT — a control-flow signal
  // Next.js unwinds itself. Keeping it out here means it cannot meet a catch at
  // all, rather than relying on `unstable_rethrow` to let it back out.
  const user = await requirePlatformPermission('integrations.manage');

  const url = new URL(request.url);
  const providerId = url.searchParams.get('provider')?.trim();
  const capabilities = url.searchParams.getAll('capability').filter(Boolean);

  if (!providerId || capabilities.length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const provider = resolveProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }

  // Sanitised HERE, before it is persisted, so the callback inherits a value
  // that was already reduced to a path on this app. `resolveAppRedirectPath`
  // returns `pathname + search` and nothing else, which is what stops an
  // open-redirect from being stored for later replay by a different request.
  const redirectTo = await resolveAppRedirectPath(
    url.searchParams.get('redirectTo') ?? '/admin/integrations',
  );

  try {
    const { authorizationUrl } = await createOAuthFlow().start({
      provider,
      capabilities,
      redirectTo,
      createdBy: user.id,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    unstable_rethrow(error);
    // One answer for every reason. An unknown capability, a provider with no
    // stored client, and a disabled one are all configuration problems an
    // operator reads about in the panel — not something to enumerate back
    // through a URL.
    return NextResponse.json({ error: 'oauth_start_failed' }, { status: 400 });
  }
}
