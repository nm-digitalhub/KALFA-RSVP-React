import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import {
  __resetAlertsConfigCacheForTests,
  categoryEnabled,
  getAlertsConfig,
  type AlertsConfig,
} from './alerts-config';

const ROW = {
  slack_alerts_enabled: true,
  slack_bot_token: 'xoxb-abc',
  slack_alert_channel_id: 'C123',
  slack_alert_errors: true,
  slack_alert_campaign_billing: false,
  slack_alert_send_health: true,
  slack_alert_security: false,
  slack_mention_user_id: 'U0ABC123',
  slack_mention_min_level: 'warn',
};

function wireAdmin(result: { data: unknown; error: unknown }): void {
  const { client } = createMockSupabase(result as never);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAlertsConfigCacheForTests();
});

describe('getAlertsConfig', () => {
  it('parses the app_settings row into a typed config', async () => {
    wireAdmin({ data: ROW, error: null });
    const cfg = await getAlertsConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.botToken).toBe('xoxb-abc');
    expect(cfg.channelId).toBe('C123');
    expect(cfg.mentionUserId).toBe('U0ABC123');
    expect(cfg.mentionMinLevel).toBe('warn');
    expect(cfg.categories).toEqual({
      errors: true,
      campaignBilling: false,
      sendHealth: true,
      security: false,
    });
  });

  it('parses each valid mention threshold and treats an unknown value as off', async () => {
    for (const level of ['error', 'warn', 'info'] as const) {
      __resetAlertsConfigCacheForTests();
      wireAdmin({ data: { ...ROW, slack_mention_min_level: level }, error: null });
      const cfg = await getAlertsConfig();
      expect(cfg.mentionMinLevel).toBe(level);
    }
    __resetAlertsConfigCacheForTests();
    wireAdmin({ data: { ...ROW, slack_mention_min_level: 'bogus' }, error: null });
    const cfg = await getAlertsConfig();
    expect(cfg.mentionMinLevel).toBe('off');
  });

  it('defaults mention config to off/null when the columns are blank/missing', async () => {
    wireAdmin({
      data: { ...ROW, slack_mention_user_id: '  ', slack_mention_min_level: 'off' },
      error: null,
    });
    const cfg = await getAlertsConfig();
    expect(cfg.mentionUserId).toBeNull();
    expect(cfg.mentionMinLevel).toBe('off');
  });

  it('treats blank/whitespace token + channel as null', async () => {
    wireAdmin({
      data: { ...ROW, slack_bot_token: '   ', slack_alert_channel_id: '' },
      error: null,
    });
    const cfg = await getAlertsConfig();
    expect(cfg.botToken).toBeNull();
    expect(cfg.channelId).toBeNull();
  });

  it('caches successful reads (no second DB round-trip within the TTL)', async () => {
    wireAdmin({ data: ROW, error: null });
    await getAlertsConfig();
    await getAlertsConfig();
    // Only one client construction / query despite two calls.
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a failed read (recovers on the next call)', async () => {
    wireAdmin({ data: null, error: { message: 'db down' } });
    const first = await getAlertsConfig();
    expect(first.enabled).toBe(false);
    await getAlertsConfig();
    expect(createAdminClient).toHaveBeenCalledTimes(2);
  });

  it('fail-safe: resolves to a fully-disabled config when the client throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    });
    const cfg = await getAlertsConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.botToken).toBeNull();
    expect(cfg.channelId).toBeNull();
    expect(cfg.categories.errors).toBe(false);
  });
});

describe('categoryEnabled', () => {
  const cfg: AlertsConfig = {
    enabled: true,
    botToken: 'x',
    channelId: 'C',
    mentionUserId: null,
    mentionMinLevel: 'off',
    categories: {
      errors: true,
      campaignBilling: false,
      sendHealth: true,
      security: false,
    },
  };

  it('maps each category key to its toggle', () => {
    expect(categoryEnabled(cfg, 'errors')).toBe(true);
    expect(categoryEnabled(cfg, 'campaign_billing')).toBe(false);
    expect(categoryEnabled(cfg, 'send_health')).toBe(true);
    expect(categoryEnabled(cfg, 'security')).toBe(false);
  });
});
