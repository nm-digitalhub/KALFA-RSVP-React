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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/payments/ledger', () => ({ loadOperations: vi.fn(async () => []) }));
vi.mock('@/lib/data/contacts', () => ({ countAuthorizedContacts: vi.fn() }));

import {
  derivePercentages,
  deriveStatsAlerts,
  getEventStats,
} from '@/lib/data/event-stats';
import type { GuestTotals } from '@/lib/data/guests';
import { countAuthorizedContacts } from '@/lib/data/contacts';
import { loadOperations } from '@/lib/payments/ledger';
import {
  canAccessEvent,
  getEvent,
  requireEventAccess,
} from '@/lib/data/events';
import { getGuestTotals } from '@/lib/data/guests';
import { getCampaignForEvent } from '@/lib/data/campaigns';
import { getCampaignDeliveryBreakdown } from '@/lib/data/campaign-delivery';

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
  const asked = { failed: 0, wrongNumber: 0, outreachStarted: true };

  it('high_pending when pending/rows ≥ 0.5 AND people were actually asked', () => {
    const alerts = deriveStatsAlerts({
      totals: mkTotals({ rows: 10, pending_rows: 6, maybe_rows: 0 }),
      delivery: asked,
    });
    expect(alerts.map((a) => a.id)).toContain('high_pending');
  });

  it('no high_pending when below threshold', () => {
    const alerts = deriveStatsAlerts({
      totals: mkTotals({ rows: 10, pending_rows: 2, maybe_rows: 1 }),
      delivery: asked,
    });
    expect(alerts.map((a) => a.id)).not.toContain('high_pending');
  });

  // The live QA event was showing this alert with two guests, zero sends, and
  // the first outreach three days away. Every guest is pending before anyone is
  // asked, so the ratio alone says nothing.
  it('never high_pending before the first outreach, even at 100% pending', () => {
    const alerts = deriveStatsAlerts({
      totals: mkTotals({ rows: 2, pending_rows: 2, maybe_rows: 0 }),
      delivery: { failed: 0, wrongNumber: 0, outreachStarted: false },
    });
    expect(alerts.map((a) => a.id)).not.toContain('high_pending');
  });

  it('stays silent when the outreach state is unknown rather than guessing', () => {
    // No campaign, or a viewer without campaigns.view. A missing alert is a
    // smaller error than a false one.
    const alerts = deriveStatsAlerts({
      totals: mkTotals({ rows: 2, pending_rows: 2, maybe_rows: 0 }),
    });
    expect(alerts.map((a) => a.id)).not.toContain('high_pending');
  });

  it('failed_deliveries and wrong_numbers when counts > 0', () => {
    const alerts = deriveStatsAlerts({
      delivery: { failed: 2, wrongNumber: 1, outreachStarted: true },
    });
    expect(alerts.map((a) => a.id)).toEqual(expect.arrayContaining(['failed_deliveries', 'wrong_numbers']));
  });

  it('over_invited when over_invited_rows > 0', () => {
    const alerts = deriveStatsAlerts({ totals: mkTotals({ over_invited_rows: 3 }) });
    expect(alerts.map((a) => a.id)).toContain('over_invited');
  });
});

