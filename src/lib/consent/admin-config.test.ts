import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { BASELINE_ADMIN_CONFIG } from './cookie-consent-config';
import {
  __resetCookieConsentPublicConfigCacheForTests,
  getCookieConsentPublicConfig,
} from './admin-config';

const ROW = {
  cookie_consent_enabled: true,
  cookie_consent_analytics_enabled: false,
  cookie_consent_marketing_enabled: true,
  cookie_consent_revision_bump: 2,
};

function wireAdmin(result: { data: unknown; error: unknown }): void {
  const { client } = createMockSupabase(result as never);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCookieConsentPublicConfigCacheForTests();
});

describe('getCookieConsentPublicConfig', () => {
  it('parses the app_settings row into a typed config', async () => {
    wireAdmin({ data: ROW, error: null });
    const cfg = await getCookieConsentPublicConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.analyticsEnabled).toBe(false);
    expect(cfg.marketingEnabled).toBe(true);
    expect(cfg.revisionBump).toBe(2);
  });

  it('treats anything but explicit false as enabled (SAFE default)', async () => {
    wireAdmin({
      data: {
        cookie_consent_enabled: null,
        cookie_consent_analytics_enabled: undefined,
        cookie_consent_marketing_enabled: true,
        cookie_consent_revision_bump: null,
      },
      error: null,
    });
    const cfg = await getCookieConsentPublicConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.analyticsEnabled).toBe(true);
    expect(cfg.revisionBump).toBe(0);
  });

  it('caches successful reads (no second DB round-trip within the TTL)', async () => {
    wireAdmin({ data: ROW, error: null });
    await getCookieConsentPublicConfig();
    await getCookieConsentPublicConfig();
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a failed read (recovers on the next call)', async () => {
    wireAdmin({ data: null, error: { message: 'db down' } });
    const first = await getCookieConsentPublicConfig();
    expect(first).toEqual(BASELINE_ADMIN_CONFIG);
    await getCookieConsentPublicConfig();
    expect(createAdminClient).toHaveBeenCalledTimes(2);
  });

  it('fail-safe: resolves to BASELINE (not fully-disabled) when the client throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    });
    const cfg = await getCookieConsentPublicConfig();
    expect(cfg).toEqual(BASELINE_ADMIN_CONFIG);
    expect(cfg.enabled).toBe(true);
    expect(cfg.analyticsEnabled).toBe(true);
    expect(cfg.marketingEnabled).toBe(true);
  });
});
