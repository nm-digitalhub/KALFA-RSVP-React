import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/dal', () => ({
  requirePlatformStaff: vi.fn(async () => ({ id: 'admin-user' })),
  hasPlatformPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/analytics/ga4-config', () => ({
  getGa4ConfigStatus: vi.fn(async () => ({ ok: true })),
  getGa4Property: vi.fn(() => 'properties/123456'),
  getGa4StreamId: vi.fn(() => '15330155015'),
  getGa4ChannelGroupId: vi.fn(() => '15331180408'),
}));

vi.mock('@/lib/analytics/ga4-client', () => ({ getGa4Client: vi.fn() }));

// Overview report rows: one per date range (current + previous), with the
// metric order mapOverview reads (activeUsers, newUsers, sessions, pageViews,
// engagementRate, averageSessionDuration, purchaseRevenue).
const overviewReport = {
  rows: [
    {
      dimensionValues: [{ value: 'date_range_0' }],
      metricValues: ['40', '12', '55', '210', '0.61', '93.5', '999'].map((value) => ({ value })),
    },
    {
      dimensionValues: [{ value: 'date_range_1' }],
      metricValues: ['30', '9', '41', '150', '0.5', '80', '10'].map((value) => ({ value })),
    },
  ],
};
// Any other report: text dimensions the core must never pass through.
const textReport = {
  rows: [
    {
      dimensionValues: [{ value: '/r/secret-token' }, { value: 'Wedding of Dana' }],
      metricValues: [{ value: '5' }],
    },
  ],
};

async function load() {
  vi.resetModules();
  const core = await import('./web-traffic');
  const admin = await import('@/lib/data/admin/analytics');
  const client = vi.mocked(await import('@/lib/analytics/ga4-client'));
  const config = vi.mocked(await import('@/lib/analytics/ga4-config'));
  const batchRunReports = vi.fn(async (req: { requests: unknown[] }) => [
    { reports: req.requests.map((_, i) => (i === 0 ? overviewReport : textReport)) },
  ]);
  client.getGa4Client.mockReturnValue({
    batchRunReports,
    runRealtimeReport: vi.fn(),
  } as unknown as ReturnType<typeof client.getGa4Client>);
  return { core, admin, config, batchRunReports };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('getWebTrafficSummary (core)', () => {
  it('returns the overview KPIs as numbers plus a state enum', async () => {
    const { core } = await load();
    const s = await core.getWebTrafficSummary('7d');
    expect(s).toEqual({
      state: 'ok',
      activeUsers: 40,
      newUsers: 12,
      sessions: 55,
      pageViews: 210,
      engagementRate: 0.61,
      averageSessionDurationSec: 93.5,
      previousActiveUsers: 30,
      previousSessions: 41,
    });
  });

  it('no text and no revenue in the result', async () => {
    const { core } = await load();
    const s = await core.getWebTrafficSummary('30d');
    expect(
      Object.entries(s)
        .filter(([, v]) => typeof v === 'string')
        .map(([k]) => k),
    ).toEqual(['state']);
    expect(JSON.stringify(s)).not.toContain('999'); // purchaseRevenue left out
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('asks GA4 for batch A only, with the page request for the same range', async () => {
    const { core, batchRunReports } = await load();
    await core.getWebTrafficSummary('today');
    expect(batchRunReports).toHaveBeenCalledTimes(1);
    const req = batchRunReports.mock.calls[0][0] as {
      requests: Array<{ dateRanges: Array<{ startDate: string; endDate: string }> }>;
    };
    expect(req.requests[0].dateRanges[0]).toEqual({ startDate: 'today', endDate: 'today' });
  });

  it('not configured → state not_configured, every metric null, zero network', async () => {
    const { core, config, batchRunReports } = await load();
    config.getGa4ConfigStatus.mockResolvedValueOnce({ ok: false, issue: 'missing_property_id' });
    const s = await core.getWebTrafficSummary('7d');
    expect(s.state).toBe('not_configured');
    expect(Object.entries(s).filter(([k, v]) => k !== 'state' && v !== null)).toEqual([]);
    expect(batchRunReports).not.toHaveBeenCalled();
  });

  it('a GA4 failure without a cached value → state error, metrics null', async () => {
    const { core, batchRunReports } = await load();
    batchRunReports.mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await core.getWebTrafficSummary('7d');
    err.mockRestore();
    expect(s.state).toBe('error');
    expect(s.sessions).toBeNull();
  });
});

describe('wrapper ↔ core parity (same data, same number)', () => {
  it('the /admin/analytics overview and the core report the same KPIs, from one shared cache slot', async () => {
    const { core, admin, batchRunReports } = await load();
    const page = await admin.getAnalyticsDashboard('7d');
    expect(batchRunReports).toHaveBeenCalledTimes(4); // A + B + C + D, as before
    const s = await core.getWebTrafficSummary('7d');
    // Batch A for 7d was already cached by the page render: no new API call.
    expect(batchRunReports).toHaveBeenCalledTimes(4);
    const cur = page!.overview.data!.current;
    expect(s).toMatchObject({
      state: page!.overview.state,
      activeUsers: cur.activeUsers,
      newUsers: cur.newUsers,
      sessions: cur.sessions,
      pageViews: cur.pageViews,
      engagementRate: cur.engagementRate,
      averageSessionDurationSec: cur.averageSessionDuration,
      previousActiveUsers: page!.overview.data!.previous!.activeUsers,
      previousSessions: page!.overview.data!.previous!.sessions,
    });
  });

  it('the page gate still applies: no permission → null and zero GA4 calls', async () => {
    const { admin, batchRunReports } = await load();
    const auth = vi.mocked(await import('@/lib/auth/dal'));
    auth.hasPlatformPermission.mockResolvedValueOnce(false);
    expect(await admin.getAnalyticsDashboard('7d')).toBeNull();
    expect(batchRunReports).not.toHaveBeenCalled();
  });
});
