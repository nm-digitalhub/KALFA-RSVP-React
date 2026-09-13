import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, configMock, debugMock, adminMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  configMock: vi.fn(),
  debugMock: vi.fn(),
  adminMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: configMock }));
vi.mock('@/lib/whatsapp/debug-token', () => ({ debugToken: debugMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));

import { REQUIRED_SCOPES, getMetaStatus } from './meta-status';

const TOKEN = 'EAAG-SYSTEM-USER-TOKEN-DO-NOT-LEAK';
const SECRET = 'APP-SECRET-DO-NOT-LEAK';

const CONFIG = {
  phoneNumberId: '1018741517998430',
  wabaId: '990921550130385',
  accessToken: TOKEN,
  appSecret: SECRET,
  verifyToken: 'vt',
};

/** app_settings row double; `whatsapp_app_id` absent = today's live schema. */
function mockSettings(row: Record<string, unknown> | null) {
  adminMock.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('META_APP_ID_WA', '1234567890123456');
  permMock.mockResolvedValue({ id: 'u1' });
  configMock.mockResolvedValue(CONFIG);
  mockSettings({});
  debugMock.mockResolvedValue({
    isValid: true,
    expiresAt: 0,
    dataAccessExpiresAt: 1764633600,
    scopes: [...REQUIRED_SCOPES],
    invalidReason: null,
  });
});

describe('getMetaStatus — the gate', () => {
  it('requires manage_settings before reading anything', async () => {
    await getMetaStatus();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
    // The gate must run BEFORE the credentials are read, not alongside them.
    expect(permMock.mock.invocationCallOrder[0]).toBeLessThan(
      configMock.mock.invocationCallOrder[0],
    );
  });
});

describe('getMetaStatus — what it asks Meta', () => {
  it('passes the stored token and app secret with the app id', async () => {
    await getMetaStatus();
    expect(debugMock).toHaveBeenCalledWith({
      appId: '1234567890123456',
      appSecret: SECRET,
      token: TOKEN,
    });
  });

  it('prefers app_settings.whatsapp_app_id over the env fallback', async () => {
    // The column does not exist yet (§4.4, Phase 5). Pinning the precedence now
    // means landing it is a migration and nothing else.
    mockSettings({ whatsapp_app_id: '9999999999999999' });
    await getMetaStatus();
    expect(debugMock.mock.calls[0][0].appId).toBe('9999999999999999');
  });

  it('ignores a blank column value rather than sending an empty app id', async () => {
    mockSettings({ whatsapp_app_id: '   ' });
    await getMetaStatus();
    expect(debugMock.mock.calls[0][0].appId).toBe('1234567890123456');
  });
});

describe('getMetaStatus — the answer', () => {
  it('reports a healthy token with no missing scopes', async () => {
    await expect(getMetaStatus()).resolves.toMatchObject({
      configured: true,
      graphVersion: 'v25.0',
      reason: null,
      token: {
        isValid: true,
        expiresAt: 0,
        dataAccessExpiresAt: 1764633600,
        missingScopes: [],
      },
    });
  });

  it('names exactly the scopes that are missing', async () => {
    debugMock.mockResolvedValue({
      isValid: true,
      expiresAt: 0,
      dataAccessExpiresAt: null,
      scopes: ['whatsapp_business_messaging'],
      invalidReason: null,
    });
    const status = await getMetaStatus();
    expect(status.token?.missingScopes).toEqual([
      'whatsapp_business_management',
      'business_management',
    ]);
  });

  it('an invalid token is reported as invalid, WITH the reason, not as a failure to ask', async () => {
    debugMock.mockResolvedValue({
      isValid: false,
      expiresAt: 1600000000,
      dataAccessExpiresAt: null,
      scopes: [],
      invalidReason: 'Session has expired',
    });
    const status = await getMetaStatus();
    expect(status.token?.isValid).toBe(false);
    expect(status.token?.invalidReason).toBe('Session has expired');
    expect(status.reason).toBeNull();
  });
});

describe('getMetaStatus — "could not ask" never renders as "token is bad"', () => {
  it('WhatsApp not configured at all: configured false, no reason, no call', async () => {
    configMock.mockResolvedValue(null);
    await expect(getMetaStatus()).resolves.toEqual({
      configured: false,
      graphVersion: 'v25.0',
      token: null,
      reason: null,
    });
    expect(debugMock).not.toHaveBeenCalled();
  });

  it('no app secret: says so, and does not call Meta', async () => {
    configMock.mockResolvedValue({ ...CONFIG, appSecret: null });
    const status = await getMetaStatus();
    expect(status.token).toBeNull();
    expect(status.reason).toContain('app secret');
    expect(debugMock).not.toHaveBeenCalled();
  });

  it('no app id anywhere: says so, and does not call Meta', async () => {
    vi.stubEnv('META_APP_ID_WA', '');
    mockSettings({});
    const status = await getMetaStatus();
    expect(status.token).toBeNull();
    expect(status.reason).toContain('META_APP_ID_WA');
    expect(debugMock).not.toHaveBeenCalled();
  });

  it('a settings read failure falls back to env instead of reporting "no app id"', async () => {
    adminMock.mockImplementation(() => {
      throw new Error('service key missing');
    });
    await getMetaStatus();
    expect(debugMock.mock.calls[0][0].appId).toBe('1234567890123456');
  });

  it('a thrown debug_token call becomes a reason, never token.isValid = false', async () => {
    debugMock.mockRejectedValue(new Error('debug_token failed with HTTP 502'));
    const status = await getMetaStatus();
    expect(status.token).toBeNull();
    expect(status.reason).toBeTruthy();
  });
});

describe('getMetaStatus — secrets', () => {
  it('returns no token, app secret or app-token string in ANY branch', async () => {
    const branches = [
      async () => getMetaStatus(),
      async () => {
        debugMock.mockRejectedValue(new Error('boom'));
        return getMetaStatus();
      },
      async () => {
        configMock.mockResolvedValue({ ...CONFIG, appSecret: null });
        return getMetaStatus();
      },
    ];
    for (const run of branches) {
      const serialized = JSON.stringify(await run());
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain(SECRET);
    }
  });
});
