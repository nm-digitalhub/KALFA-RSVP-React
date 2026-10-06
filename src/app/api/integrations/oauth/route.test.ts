import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, startMock, completeMock, resolveProviderMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  startMock: vi.fn(),
  completeMock: vi.fn(),
  resolveProviderMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
// ⚠️ `importActual`, not a bare factory. The route also imports
// `INTEGRATION_OAUTH_CALLBACK_PATH` from this module, and a factory that omits
// it makes the import throw — but worse, a factory that RESTATES it would let
// the constant drift from the one the authorization leg uses, which is the
// exact class of bug these tests exist to prevent. Only `createOAuthFlow` is
// replaced; the constant stays the real one.
vi.mock('@/lib/integrations/oauth-flow', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/integrations/oauth-flow')>()),
  createOAuthFlow: () => ({ start: startMock, complete: completeMock }),
}));
vi.mock('@/lib/integrations/registry', () => ({ resolveProvider: resolveProviderMock }));
vi.mock('@/lib/url', () => ({
  getAppUrl: async (path: string) => `https://beta.example.test${path}`,
  // Needed by every FAILURE path now, because the bridge document names the
  // origin it is allowed to postMessage to rather than using '*'.
  getAppOrigin: async () => 'https://beta.example.test',
  // The real helper reduces any input to `pathname + search` on this app. The
  // stub keeps that contract so a test cannot pass an absolute URL through.
  resolveAppRedirectPath: async (value: string) => {
    const target = new URL(value, 'https://beta.example.test');
    return target.pathname + target.search;
  },
}));

import { GET as callbackGET } from './callback/route';
import { GET as startGET } from './start/route';

const PROVIDER = { id: 'fixture', displayName: 'Fixture' };

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'admin-1' });
  resolveProviderMock.mockReturnValue(PROVIDER);
  startMock.mockResolvedValue({ authorizationUrl: 'https://login.example.test/authorize?x=1' });
  completeMock.mockResolvedValue({ connectionId: 'connection-1', redirectTo: '/admin/integrations' });
});

function startRequest(query: string) {
  return new Request(`https://beta.example.test/api/integrations/oauth/start?${query}`);
}

function callbackRequest(query: string) {
  return new Request(`https://beta.example.test/api/integrations/oauth/callback?${query}`);
}

