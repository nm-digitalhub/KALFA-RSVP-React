import { beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));
// The cache itself is Next's ('use cache' is a build-time directive: under Vitest the function simply runs). What
// this file pins is what the function declares to it, what it returns, and that a failed read is never a value the
// cache could keep.
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { BASELINE_ADMIN_CONFIG } from './cookie-consent-config';
import { COOKIE_CONSENT_CONFIG_TAG, getCookieConsentPublicConfig } from './admin-config';

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

  it('declares its lifetime and the tag the admin actions expire', async () => {
    wireAdmin({ data: ROW, error: null });
    await getCookieConsentPublicConfig();
    expect(cacheLife).toHaveBeenCalledWith('minutes');
    expect(cacheTag).toHaveBeenCalledWith(COOKIE_CONSENT_CONFIG_TAG);
    // A successful read is a cacheable value: it must not be marked request-time.
    expect(connection).not.toHaveBeenCalled();
  });

  it.each([
    ['the database answers with an error', { data: null, error: { message: 'db down' } }],
    ['the settings row is missing', { data: null, error: null }],
  ])('a failed read (%s) is the baseline for this request only, and the next call reads again', async (_label, result) => {
    wireAdmin(result);
    expect(await getCookieConsentPublicConfig()).toEqual(BASELINE_ADMIN_CONFIG);
    // Request-time, so the baseline is never part of a prerendered page.
    expect(connection).toHaveBeenCalledTimes(1);

    wireAdmin({ data: ROW, error: null });
    expect((await getCookieConsentPublicConfig()).revisionBump).toBe(2);
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
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
