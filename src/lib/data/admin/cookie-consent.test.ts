import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { CONSENT_REVISION } from '@/lib/consent/cookie-consent-config';
import {
  getCookieConsentAdminView,
  updateCookieConsentEnabled,
  updateCookieConsentAnalyticsEnabled,
  updateCookieConsentMarketingEnabled,
  bumpCookieConsentRevision,
} from './cookie-consent';

type Row = Record<string, unknown>;

function mock(row: Row | null) {
  const { client, builder } = createMockSupabase<Row>({ data: row, error: null });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, builder };
}

// Each toggle function does TWO sequential `.from('app_settings')` calls with
// DIFFERENT PostgREST result shapes: (1) readCurrentBump's
// `.select().eq().maybeSingle()` — resolves to a single object; (2) the
// conditional `.update().eq().neq().select()` — resolves to an ARRAY (empty
// when the `.neq()` filter matched no row, i.e. a genuine no-op). The shared
// single-result `createMockSupabase` helper can't express two different
// shapes in one test, so this builds a from() double that returns a
// different chain per call, in order.
function mockSequential(
  currentBumpRow: { cookie_consent_revision_bump: number } | null,
  updateResult: { data: Row[] | null; error: unknown },
) {
  const readBuilder = {
    select: vi.fn((_cols?: string) => readBuilder),
    eq: vi.fn((_col: string, _val: unknown) => readBuilder),
    maybeSingle: vi.fn(() => readBuilder),
    then: (onFulfilled: (v: unknown) => unknown) =>
      onFulfilled({ data: currentBumpRow, error: null }),
  };
  const writeBuilder = {
    update: vi.fn((_patch: Record<string, unknown>) => writeBuilder),
    eq: vi.fn((_col: string, _val: unknown) => writeBuilder),
    neq: vi.fn((_col: string, _val: unknown) => writeBuilder),
    select: vi.fn((_cols?: string) => writeBuilder),
    then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(updateResult),
  };
  const from = vi.fn().mockReturnValueOnce(readBuilder).mockReturnValueOnce(writeBuilder);
  const client = { from };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { readBuilder, writeBuilder };
}

beforeEach(() => vi.clearAllMocks());

describe('getCookieConsentAdminView', () => {
  it('parses the row and computes effectiveRevision = CONSENT_REVISION + bump', async () => {
    mock({
      cookie_consent_enabled: true,
      cookie_consent_analytics_enabled: false,
      cookie_consent_marketing_enabled: true,
      cookie_consent_revision_bump: 4,
    });
    const view = await getCookieConsentAdminView();
    expect(view.enabled).toBe(true);
    expect(view.analyticsEnabled).toBe(false);
    expect(view.marketingEnabled).toBe(true);
    expect(view.revisionBump).toBe(4);
    expect(view.effectiveRevision).toBe(CONSENT_REVISION + 4);
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('handles a missing row with SAFE defaults (enabled)', async () => {
    mock(null);
    const view = await getCookieConsentAdminView();
    expect(view.enabled).toBe(true);
    expect(view.analyticsEnabled).toBe(true);
    expect(view.marketingEnabled).toBe(true);
    expect(view.revisionBump).toBe(0);
  });
});

describe('single-row-update + automatic bump on a REAL change (plan §2.2)', () => {
  it('updateCookieConsentEnabled writes the flag AND the incremented bump in ONE update() call, reports changed=true', async () => {
    const { writeBuilder } = mockSequential(
      { cookie_consent_revision_bump: 5 },
      { data: [{ cookie_consent_revision_bump: 6 }], error: null },
    );
    const outcome = await updateCookieConsentEnabled(false);
    expect(outcome).toEqual({ changed: true, revisionBump: 6 });
    expect(writeBuilder.update).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(writeBuilder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cookie_consent_enabled).toBe(false);
    expect(payload.cookie_consent_revision_bump).toBe(6); // 5 + 1
    // The conditional guard: only apply when the live value differs.
    expect(writeBuilder.neq).toHaveBeenCalledWith('cookie_consent_enabled', false);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.cookie_consent.master_toggled',
        meta: { enabled: false },
      }),
    );
  });

  it('updateCookieConsentAnalyticsEnabled bumps in the same update() call on a real change', async () => {
    const { writeBuilder } = mockSequential(
      { cookie_consent_revision_bump: 0 },
      { data: [{ cookie_consent_revision_bump: 1 }], error: null },
    );
    const outcome = await updateCookieConsentAnalyticsEnabled(false);
    expect(outcome).toEqual({ changed: true, revisionBump: 1 });
    const payload = vi.mocked(writeBuilder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cookie_consent_analytics_enabled).toBe(false);
    expect(payload.cookie_consent_revision_bump).toBe(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.cookie_consent.category_toggled',
        meta: { category: 'analytics', enabled: false },
      }),
    );
  });

  it('updateCookieConsentMarketingEnabled bumps in the same update() call on a real change', async () => {
    const { writeBuilder } = mockSequential(
      { cookie_consent_revision_bump: 10 },
      { data: [{ cookie_consent_revision_bump: 11 }], error: null },
    );
    const outcome = await updateCookieConsentMarketingEnabled(true);
    expect(outcome).toEqual({ changed: true, revisionBump: 11 });
    const payload = vi.mocked(writeBuilder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cookie_consent_marketing_enabled).toBe(true);
    expect(payload.cookie_consent_revision_bump).toBe(11);
  });

  it('treats a missing/null current bump as 0 before incrementing', async () => {
    const { writeBuilder } = mockSequential(null, {
      data: [{ cookie_consent_revision_bump: 1 }],
      error: null,
    });
    await updateCookieConsentEnabled(true);
    const payload = vi.mocked(writeBuilder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.cookie_consent_revision_bump).toBe(1);
  });
});

