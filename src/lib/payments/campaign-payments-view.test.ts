import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ hasPlatformPermission: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ canAccessEvent: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));
vi.mock('./ledger', () => ({ displayedOperations: vi.fn(), staffDisplayedOperations: vi.fn() }));

import { hasPlatformPermission } from '@/lib/auth/dal';
import { canAccessEvent } from '@/lib/data/events';

import { campaignPaymentsView } from './campaign-payments-view';
import { displayedOperations, staffDisplayedOperations } from './ledger';

// The money on a campaign's page is a security boundary: which reader runs decides whether provider references and
// failed attempts can reach the page at all.
describe('campaignPaymentsView — who gets which payments list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(displayedOperations).mockResolvedValue([]);
    vi.mocked(staffDisplayedOperations).mockResolvedValue([]);
  });

  it('staff: only the staff reader runs', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await campaignPaymentsView('e1', 'c1')).toEqual({ audience: 'staff', operations: [] });
    expect(staffDisplayedOperations).toHaveBeenCalledWith({ admin: true }, 'c1');
    expect(displayedOperations).not.toHaveBeenCalled();
  });

  it('a viewer with billing:view: only the customer reader, with exactly the outcomes a customer is shown', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    expect(await campaignPaymentsView('e1', 'c1')).toEqual({ audience: 'customer', operations: [] });
    expect(canAccessEvent).toHaveBeenCalledWith('e1', 'billing', 'view');
    expect(staffDisplayedOperations).not.toHaveBeenCalled();
    const outcomes = vi.mocked(displayedOperations).mock.calls[0][2];
    expect([...outcomes].sort()).toEqual(['pending', 'review', 'succeeded']);
  });

  it('a viewer without billing:view (or whose check failed): nothing is read, nothing is shown', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(canAccessEvent).mockResolvedValue(false);
    expect(await campaignPaymentsView('e1', 'c1')).toBeNull();
    expect(displayedOperations).not.toHaveBeenCalled();
    expect(staffDisplayedOperations).not.toHaveBeenCalled();
  });

  it('a failed read is reported as one (operations null), never as an empty list', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    vi.mocked(displayedOperations).mockRejectedValueOnce(new Error('down'));
    expect(await campaignPaymentsView('e1', 'c1')).toEqual({ audience: 'customer', operations: null });
  });
});