describe('start', () => {
  it('gates on integrations.manage and carries the session user as the actor', async () => {
    const response = await startGET(
      startRequest('provider=fixture&capability=mail.send&redirectTo=/admin/integrations'),
    );

    expect(permMock).toHaveBeenCalledWith('integrations.manage');
    expect(startMock).toHaveBeenCalledWith({
      provider: PROVIDER,
      capabilities: ['mail.send'],
      redirectTo: '/admin/integrations',
      createdBy: 'admin-1',
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://login.example.test/authorize?x=1');
  });

  it('⚠️ lets NEXT_REDIRECT out of the handler untouched', async () => {
    // `requirePlatformPermission` refuses by calling `redirect()`, which throws.
    // It is awaited OUTSIDE the try so it cannot meet a catch at all — if this
    // ever regressed into the try, a denied admin would silently receive a 400
    // instead of being sent away.
    const nextRedirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    permMock.mockRejectedValueOnce(nextRedirect);

    await expect(startGET(startRequest('provider=fixture&capability=mail.send'))).rejects.toBe(
      nextRedirect,
    );
    expect(startMock).not.toHaveBeenCalled();
  });

  it('accepts several capabilities in one authorization', async () => {
    await startGET(startRequest('provider=fixture&capability=mail.send&capability=calendar.write'));

    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: ['mail.send', 'calendar.write'] }),
    );
  });

  it('defaults the destination rather than starting without one', async () => {
    await startGET(startRequest('provider=fixture&capability=mail.send'));

    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: '/admin/integrations' }),
    );
  });

  it('⚠️ reduces an off-site destination to a path before it is ever stored', async () => {
    await startGET(
      startRequest(
        'provider=fixture&capability=mail.send&redirectTo=' +
          encodeURIComponent('https://evil.example/steal'),
      ),
    );

    const stored = startMock.mock.calls[0][0].redirectTo as string;
    expect(stored).toBe('/steal');
    expect(stored).not.toContain('evil.example');
  });

  it('refuses a request with no capability', async () => {
    const response = await startGET(startRequest('provider=fixture'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('refuses an unregistered provider without starting anything', async () => {
    resolveProviderMock.mockReturnValueOnce(undefined);
    const response = await startGET(startRequest('provider=nope&capability=mail.send'));

    expect(response.status).toBe(404);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('answers the same way for every start failure', async () => {
    startMock.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'integration_provider_disabled' }),
    );
    const response = await startGET(startRequest('provider=fixture&capability=mail.send'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'oauth_start_failed' });
  });
});

describe('callback', () => {
  it('⚠️ performs NO session authorization', async () => {
    // The transaction is the authorization: the actor is already frozen into the
    // state row, and a session can legitimately have changed while the person was
    // at the consent screen. Re-checking here would reject an authorization that
    // is still cryptographically valid.
    await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(permMock).not.toHaveBeenCalled();
  });

  it('hands the received URL to the flow and redirects where the flow says', async () => {
    const response = await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(completeMock).toHaveBeenCalledWith({
      state: 'state-value',
      callbackUrl: expect.any(URL),
      resolveProvider: resolveProviderMock,
    });
    expect(response.headers.get('location')).toBe(
      'https://beta.example.test/admin/integrations?oauth=connected',
    );
  });

  it('⚠️ builds redirect_uri on the CONFIGURED origin, never the one the request arrived on', async () => {
    // THE DEFECT THIS PINS — the reason no connection ever completed.
    //
    // `authorizationCodeGrant` turns this URL into the `redirect_uri` it sends
    // to the token endpoint (`stripParams(currentUrl)`,
    // openid-client/build/index.js:909). In production `request.url` does NOT
    // name the public origin: Next builds it from the address the server
    // listens on (`next-server.js:1280`), and `next start -H 127.0.0.1 -p 3002`
    // makes that `https://127.0.0.1:3002`. The authorization leg had declared
    // `https://beta.kalfa.me`, so the provider rejected every exchange.
    //
    // ⚠️ THE OLD TEST COULD NOT HAVE CAUGHT THIS. It asserted the same property
    // but built its request on the app's own origin, so the two agreed by
    // construction and the assertion was vacuous. The loopback origin below is
    // the entire point of this test — without it, it tests nothing.
    const asProductionReceivesIt = new Request(
      'https://127.0.0.1:3002/api/integrations/oauth/callback?code=abc&state=state-value',
    );

    await callbackGET(asProductionReceivesIt);

    const passed = completeMock.mock.calls[0][0].callbackUrl as URL;
    expect(passed.origin + passed.pathname).toBe(
      'https://beta.example.test/api/integrations/oauth/callback',
    );
    // And the query still travels, or there is no `code` to exchange.
    expect(passed.searchParams.get('code')).toBe('abc');
    expect(passed.searchParams.get('state')).toBe('state-value');
  });

  it('⚠️ takes the PATH from the shared constant, not from the request', async () => {
    // Both legs must resolve the redirect_uri from one source. A request that
    // arrives on a different path — a proxy rewrite, a stray prefix — must not
    // change the value we send to the token endpoint, because the
    // authorization leg has already committed to the constant.
    await callbackGET(
      new Request('https://127.0.0.1:3002/some/rewritten/path?code=abc&state=state-value'),
    );

    const passed = completeMock.mock.calls[0][0].callbackUrl as URL;
    expect(passed.pathname).toBe('/api/integrations/oauth/callback');
  });

  it('preserves a destination that already carries a query', async () => {
    completeMock.mockResolvedValueOnce({
      connectionId: 'c1',
      redirectTo: '/admin/integrations?tab=workflow',
    });
    const response = await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(response.headers.get('location')).toBe(
      'https://beta.example.test/admin/integrations?tab=workflow&oauth=connected',
    );
  });

  it('⚠️ re-sanitises the stored destination at the redirect boundary', async () => {
    completeMock.mockResolvedValueOnce({
      connectionId: 'c1',
      redirectTo: 'https://evil.example/steal',
    });
    const response = await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(response.headers.get('location')).toBe(
      'https://beta.example.test/steal?oauth=connected',
    );
  });

  it('⚠️ RECORDS the failure — it used to be swallowed and cost 30 minutes to find', async () => {
    // WHAT THIS PINS. On 2026-09-17 every Microsoft connection ended at
    // `?oauth=failed` and `pm2 logs` was silent, because this catch answered the
    // browser and dropped the error. Finding the cause meant reconstructing the
    // state row from the database and reading two libraries' source. The comment
    // that justified the silence claimed the operator "reads the real reason in
    // the panel" — but a failure here has written no connection row, and
    // `last_error` is surfaced only for Exchange, webhooks and the debug panel.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeMock.mockRejectedValueOnce(
      Object.assign(new Error('token endpoint said no'), {
        classification: 'permanent',
        code: 'integration_authorization_failed',
      }),
    );

    await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(spy).toHaveBeenCalledTimes(1);
    const [message, context] = spy.mock.calls[0];
    expect(message).toContain('[oauth-callback]');
    expect(context).toMatchObject({
      code: 'integration_authorization_failed',
      classification: 'permanent',
    });
    spy.mockRestore();
  });

  it('⚠️ names the PROVIDER reason too, or the code alone still means a guessing game', async () => {
    // `integration_authorization_failed` says WHICH STEP failed. It cannot say
    // why, and on 2026-09-17 that gap cost a full second round of diagnosis: the
    // code was logged, the connection still failed, and nothing said whether the
    // provider had rejected the redirect_uri or our client credentials.
    //
    // These two identifiers close it. Both are fixed vocabularies — RFC 6749
    // §5.2 and Microsoft's public AADSTS numbers — not provider content.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeMock.mockRejectedValueOnce(
      Object.assign(new Error('The provider did not complete the authorization.'), {
        classification: 'permanent',
        code: 'integration_authorization_failed',
        cause: {
          error: 'invalid_grant',
          error_description:
            'AADSTS50011: The redirect URI specified in the request does not match. ' +
            'Correlation ID: 1111-not-a-real-correlation Timestamp: 2026-09-17 06:03:33Z',
          status: 400,
        },
      }),
    );

    await callbackGET(callbackRequest('code=abc&state=state-value'));

    const [, context] = spy.mock.calls[0];
    expect(context).toMatchObject({
      code: 'integration_authorization_failed',
      oauthError: 'invalid_grant',
      providerCode: 'AADSTS50011',
      status: 400,
    });

    // ⚠️ AND STILL NOT THE DESCRIPTION. The AADSTS number is the actionable
    // part; the correlation id and timestamp around it are not, and a log line
    // is a place data goes to be kept.
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('Correlation');
    expect(serialized).not.toContain('not-a-real');
    expect(serialized).not.toContain('redirect URI specified');
    spy.mockRestore();
  });

  it('says `none` rather than inventing a reason when the failure carried one', async () => {
    // A database outage throws no OAuth error. The fields must read as absent,
    // not as a provider verdict that never happened.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeMock.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), {
        classification: 'transient',
        code: 'integration_state_lookup_failed',
      }),
    );

    await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(spy.mock.calls[0][1]).toMatchObject({
      oauthError: 'none',
      providerCode: 'none',
      status: 'none',
    });
    spy.mockRestore();
  });

  it('⚠️ logs the CODE, never the message — a cause chain can hold the token response', async () => {
    // `IntegrationRuntimeError` carries a stable machine-readable code, which is
    // enough to tell "the provider refused" from "the database was unreachable".
    // The message of anything else may have travelled up from the OAuth library,
    // and that is not a thing to put in a log line.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeMock.mockRejectedValueOnce(new Error('access_token=SECRET-VALUE-HERE'));

    await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-VALUE-HERE');
    expect(spy.mock.calls[0][1]).toMatchObject({ code: 'unknown', errorName: 'Error' });
    spy.mockRestore();
  });

  it('⚠️ answers a FAILURE with the bridge document, not a redirect', async () => {
    // The branch that used to decide this read `oauthMode` off the request — a
    // parameter the provider never sends back, so it was always false and a
    // popup was redirected instead of being told. The document now decides what
    // it is by looking at `window.opener`, which is right in both cases.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeMock.mockRejectedValueOnce(new Error('nope'));

    const response = await callbackGET(callbackRequest('code=abc&state=state-value'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('window.opener');
    expect(body).toContain('location.replace');
    spy.mockRestore();
  });

  it('sends the browser somewhere sensible when the state is missing entirely', async () => {
    const response = await callbackGET(callbackRequest('error=access_denied'));

    expect(completeMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://beta.example.test/admin/integrations?oauth=invalid_state',
    );
  });

  it('⚠️ answers identically for a replayed, expired and unknown state', async () => {
    // Telling them apart would make this an oracle for which states exist —
    // anyone holding a callback URL can reach this route.
    //
    // The RESPONSE SHAPE changed (the failure path now serves the bridge
    // document rather than a redirect) but this property did not, and it is the
    // one worth pinning: two different internal codes must be indistinguishable
    // from outside. The log line, which DOES tell them apart, is the private
    // half of the same change.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bodies: string[] = [];
    const statuses: number[] = [];
    for (const code of ['integration_oauth_state_invalid', 'integration_authorization_failed']) {
      // `classification` as well as `code`: `readIntegrationRuntimeError` is a
      // STRUCTURAL reader and refuses a half-shaped error, so an error carrying
      // only `code` logs as 'unknown' and this test would assert nothing.
      completeMock.mockRejectedValueOnce(
        Object.assign(new Error('x'), { code, classification: 'permanent' }),
      );
      const response = await callbackGET(callbackRequest('code=abc&state=state-value'));
      statuses.push(response.status);
      bodies.push(await response.text());
    }

    expect(new Set(statuses)).toEqual(new Set([200]));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('integration_oauth_state_invalid');
    expect(bodies[0]).not.toContain('integration_authorization_failed');

    // …while the log DID distinguish them. That asymmetry is the whole design.
    const loggedCodes = spy.mock.calls.map((c) => (c[1] as { code: string }).code);
    expect(loggedCodes).toEqual([
      'integration_oauth_state_invalid',
      'integration_authorization_failed',
    ]);
    spy.mockRestore();
  });

  it('⚠️ lets NEXT_REDIRECT out rather than turning it into "failed"', async () => {
    const nextRedirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    completeMock.mockRejectedValueOnce(nextRedirect);

    await expect(callbackGET(callbackRequest('code=abc&state=state-value'))).rejects.toBe(
      nextRedirect,
    );
  });
});