describe('no-op safety — submitting a value the flag already has (owner live-test finding, 27.7)', () => {
  it('updateCookieConsentEnabled: .neq() matches no row -> does not bump, does not log, reports changed=false', async () => {
    mockSequential(
      { cookie_consent_revision_bump: 5 },
      { data: [], error: null }, // .neq() filter matched nothing — already at this value
    );
    const outcome = await updateCookieConsentEnabled(true);
    expect(outcome).toEqual({ changed: false, revisionBump: 5 }); // unchanged bump, NOT 6
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('updateCookieConsentAnalyticsEnabled: no-op does not bump or log', async () => {
    mockSequential({ cookie_consent_revision_bump: 3 }, { data: [], error: null });
    const outcome = await updateCookieConsentAnalyticsEnabled(false);
    expect(outcome).toEqual({ changed: false, revisionBump: 3 });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('updateCookieConsentMarketingEnabled: no-op does not bump or log', async () => {
    mockSequential({ cookie_consent_revision_bump: 8 }, { data: [], error: null });
    const outcome = await updateCookieConsentMarketingEnabled(true);
    expect(outcome).toEqual({ changed: false, revisionBump: 8 });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('a null data result (not just an empty array) is also treated as no-op, not a crash', async () => {
    mockSequential({ cookie_consent_revision_bump: 2 }, { data: null, error: null });
    const outcome = await updateCookieConsentEnabled(false);
    expect(outcome.changed).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('bumpCookieConsentRevision', () => {
  it('increments without touching any flag column and always logs (every click is a real action)', async () => {
    const { builder } = mock({ cookie_consent_revision_bump: 7 });
    const next = await bumpCookieConsentRevision();
    expect(next).toBe(8);
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ cookie_consent_revision_bump: 8 });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.cookie_consent.revision_bumped',
        meta: { revisionBump: 8 },
      }),
    );
  });
});

describe('authorization', () => {
  it('every write function checks requirePlatformPermission("manage_settings") before touching the DB', async () => {
    mock({ cookie_consent_revision_bump: 0 });
    await updateCookieConsentEnabled(true);
    mock({ cookie_consent_revision_bump: 0 });
    await updateCookieConsentAnalyticsEnabled(true);
    mock({ cookie_consent_revision_bump: 0 });
    await updateCookieConsentMarketingEnabled(true);
    mock({ cookie_consent_revision_bump: 0 });
    await bumpCookieConsentRevision();
    expect(vi.mocked(requirePlatformPermission).mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const call of vi.mocked(requirePlatformPermission).mock.calls) {
      expect(call[0]).toBe('manage_settings');
    }
  });
});
