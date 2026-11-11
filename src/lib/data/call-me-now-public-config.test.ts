import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The cache is Next's; this file pins what the function declares to it and what it answers.
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { CALL_ME_NOW_WIDGET_TAG, getCallMeNowWidgetEnabled } from './call-me-now-public-config';

function wireAdmin(result: { data: unknown; error: unknown }): void {
  const { client } = createMockSupabase(result as never);
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
}

const row = (enabled: unknown, ruleId: unknown) => ({
  data: { console_call_me_now_enabled: enabled, voximplant_call_me_now_rule_id: ruleId },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCallMeNowWidgetEnabled', () => {
  it('is on only with the switch on AND a numeric routing rule bound', async () => {
    wireAdmin(row(true, '1523124'));
    expect(await getCallMeNowWidgetEnabled()).toBe(true);
  });

  it.each([
    ['the switch is off', row(false, '1523124')],
    ['no routing rule is bound', row(true, null)],
    ['the routing rule is empty', row(true, '')],
    ['the routing rule is not numeric', row(true, 'rule-7')],
    ['the switch is not exactly true', row(null, '1523124')],
  ])('is off when %s', async (_label, result) => {
    wireAdmin(result);
    expect(await getCallMeNowWidgetEnabled()).toBe(false);
    // A real "off" is a cacheable value, not a failure.
    expect(connection).not.toHaveBeenCalled();
  });

  it('declares its lifetime and the tag the admin actions expire', async () => {
    wireAdmin(row(true, '1523124'));
    await getCallMeNowWidgetEnabled();
    expect(cacheLife).toHaveBeenCalledWith('minutes');
    expect(cacheTag).toHaveBeenCalledWith(CALL_ME_NOW_WIDGET_TAG);
  });

  it('fails closed on a failed read, for this request only, and reads again on the next call', async () => {
    wireAdmin({ data: null, error: { message: 'db down' } });
    expect(await getCallMeNowWidgetEnabled()).toBe(false);
    expect(connection).toHaveBeenCalledTimes(1);

    wireAdmin(row(true, '1523124'));
    expect(await getCallMeNowWidgetEnabled()).toBe(true);
    expect(createAdminClient).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the client cannot be created', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    });
    expect(await getCallMeNowWidgetEnabled()).toBe(false);
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
