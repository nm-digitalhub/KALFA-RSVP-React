import { beforeEach, describe, expect, it, vi } from 'vitest';

// event-stats.ts begins with `import 'server-only'` and pulls in the cookie
// client + gates at module load; stub them so the pure helpers and the
// orchestrator can be imported and exercised without a database.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({
  requireEventAccess: vi.fn(),
  canAccessEvent: vi.fn(),
  getEvent: vi.fn(),
}));
vi.mock('@/lib/data/guests', () => ({ getGuestTotals: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForEvent: vi.fn() }));
vi.mock('@/lib/data/campaign-delivery', () => ({
  getCampaignDeliveryBreakdown: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ getCampaignBillingSummary: vi.fn() }));

import {
  derivePercentages,
  deriveStatsAlerts,
  getEventStats,
} from '@/lib/data/event-stats';
import type { GuestTotals } from '@/lib/data/guests';
import {
  canAccessEvent,
  getEvent,
  requireEventAccess,
} from '@/lib/data/events';
import { getGuestTotals } from '@/lib/data/guests';
import { getCampaignForEvent } from '@/lib/data/campaigns';
import { getCampaignDeliveryBreakdown } from '@/lib/data/campaign-delivery';
import { getCampaignBillingSummary } from '@/lib/data/billing';

const mkTotals = (over: Partial<GuestTotals> = {}): GuestTotals => ({
  rows: 0,
  invited_people: 0,
  attending_rows: 0,
  attending_people: 0,
  declined_rows: 0,
  maybe_rows: 0,
  pending_rows: 0,
  over_invited_rows: 0,
  over_invited_people: 0,
  ...over,
});

describe('derivePercentages (pure)', () => {
  it('rows=0 → all null/zeros, no division-by-zero', () => {
    expect(derivePercentages(mkTotals())).toEqual({
      responseRate: null,
      attendingRate: null,
      attendingPeopleRate: null,
    });
  });

  it('response rate = (attending+declined+maybe)/rows', () => {
    const p = derivePercentages(mkTotals({ rows: 10, attending_rows: 4, declined_rows: 3, maybe_rows: 1 }));
    expect(p.responseRate).toBe(80); // (4+3+1)/10
    expect(p.attendingRate).toBe(40); // 4/10
  });

  it('attending people rate = attending_people/invited_people, null when invited=0', () => {
    expect(
      derivePercentages(mkTotals({ invited_people: 0, attending_people: 5 })).attendingPeopleRate,
    ).toBeNull();
    expect(
      derivePercentages(mkTotals({ invited_people: 20, attending_people: 8 })).attendingPeopleRate,
    ).toBe(40);
  });
});

describe('deriveStatsAlerts (pure)', () => {
  it('high_pending when pending/rows ≥ 0.5', () => {
    const alerts = deriveStatsAlerts({ totals: mkTotals({ rows: 10, pending_rows: 6, maybe_rows: 0 }) });
    expect(alerts.map((a) => a.id)).toContain('high_pending');
  });

  it('no high_pending when below threshold', () => {
    const alerts = deriveStatsAlerts({ totals: mkTotals({ rows: 10, pending_rows: 2, maybe_rows: 1 }) });
    expect(alerts.map((a) => a.id)).not.toContain('high_pending');
  });

  it('failed_deliveries and wrong_numbers when counts > 0', () => {
    const alerts = deriveStatsAlerts({ delivery: { failed: 2, wrongNumber: 1 } });
    expect(alerts.map((a) => a.id)).toEqual(expect.arrayContaining(['failed_deliveries', 'wrong_numbers']));
  });

  it('over_invited when over_invited_rows > 0', () => {
    const alerts = deriveStatsAlerts({ totals: mkTotals({ over_invited_rows: 3 }) });
    expect(alerts.map((a) => a.id)).toContain('over_invited');
  });

  it('ceiling_near_usage when accrued/ceiling ≥ 0.9', () => {
    const alerts = deriveStatsAlerts({ billing: { accrued: 90, ceiling: 100 } });
    expect(alerts.map((a) => a.id)).toContain('ceiling_near_usage');
  });

  it('campaign_closed_not_settled when status=closed && finalChargeAmount==null', () => {
    const alerts = deriveStatsAlerts({ campaign: { status: 'closed', finalChargeAmount: null } });
    expect(alerts.map((a) => a.id)).toContain('campaign_closed_not_settled');
  });

  it('no campaign_closed_not_settled when settled', () => {
    const alerts = deriveStatsAlerts({ campaign: { status: 'closed', finalChargeAmount: 50 } });
    expect(alerts.map((a) => a.id)).not.toContain('campaign_closed_not_settled');
  });
});

