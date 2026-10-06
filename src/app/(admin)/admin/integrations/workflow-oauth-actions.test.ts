import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { saveMock, resolveProviderMock, revalidatePathMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  resolveProviderMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/data/admin/integrations/oauth-provider-config', () => ({
  saveOAuthProviderConfig: saveMock,
}));
vi.mock('@/lib/integrations/registry', () => ({ resolveProvider: resolveProviderMock }));

import { saveWorkflowOAuthProviderAction } from './actions';

const OAUTH_PROVIDER = {
  id: 'fixture',
  displayName: 'Fixture',
  credentialKind: 'oauth2_authorization_code',
  oauth: { server: new URL('https://login.example.test'), clientAuth: 'post' },
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const VALID = { provider: 'fixture', clientId: 'client-abc', clientSecret: 'secret-abc' };

beforeEach(() => {
  vi.clearAllMocks();
  resolveProviderMock.mockReturnValue(OAUTH_PROVIDER);
  saveMock.mockResolvedValue(undefined);
});

describe('what reaches the data layer', () => {
  it('passes the submitted client id and secret through', async () => {
    await saveWorkflowOAuthProviderAction(null, form({ ...VALID, enabled: 'on' }));

    expect(saveMock).toHaveBeenCalledWith({
      provider: 'fixture',
      clientId: 'client-abc',
      clientSecret: 'secret-abc',
      enabled: true,
    });
  });

  it('⚠️ forwards an EMPTY secret rather than rejecting it', async () => {
    // '' is the RPC's way of saying "keep the stored secret". Refusing it here
    // would break the ordinary case — correcting a client id, or toggling
    // `enabled` — for an operator who cannot re-read a secret the provider only
    // ever displayed once.
    await saveWorkflowOAuthProviderAction(null, form({ ...VALID, clientSecret: '' }));

    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: '' }));
  });

  it('treats a missing checkbox as disabled, not as unspecified', async () => {
    await saveWorkflowOAuthProviderAction(null, form(VALID));
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('trims what an operator pasted', async () => {
    await saveWorkflowOAuthProviderAction(
      null,
      form({ provider: ' fixture ', clientId: '  client-abc  ', clientSecret: ' secret-abc ' }),
    );

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-abc', clientSecret: 'secret-abc' }),
    );
  });

  it('⚠️ writes the REGISTRY’s provider id, not the browser’s spelling', async () => {
    // The registry is the authority on what a provider is called. The two are
    // deliberately different here — if they matched, passing the raw field
    // through would be indistinguishable from resolving it, and the guarantee
    // that a browser cannot name a provider would go untested.
    resolveProviderMock.mockReturnValueOnce({ ...OAUTH_PROVIDER, id: 'canonical-fixture' });

    await saveWorkflowOAuthProviderAction(null, form({ ...VALID, provider: 'fixture' }));

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'canonical-fixture' }),
    );
  });

  it('⚠️ never carries an actor from the form — the data layer takes it from the session', async () => {
    await saveWorkflowOAuthProviderAction(
      null,
      form({ ...VALID, createdBy: 'attacker-supplied-uuid', p_created_by: 'also-not-ok' }),
    );

    const passed = saveMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(passed).sort()).toEqual([
      'clientId',
      'clientSecret',
      'enabled',
      'provider',
    ]);
    expect(JSON.stringify(passed)).not.toContain('attacker-supplied');
  });
});

describe('what it refuses', () => {
  it('a provider the registry does not know', async () => {
    resolveProviderMock.mockReturnValueOnce(undefined);

    const result = await saveWorkflowOAuthProviderAction(
      null,
      form({ ...VALID, provider: 'not-registered' }),
    );

    expect(result).toEqual({ fieldErrors: { provider: expect.any(Array) } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('⚠️ a registered provider that has no OAuth client to configure', async () => {
    resolveProviderMock.mockReturnValueOnce({ id: 'api-key-thing', credentialKind: 'static' });

    const result = await saveWorkflowOAuthProviderAction(null, form(VALID));

    expect(result).toEqual({ fieldErrors: { provider: expect.any(Array) } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('a missing client id, reported as a field error', async () => {
    const result = await saveWorkflowOAuthProviderAction(
      null,
      form({ provider: 'fixture', clientSecret: 'secret-abc' }),
    );

    expect(result).toMatchObject({ fieldErrors: { clientId: ['יש להזין Client ID.'] } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('reports both field problems at once', async () => {
    resolveProviderMock.mockReturnValueOnce(undefined);

    const result = await saveWorkflowOAuthProviderAction(null, form({ provider: 'nope' }));

    expect(Object.keys((result as { fieldErrors: object }).fieldErrors).sort()).toEqual([
      'clientId',
      'provider',
    ]);
  });
});

describe('failure handling', () => {
  it('turns a database error into a form error, not a crash', async () => {
    saveMock.mockRejectedValueOnce(new Error('23505'));

    const result = await saveWorkflowOAuthProviderAction(null, form(VALID));

    expect(result).toMatchObject({ error: expect.stringContaining('OAuth') });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('⚠️ lets NEXT_REDIRECT out instead of showing a form error', async () => {
    // The permission check lives inside `saveOAuthProviderConfig`, and it refuses
    // by calling redirect(). Swallowing that would leave a denied admin looking
    // at "could not save" on a page they should have been sent away from.
    const nextRedirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    saveMock.mockRejectedValueOnce(nextRedirect);

    await expect(saveWorkflowOAuthProviderAction(null, form(VALID))).rejects.toBe(nextRedirect);
  });
});

describe('after a successful save', () => {
  it('revalidates the pages that render this configuration', async () => {
    await saveWorkflowOAuthProviderAction(null, form(VALID));

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/integrations/workflow-oauth');
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/integrations');
  });

  it('⚠️ says something neutral, because the RPC cannot say which it was', async () => {
    // `integrations_upsert_provider_config` returns void — "created" and
    // "updated" are indistinguishable, and widening the contract to phrase a
    // sentence would be the tail wagging the dog.
    const result = await saveWorkflowOAuthProviderAction(null, form(VALID));

    expect(result).toEqual({ notice: 'הגדרות ה-OAuth נשמרו.' });
    expect(JSON.stringify(result)).not.toMatch(/נוצר|עודכן/);
  });
});
