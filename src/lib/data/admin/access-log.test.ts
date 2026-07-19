import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminClient } from '@/lib/supabase/admin';
import { recordStaffAccess } from './access-log';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

function mockInsert(result: { error: unknown }) {
  const insert = vi.fn(async (_row: Record<string, unknown>) => result);
  const from = vi.fn(() => ({ insert }));
  vi.mocked(createAdminClient).mockReturnValue({
    from,
  } as unknown as ReturnType<typeof createAdminClient>);
  return { from, insert };
}

beforeEach(() => vi.clearAllMocks());

describe('recordStaffAccess', () => {
  it('writes one row via the admin client for an operational (non-break-glass) read', async () => {
    const { from, insert } = mockInsert({ error: null });
    await recordStaffAccess({
      staffId: 's1',
      permission: 'manage_voice',
      subjectType: 'call_attempts',
      subjectId: 'e1',
      ownerId: 'o1',
    });
    expect(from).toHaveBeenCalledWith('support_access_log');
    expect(insert).toHaveBeenCalledTimes(1);
    const firstCall = insert.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const row = firstCall![0];
    expect(row.staff_id).toBe('s1');
    expect(row.owner_id).toBe('o1');
    expect(row.permission).toBe('manage_voice');
    // no reason required, and none supplied -> null
    expect(row.reason).toBeNull();
  });

  it('requires a break-glass reason for view_customer_data / manage_staff', async () => {
    mockInsert({ error: null });
    await expect(
      recordStaffAccess({
        staffId: 's1',
        permission: 'manage_staff',
        subjectType: 'user',
        subjectId: 'u1',
        ownerId: 'u1',
      }),
    ).rejects.toThrow();
    await expect(
      recordStaffAccess({
        staffId: 's1',
        permission: 'view_customer_data',
        subjectType: 'guest_list',
        subjectId: 'e1',
        ownerId: 'o1',
        reason: 'short',
      }),
    ).rejects.toThrow();
  });

  it('accepts a sufficient break-glass reason and stores it', async () => {
    const { insert } = mockInsert({ error: null });
    await recordStaffAccess({
      staffId: 's1',
      permission: 'manage_staff',
      subjectType: 'user',
      subjectId: 'u1',
      ownerId: 'u1',
      reason: 'investigating a billing dispute #4821',
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const firstCall = insert.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const row = firstCall![0];
    expect(row.reason).toBe('investigating a billing dispute #4821');
  });

  it('FAILS CLOSED: an audit-insert error throws (read must not proceed)', async () => {
    mockInsert({ error: { message: 'boom' } });
    await expect(
      recordStaffAccess({
        staffId: 's1',
        permission: 'manage_voice',
        subjectType: 'event',
        subjectId: 'e1',
        ownerId: 'o1',
      }),
    ).rejects.toThrow('הגישה בוטלה');
  });

  it('rejects a row missing the staff or owner spine', async () => {
    mockInsert({ error: null });
    await expect(
      recordStaffAccess({
        staffId: '',
        permission: 'manage_voice',
        subjectType: 'event',
        subjectId: 'e1',
        ownerId: 'o1',
      }),
    ).rejects.toThrow();
  });
});