describe('getEventStats orchestration', () => {
  const requireEventAccessMock = requireEventAccess as unknown as ReturnType<typeof vi.fn>;
  const canAccessEventMock = canAccessEvent as unknown as ReturnType<typeof vi.fn>;
  const getEventMock = getEvent as unknown as ReturnType<typeof vi.fn>;
  const getGuestTotalsMock = getGuestTotals as unknown as ReturnType<typeof vi.fn>;
  const getCampaignForEventMock = getCampaignForEvent as unknown as ReturnType<typeof vi.fn>;
  const getCampaignDeliveryBreakdownMock = getCampaignDeliveryBreakdown as unknown as ReturnType<typeof vi.fn>;
  const getCampaignBillingSummaryMock = getCampaignBillingSummary as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    requireEventAccessMock.mockResolvedValue(undefined);
  });

  it('calls the reports.view page gate before any source load', async () => {
    canAccessEventMock.mockResolvedValue(false);
    getEventMock.mockResolvedValue(null);
    getGuestTotalsMock.mockResolvedValue(null);
    getCampaignForEventMock.mockResolvedValue(null);
    await getEventStats('evt-1');
    expect(requireEventAccessMock).toHaveBeenCalledWith('evt-1', 'reports', 'view');
    // gate ran first
    expect(requireEventAccessMock.mock.invocationCallOrder[0]).toBeLessThan(
      canAccessEventMock.mock.invocationCallOrder[0],
    );
  });

  it('empty event (with perms) → empty campaign, no delivery/billing, no PII', async () => {
    canAccessEventMock.mockResolvedValue(true);
    getEventMock.mockResolvedValue(null);
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 0 }));
    getCampaignForEventMock.mockResolvedValue(null);
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('empty');
    expect(r.campaign.delivery).toBeNull();
    expect(r.campaign.billing).toBeNull();
    // no PII fields ever present
    expect(JSON.stringify(r)).not.toMatch(/rsvp_token|gift_link_token|card_token_ref/);
  });

  it('permission-limited: reports.view ok but campaigns.view false → non-sensitive state, no billing call', async () => {
    vi.mocked(canAccessEvent).mockImplementation(async (_e, resource) => resource !== 'campaigns' && resource !== 'billing');
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4, attending_rows: 2 }));
    getCampaignForEventMock.mockResolvedValue(null);
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('permission_limited');
    expect(getCampaignBillingSummary).not.toHaveBeenCalled();
  });

  it('billing not called without billing.view even if campaigns.view present', async () => {
    vi.mocked(canAccessEvent).mockImplementation(async (_e, resource) => resource !== 'billing');
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4 }));
    getCampaignForEventMock.mockResolvedValue({ id: 'c-1', status: 'active', capture_status: 'captured', max_contacts: 100, final_charge_amount: null });
    getCampaignDeliveryBreakdownMock.mockResolvedValue({ delivery: { sent: 1, delivered: 1, read: 1, failed: 0 }, outcome: { reached: 1, wrongNumber: 0, optedOut: 0 } });
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('visible');
    expect(r.campaign.billing).toBeNull();
    expect(getCampaignBillingSummary).not.toHaveBeenCalled();
    // operational reached still derived from delivery (campaigns.view only)
    expect(r.campaign.reachedCount).toBe(1);
  });

  it('billing called only when campaigns.view AND billing.view present', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4 }));
    getCampaignForEventMock.mockResolvedValue({ id: 'c-1', status: 'closed', capture_status: 'captured', max_contacts: 100, final_charge_amount: null });
    getCampaignDeliveryBreakdownMock.mockResolvedValue({ delivery: { sent: 2, delivered: 2, read: 1, failed: 0 }, outcome: { reached: 2, wrongNumber: 0, optedOut: 0 } });
    getCampaignBillingSummaryMock.mockResolvedValue({ reachedCount: 2, accrued: 90, ceiling: 100, maxContacts: 100 });
    const r = await getEventStats('evt-1');
    expect(getCampaignBillingSummary).toHaveBeenCalledWith('c-1');
    expect(r.campaign.billing).toEqual({ reachedCount: 2, accrued: 90, ceiling: 100, maxContacts: 100 });
  });

  it('operational failure after auth → error flag, no raw error exposed', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockRejectedValue(new Error('boom'));
    getCampaignForEventMock.mockResolvedValue(null);
    const r = await getEventStats('evt-1');
    expect(r.totalsState).toBe('error');
    expect(r.campaign.state).toBe('empty');
  });

  it('never returns PII fields (no-PII regression)', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    getEventMock.mockResolvedValue({
      id: 'evt-1',
      name: 'E',
      event_type: 'wedding',
      event_date: null,
      rsvp_deadline: null,
      status: 'active',
      // these must never leak even though getEvent can return them:
      gift_link_token: 'secret-token',
      owner_id: 'owner-uuid',
      org_id: 'org-uuid',
    } as never);
    getGuestTotalsMock.mockResolvedValue(
      mkTotals({ rows: 4, attending_rows: 2 }),
    );
    getCampaignForEventMock.mockResolvedValue({
      id: 'c-1',
      status: 'closed',
      capture_status: 'captured',
      max_contacts: 100,
      final_charge_amount: 50,
      card_token_ref: 'card-ref',
      card_citizen_id: '123456789',
      charge_document_url: 'https://x/y',
    } as never);
    getCampaignDeliveryBreakdownMock.mockResolvedValue({
      delivery: { sent: 2, delivered: 2, read: 1, failed: 0 },
      outcome: { reached: 2, wrongNumber: 0, optedOut: 0 },
    });
    getCampaignBillingSummaryMock.mockResolvedValue({ reachedCount: 2, accrued: 90, ceiling: 100, maxContacts: 100 });
    const r = await getEventStats('evt-1');
    const serialized = JSON.stringify(r);
    const piiPatterns = [
      'gift_link_token',
      'secret-token',
      'owner_id',
      'org_id',
      'owner-uuid',
      'org-uuid',
      'card_token_ref',
      'card-ref',
      'card_citizen_id',
      '123456789',
      'charge_document_url',
      'https://x/y',
      'payload_meta',
      'provider_id',
      'provider_ref',
    ];
    for (const p of piiPatterns) {
      expect(serialized, `leaked PII pattern: ${p}`).not.toContain(p);
    }
    // sanity: non-PII values are still present
    expect(r.event?.name).toBe('E');
    expect(r.campaign.id).toBe('c-1');
  });
});
