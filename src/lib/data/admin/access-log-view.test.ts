import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { listStaffAccessLog } from './access-log-view';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'owner-1' } as unknown as User);
});

describe('listStaffAccessLog', () => {
  it('does NOT query when the manage_staff gate rejects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    await expect(listStaffAccessLog()).rejects.toThrow();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('gates on manage_staff, resolves names, and never selects a PII value column', async () => {
    let logSelect = '';
    const logBuilder: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'range']) {
      logBuilder[m] = vi.fn((...a: unknown[]) => {
        if (m === 'select') logSelect = String(a[0]);
        return logBuilder;
      });
    }
    (logBuilder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
      onF({
        data: [
          {
            id: 'l1',
            staff_id: 'staff-1',
            owner_id: 'owner-9',
            permission: 'manage_voice',
            subject_type: 'call_attempts',
            subject_id: 'e1',
            reason: null,
            accessed_at: '2026-07-20T00:00:00Z',
          },
        ],
        error: null,
        count: 1,
      });
    const profBuilder: Record<string, unknown> = {};
    profBuilder.select = vi.fn(() => profBuilder);
    profBuilder.in = vi.fn(async () => ({
      data: [
        { id: 'staff-1', full_name: 'נציג בדיקה' },
        { id: 'owner-9', full_name: 'לקוח בדיקה' },
      ],
    }));

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((t: string) => (t === 'profiles' ? profBuilder : logBuilder)),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await listStaffAccessLog();

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_staff');
    // The audit log holds only metadata — the select must not reach for anything
    // that could carry customer PII content.
    expect(logSelect).not.toContain('*');
    expect(logSelect).toContain('permission');
    const e = res.items[0];
    expect(e.staffName).toBe('נציג בדיקה');
    expect(e.ownerName).toBe('לקוח בדיקה');
    expect(e.subjectLabel).toBe('שיחות');
    expect(res.total).toBe(1);
  });
});
