import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformStaff: vi.fn(),
  requirePlatformPermission: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));
vi.mock('@/lib/data/campaign-delivery', () => ({ fetchDeliveryBreakdown: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ CAMPAIGN_COLUMNS: 'id' }));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hasPlatformPermission,
  requirePlatformPermission,
  requirePlatformStaff,
} from '@/lib/auth/dal';
import { listCampaignsForAdmin, WINDDOWN_STATUSES as REEXPORTED } from '@/lib/data/admin/campaigns';
import { getAdminNavCounts } from '@/lib/data/admin/nav-counts';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import {
  ADMIN_ATTENTION_FILTER,
  WINDDOWN_STATUSES,
  countWinddownCampaigns,
  getCampaignsStatusSummary,
} from './campaigns';

type AdminClient = ReturnType<typeof createAdminClient>;

const NOW = Date.parse('2026-09-24T22:30:00Z'); // 01:30 Israel on the 25th

// Each row carries the text the admin list shows (the event name): the core
// must count past it and return none of it.
const ev = { name: 'החתונה של דנה ויוסי', event_date: '2026-10-01T17:00:00Z' };
function db() {
  return createFakeCountClient({
    campaigns: [
      { id: 'k1', status: 'active', created_at: '2026-09-24T21:10:00Z', events: ev },
      { id: 'k2', status: 'active', created_at: '2026-09-10T10:00:00Z', events: ev },
      { id: 'k3', status: 'paused', created_at: '2026-09-20T10:00:00Z', events: ev },
      { id: 'k4', status: 'closed', created_at: '2026-08-01T10:00:00Z', events: ev },
      // approved: the terms are approved and the package is not paid — not a wind-down row
      { id: 'k5', status: 'approved', created_at: '2026-09-24T20:00:00Z', events: ev },
      { id: 'k6', status: 'approved', created_at: '2026-09-23T10:00:00Z', events: ev },
      { id: 'k7', status: 'approved', created_at: '2026-09-23T10:00:00Z', events: ev },
      { id: 'k8', status: 'paid', created_at: '2026-09-22T10:00:00Z', events: ev },
      { id: 'k9', status: 'draft', created_at: '2026-09-24T22:00:00Z', events: ev },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformStaff).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(hasPlatformPermission).mockResolvedValue(true);
});

describe('getCampaignsStatusSummary (core)', () => {
  it('counts current state and campaigns created in range', async () => {
    const { client } = db();
    const s = await getCampaignsStatusSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      active: 2,
      paused: 1,
      closed: 1,
      winddown: 4,
      needsAttention: 4,
      createdInRange: 2, // k1 21:10Z and k9 22:00Z; k5 20:00Z is 23:00 Israel on the 24th
    });
    const s30 = await getCampaignsStatusSummary(client as unknown as AdminClient, '30d', NOW);
    expect(s30.createdInRange).toBe(8); // all but k4 (1.8)
  });

  it('every query is a head-only exact count on campaigns', async () => {
    const { client, calls } = db();
    await getCampaignsStatusSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c.table).toBe('campaigns');
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    expect(calls.some((c) => c.filters.some((f) => f.op === 'or' && f.args[0] === ADMIN_ATTENTION_FILTER))).toBe(true);
    expect(
      calls.some((c) => c.filters.some((f) => f.op === 'gte' && f.args[1] === '2026-09-17T22:30:00.000Z')),
    ).toBe(true);
  });

  it('result is numbers only — no event name', async () => {
    const { client } = db();
    const s = await getCampaignsStatusSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('דנה');
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['campaigns'] });
    await expect(
      getCampaignsStatusSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });

  it('WINDDOWN_STATUSES is unchanged and re-exported from the admin module', () => {
    expect([...WINDDOWN_STATUSES]).toEqual(['active', 'paused', 'closed']);
    expect(REEXPORTED).toBe(WINDDOWN_STATUSES);
  });
});

describe('wrapper ↔ core parity (same data, same number)', () => {
  it('the /admin/campaigns list has exactly needsAttention rows', async () => {
    const { client, calls } = db();
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    const list = await listCampaignsForAdmin();
    const core = await getCampaignsStatusSummary(client as unknown as AdminClient, 'today', NOW);
    expect(list).toHaveLength(core.needsAttention);
    expect(list.map((r) => r.id).sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    // The list and the count use the one shared filter string.
    expect(calls[0].filters).toContainEqual({ op: 'or', args: [ADMIN_ATTENTION_FILTER] });
  });

  it('the sidebar campaigns badge equals the core winddown count', async () => {
    const { client } = db();
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    const nav = await getAdminNavCounts();
    expect(nav.campaigns).toBe(await countWinddownCampaigns(client as unknown as AdminClient));
    expect(nav.campaigns).toBe(4);
  });

  it('the badge keeps its fail-soft 0 on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['campaigns'] });
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as AdminClient);
    expect((await getAdminNavCounts()).campaigns).toBe(0);
  });
});

// The proactive report's closed window (cores/window.ts): the Israel day of
// 24.9, [23.9 21:00Z, 24.9 21:00Z).
const DAY_24 = { sinceIso: '2026-09-23T21:00:00.000Z', untilIso: '2026-09-24T21:00:00.000Z' };

describe('getCampaignsStatusSummary with a window', () => {
  it('bounds createdInRange to [since, until); current state is unchanged', async () => {
    const { client } = db();
    const s = await getCampaignsStatusSummary(client as unknown as AdminClient, 'today', NOW, DAY_24);
    expect(s).toEqual({
      active: 2,
      paused: 1,
      closed: 1,
      winddown: 4,
      needsAttention: 4,
      createdInRange: 1, // k5 (20:00Z); k1 and k9 are after the until bound
    });
  });

  it('adds the until bound only when a window is given', async () => {
    const { client, calls } = db();
    await getCampaignsStatusSummary(client as unknown as AdminClient, 'today', NOW);
    expect(calls.flatMap((c) => c.filters).some((f) => f.op === 'lt')).toBe(false);
  });
});