describe('getEventStats orchestration', () => {
  const requireEventAccessMock = requireEventAccess as unknown as ReturnType<typeof vi.fn>;
  const canAccessEventMock = canAccessEvent as unknown as ReturnType<typeof vi.fn>;
  const getEventMock = getEvent as unknown as ReturnType<typeof vi.fn>;
  const getGuestTotalsMock = getGuestTotals as unknown as ReturnType<typeof vi.fn>;
  const getCampaignForEventMock = getCampaignForEvent as unknown as ReturnType<typeof vi.fn>;
  const getCampaignDeliveryBreakdownMock = getCampaignDeliveryBreakdown as unknown as ReturnType<typeof vi.fn>;

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

  it('empty event (with perms) → empty campaign, no delivery/money, no PII', async () => {
    canAccessEventMock.mockResolvedValue(true);
    getEventMock.mockResolvedValue(null);
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 0 }));
    getCampaignForEventMock.mockResolvedValue(null);
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('empty');
    expect(r.campaign.delivery).toBeNull();
    expect(r.campaign.money).toBeNull();
    // no PII fields ever present
    expect(JSON.stringify(r)).not.toMatch(/rsvp_token|gift_link_token|card_token_ref/);
  });

  it('permission-limited: reports.view ok but campaigns.view false → non-sensitive state, no ledger read', async () => {
    vi.mocked(canAccessEvent).mockImplementation(async (_e, resource) => resource !== 'campaigns' && resource !== 'billing');
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4, attending_rows: 2 }));
    getCampaignForEventMock.mockResolvedValue(null);
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('permission_limited');
    expect(loadOperations).not.toHaveBeenCalled();
  });

  it('the ledger is not read without billing.view even if campaigns.view present', async () => {
    vi.mocked(canAccessEvent).mockImplementation(async (_e, resource) => resource !== 'billing');
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'active' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4 }));
    getCampaignForEventMock.mockResolvedValue({ id: 'c-1', status: 'active', capture_status: 'captured', max_contacts: 100, final_charge_amount: null });
    getCampaignDeliveryBreakdownMock.mockResolvedValue({ delivery: { sent: 1, delivered: 1, read: 1, failed: 0 }, outcome: { reached: 1, wrongNumber: 0, optedOut: 0 } });
    const r = await getEventStats('evt-1');
    expect(r.campaign.state).toBe('visible');
    // the ledger is money: not read, not shown
    expect(loadOperations).not.toHaveBeenCalled();
    expect(r.campaign.money).toBeNull();
    // operational reached still derived from delivery (campaigns.view only)
    expect(r.campaign.reachedCount).toBe(1);
  });

  // A fixed-price package (live campaign c94ae98e, 9.10.2026): its money is the ledger, its terms a quota.
  it('package campaign: money from the ledger, quota with its usage', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    getEventMock.mockResolvedValue({ id: 'evt-1', name: 'E', event_type: 'wedding', event_date: null, rsvp_deadline: null, status: 'closed' });
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 4 }));
    getCampaignForEventMock.mockResolvedValue({
      id: 'c-9',
      status: 'closed',
      capture_status: null,
      max_contacts: 0,
      base_price: '0',
      included_reached: 0,
      price_per_reached: '0',
      final_charge_amount: null,
      credit_applied: '0',
      charge_status: null,
      package_price: '1.00',
      contact_quota: 1,
    });
    getCampaignDeliveryBreakdownMock.mockResolvedValue({ delivery: { sent: 1, delivered: 1, read: 1, failed: 0 }, outcome: { reached: 1, wrongNumber: 0, optedOut: 0 } });
    vi.mocked(countAuthorizedContacts).mockResolvedValue(1);
    vi.mocked(loadOperations).mockResolvedValue([
      { kind: 'package_purchase', effect: 'collect', outcome: 'succeeded', amount: 1, credit: 0, occurredAt: '2026-10-09T10:00:00Z', recordedAt: '2026-10-09T10:00:00Z' },
      { kind: 'refund', effect: 'return', outcome: 'succeeded', amount: 1, credit: 0, occurredAt: '2026-10-09T15:00:00Z', recordedAt: '2026-10-09T15:00:00Z' },
    ]);
    const r = await getEventStats('evt-1');
    expect(r.campaign.money).toEqual({ paid: 1, refunded: 1, inFlight: null, testMoney: false });
    expect(r.campaign.quota).toEqual({ quota: 1, used: 1 });
  });

  it('an unreadable ledger is reported as such, never as "nothing paid"', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(true);
    getEventMock.mockResolvedValue(null);
    getGuestTotalsMock.mockResolvedValue(mkTotals({ rows: 1 }));
    getCampaignForEventMock.mockResolvedValue({ id: 'c-9', status: 'active', capture_status: null, max_contacts: 0, final_charge_amount: null, contact_quota: null });
    getCampaignDeliveryBreakdownMock.mockResolvedValue(null);
    vi.mocked(loadOperations).mockRejectedValueOnce(new Error('down'));
    const r = await getEventStats('evt-1');
    expect(r.campaign.money).toBeNull();
    expect(r.campaign.moneyFailed).toBe(true);
    // no quota on this campaign: nothing counted, nothing shown
    expect(r.campaign.quota).toBeNull();
    expect(countAuthorizedContacts).not.toHaveBeenCalled();
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
