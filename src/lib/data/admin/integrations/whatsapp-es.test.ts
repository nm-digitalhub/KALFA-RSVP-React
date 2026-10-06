import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  owner: vi.fn(),
  perm: vi.fn(),
  appId: vi.fn(),
  config: vi.fn(),
  debug: vi.fn(),
  exchange: vi.fn(),
  subscribeWaba: vi.fn(),
  status: vi.fn(),
  sync: vi.fn(),
  numbers: vi.fn(),
  getSubs: vi.fn(),
  readSub: vi.fn(),
  subscribeApp: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  activity: vi.fn(),
  slack: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({
  requirePlatformOwner: h.owner,
  requirePlatformPermission: h.perm,
}));
vi.mock('@/lib/whatsapp/meta-app-id', () => ({ resolveMetaAppId: h.appId }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: h.config }));
vi.mock('@/lib/whatsapp/debug-token', () => ({ debugToken: h.debug }));
vi.mock('@/lib/whatsapp/embedded-signup/graph', () => ({
  exchangeCodeForBusinessToken: h.exchange,
  subscribeAppToWaba: h.subscribeWaba,
  getCoexistenceStatus: h.status,
  requestSmbSync: h.sync,
}));
vi.mock('@/lib/whatsapp/phone-numbers', () => ({ listWabaPhoneNumbers: h.numbers }));
vi.mock('@/lib/whatsapp/subscriptions', () => ({
  getAppSubscriptions: h.getSubs,
  readWhatsAppSubscription: h.readSub,
  subscribeWhatsAppWebhook: h.subscribeApp,
}));
vi.mock('@/lib/url', () => ({ getAppUrl: async (p: string) => `https://beta.kalfa.me${p}` }));
vi.mock('@/lib/data/activity', () => ({ logActivity: h.activity }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: h.slack }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: h.rpc,
    from: () => ({
      update: (patch: unknown) => ({ eq: () => h.update(patch) }),
      select: () => ({ eq: () => ({ order: () => h.select() }) }),
    }),
  }),
}));

import { connectViaEmbeddedSignup, ES_KIND, ES_PROVIDER, listEsConnections } from './whatsapp-es';

const COEX = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' as const;
const TOKEN = 'EAAB-BUSINESS-TOKEN-DO-NOT-LEAK';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('META_ES_CONFIG_ID', '123456789012345');
  h.owner.mockResolvedValue({ id: 'owner-uuid' });
  h.appId.mockResolvedValue('1667254024607706');
  h.config.mockResolvedValue({ appSecret: 'APP-SECRET', verifyToken: 'VERIFY' });
  h.exchange.mockResolvedValue(TOKEN);
  h.debug.mockResolvedValue({
    isValid: true,
    expiresAt: 0,
    granularScopes: [
      { scope: 'whatsapp_business_management', targetIds: ['222'] },
      { scope: 'whatsapp_business_messaging', targetIds: ['222'] },
    ],
  });
  h.subscribeWaba.mockResolvedValue(undefined);
  h.numbers.mockResolvedValue({
    numbers: [{ id: '999', display_phone_number: '+972 50-000-0000' }],
    degraded: false,
    complete: true,
  });
  h.status.mockResolvedValue({ isOnBizApp: true, platformType: 'CLOUD_API' });
  h.rpc.mockResolvedValue({ data: 'conn-uuid', error: null });
  h.getSubs.mockResolvedValue([]);
  h.readSub.mockReturnValue({ kind: 'ok', fields: [] });
  h.sync.mockImplementation(async ({ syncType }: { syncType: string }) => ({ requestId: `R-${syncType}` }));
  h.update.mockResolvedValue({ error: null });
});

