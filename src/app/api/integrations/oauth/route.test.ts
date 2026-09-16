import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, startMock, completeMock, resolveProviderMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  startMock: vi.fn(),
  completeMock: vi.fn(),
  resolveProviderMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/integrations/oauth-flow', () => ({
  createOAuthFlow: () => ({ start: startMock, complete: completeMock }),
}));
vi.mock('@/lib/integrations/registry', () => ({ resolveProvider: resolveProviderMock }));
vi.mock('@/lib/url', () => ({
  getAppUrl: async (path: string) => `https://beta.example.test${path}`,
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

  it('⚠️ passes the URL unmodified, because the token exchange strips it for redirect_uri', async () => {
    await callbackGET(callbackRequest('code=abc&state=state-value'));

    const passed = completeMock.mock.calls[0][0].callbackUrl as URL;
    expect(passed.origin + passed.pathname).toBe(
      'https://beta.example.test/api/integrations/oauth/callback',
    );
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

  it('sends the browser somewhere sensible when the state is missing entirely', async () => {
    const response = await callbackGET(callbackRequest('error=access_denied'));

    expect(completeMock).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://beta.example.test/admin/integrations?oauth=invalid_state',
    );
  });

  it('⚠️ answers identically for a replayed, expired and unknown state', async () => {
    // Telling them apart would make this an oracle for which states exist.
    const locations: (string | null)[] = [];
    for (const code of ['integration_oauth_state_invalid', 'integration_authorization_failed']) {
      completeMock.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
      const response = await callbackGET(callbackRequest('code=abc&state=state-value'));
      locations.push(response.headers.get('location'));
    }

    expect(new Set(locations).size).toBe(1);
    expect(locations[0]).toBe('https://beta.example.test/admin/integrations?oauth=failed');
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