describe('connectViaEmbeddedSignup', () => {
  it('happy path: stores the token in Vault under the ES provider and runs both syncs', async () => {
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r).toEqual({
      ok: true,
      display: '+972 50-000-0000',
      isOnBizApp: true,
      platformType: 'CLOUD_API',
      sync: { contacts: 'requested', history: 'requested' },
    });
    expect(h.rpc).toHaveBeenCalledWith(
      'integrations_write_credential',
      expect.objectContaining({
        p_provider: ES_PROVIDER,
        p_credential_kind: ES_KIND,
        p_secret: TOKEN,
        p_created_by: 'owner-uuid',
        p_expires_at: null,
      }),
    );
    // Every call made with the business token carries the app secret for appsecret_proof.
    expect(h.subscribeWaba).toHaveBeenCalledWith({ wabaId: '222', token: TOKEN, appSecret: 'APP-SECRET' });
    expect(h.numbers).toHaveBeenCalledWith({ wabaId: '222', accessToken: TOKEN, appSecret: 'APP-SECRET' });
    expect(h.status).toHaveBeenCalledWith({ phoneNumberId: '999', token: TOKEN, appSecret: 'APP-SECRET' });
    for (const call of h.sync.mock.calls) expect(call[0]).toMatchObject({ appSecret: 'APP-SECRET' });
    expect(h.sync.mock.calls.map((c) => c[0].syncType)).toEqual(['smb_app_state_sync', 'history']);
    // The token is written to Vault BEFORE the one-shot sync.
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.sync.mock.invocationCallOrder[0]);
  });

  it('refuses an unsupported finish event before spending the code', async () => {
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: 'FINISH' });
    expect(r.ok).toBe(false);
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it('a token that grants no WABA stores nothing', async () => {
    h.debug.mockResolvedValue({ isValid: true, expiresAt: 0, granularScopes: [] });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.subscribeWaba).not.toHaveBeenCalled();
  });

  it('a token that grants two WABAs stores nothing', async () => {
    h.debug.mockResolvedValue({
      isValid: true,
      expiresAt: 0,
      granularScopes: [{ scope: 'whatsapp_business_management', targetIds: ['222', '333'] }],
    });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('subscription still not ok after re-subscribing: token saved, NO sync spent', async () => {
    h.readSub.mockReturnValue({ kind: 'missing_fields', fields: [], missing: ['history'] });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.subscribeApp).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('a failed token write spends no sync', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('history failing does not cancel contacts', async () => {
    h.sync.mockImplementation(async ({ syncType }: { syncType: string }) => {
      if (syncType === 'history') throw new Error('smb_app_data history failed: HTTP 400');
      return { requestId: 'R1' };
    });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r).toMatchObject({ ok: true, sync: { contacts: 'requested', history: 'failed' } });
  });

  it('audit carries no ids, number or token', async () => {
    await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    const logged = JSON.stringify(h.activity.mock.calls[0][0]);
    expect(logged).not.toMatch(/222|999|\+972|EAAB/);
    expect(JSON.stringify(h.slack.mock.calls[0][0])).not.toMatch(/222|999|\+972|EAAB/);
  });

  it('missing config id refuses without any Meta call', async () => {
    vi.stubEnv('META_ES_CONFIG_ID', '');
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it('the owner gate runs first: a rejection reaches no Meta call', async () => {
    h.owner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(
      connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it('an expired code returns a safe message', async () => {
    h.exchange.mockRejectedValue(new Error('token exchange failed: HTTP 400 (code 100)'));
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('תוקף הקוד') });
  });

  it('subscription gate failure: says to reconnect (no fix window it cannot honour) and is audited', async () => {
    h.readSub.mockReturnValue({ kind: 'missing_fields', fields: [], missing: ['history'] });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).not.toContain('24 שעות לתקן');
    expect(h.activity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.integrations.whatsapp_es_connected',
        meta: expect.objectContaining({ contactsSync: 'skipped', historySync: 'skipped' }),
      }),
    );
  });

  it('a throw after the syncs were spent still reports ok, so nobody retries into a second sync', async () => {
    h.activity.mockRejectedValue(new Error('audit down'));
    h.update.mockRejectedValue(new Error('update threw'));
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r).toMatchObject({ ok: true, sync: { contacts: 'requested', history: 'requested' } });
  });

  it('does not subscribe the app to a WABA whose number cannot be determined', async () => {
    h.numbers.mockResolvedValue({ numbers: [], degraded: false, complete: true });
    const r = await connectViaEmbeddedSignup({ code: 'CODE-123456', finishEvent: COEX });
    expect(r.ok).toBe(false);
    expect(h.subscribeWaba).not.toHaveBeenCalled();
  });
});

describe('listEsConnections', () => {
  it('reports each sync type separately, so a failed sync never reads as done', async () => {
    h.perm.mockResolvedValue({ id: 'u' });
    h.select.mockResolvedValue({
      data: [
        {
          label: 'WhatsApp +972',
          status: 'active',
          created_at: '2026-09-25T10:00:00Z',
          metadata: {
            platformType: 'CLOUD_API',
            sync: {
              requestedAt: '2026-09-25T10:01:00Z',
              contacts: { status: 'requested', requestId: 'R1' },
              history: { status: 'failed', requestId: null },
            },
          },
        },
      ],
      error: null,
    });
    const [row] = await listEsConnections();
    expect(row.sync).toEqual({ requestedAt: '2026-09-25T10:01:00Z', contacts: 'requested', history: 'failed' });
    expect(JSON.stringify(row)).not.toContain('R1');
  });
});
