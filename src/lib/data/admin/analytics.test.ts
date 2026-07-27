import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/dal', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-user' })),
  hasPlatformPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/analytics/ga4-client', () => ({
  getGa4ConfigStatus: vi.fn(async () => ({ ok: true })),
  getGa4Property: vi.fn(() => 'properties/123456'),
  getGa4Client: vi.fn(),
}));

// A generic report row that satisfies every mapper (extra values are ignored).
const fakeReport = (withQuota: boolean) => ({
  ...(withQuota
    ? { propertyQuota: { tokensPerDay: { consumed: 5, remaining: 95 }, tokensPerHour: { consumed: 1, remaining: 9 } } }
    : {}),
  rows: [
    {
      dimensionValues: [{ value: '20260726' }, { value: 'x' }],
      metricValues: [
        { value: '10' },
        { value: '4' },
        { value: '7' },
        { value: '20' },
        { value: '0.5' },
        { value: '61' },
      ],
    },
  ],
});

async function load() {
  vi.resetModules();
  const dal = await import('@/lib/data/admin/analytics');
  const auth = vi.mocked(await import('@/lib/auth/dal'));
  const client = vi.mocked(await import('@/lib/analytics/ga4-client'));

  const batchRunReports = vi.fn(async (req: { requests: { returnPropertyQuota?: boolean }[] }) => [
    { reports: req.requests.map((r) => fakeReport(!!r.returnPropertyQuota)) },
  ]);
  const runRealtimeReport = vi.fn(async () => [fakeReport(false)]);
  client.getGa4Client.mockReturnValue({
    batchRunReports,
    runRealtimeReport,
  } as unknown as ReturnType<typeof client.getGa4Client>);

  return { dal, auth, client, batchRunReports, runRealtimeReport };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-27T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('getAnalyticsDashboard — gates', () => {
  it('no permission → null and ZERO client calls', async () => {
    const { dal, auth, batchRunReports } = await load();
    auth.hasPlatformPermission.mockResolvedValueOnce(false);
    expect(await dal.getAnalyticsDashboard('30d')).toBeNull();
    expect(batchRunReports).not.toHaveBeenCalled();
  });

  it('invalid config → configured:false with issue, all sections not_configured, zero network', async () => {
    const { dal, client, batchRunReports } = await load();
    client.getGa4ConfigStatus.mockResolvedValueOnce({ ok: false, issue: 'credentials_unreadable' });
    const dash = await dal.getAnalyticsDashboard('30d');
    expect(dash?.configured).toBe(false);
    expect(dash?.configIssue).toBe('credentials_unreadable');
    expect(dash?.overview.state).toBe('not_configured');
    expect(dash?.events.state).toBe('not_configured');
    expect(batchRunReports).not.toHaveBeenCalled();
  });
});

describe('getAnalyticsDashboard — cache', () => {
  it('serves from cache within TTL and refetches after expiry', async () => {
    const { dal, batchRunReports } = await load();
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(2); // batch A + batch B
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(2); // cached
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(4); // expired → refetch
  });

  it('cache is keyed per range: 7d does not reuse 30d, and 30d stays cached', async () => {
    const { dal, batchRunReports } = await load();
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(2);
    await dal.getAnalyticsDashboard('7d');
    expect(batchRunReports).toHaveBeenCalledTimes(4); // separate slots
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(4); // 30d still fresh
  });

  it('single-flight: two concurrent renders share one API call pair', async () => {
    const { dal, batchRunReports } = await load();
    await Promise.all([dal.getAnalyticsDashboard('30d'), dal.getAnalyticsDashboard('30d')]);
    expect(batchRunReports).toHaveBeenCalledTimes(2);
  });

  it('failed refresh with lastGood serves stale with the ORIGINAL fetchedAt; failure is not cached', async () => {
    const { dal, batchRunReports } = await load();
    const first = await dal.getAnalyticsDashboard('30d');
    const firstAt = first?.overview.fetchedAt;
    expect(first?.overview.state).toBe('ok');

    vi.advanceTimersByTime(5 * 60_000 + 1);
    batchRunReports.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    const second = await dal.getAnalyticsDashboard('30d');
    expect(second?.overview.state).toBe('stale');
    expect(second?.overview.data).not.toBeNull();
    expect(second?.overview.fetchedAt).toBe(firstAt);

    // failure was NOT cached — next call retries and succeeds
    const third = await dal.getAnalyticsDashboard('30d');
    expect(third?.overview.state).toBe('ok');
  });

  it('failure without lastGood → error state', async () => {
    const { dal, batchRunReports } = await load();
    batchRunReports.mockRejectedValue(new Error('boom'));
    const dash = await dal.getAnalyticsDashboard('30d');
    expect(dash?.overview.state).toBe('error');
    expect(dash?.overview.data).toBeNull();
  });

  it('quota error → quota_exhausted, backoff blocks retries for 60s, then retries', async () => {
    const { dal, batchRunReports } = await load();
    batchRunReports.mockRejectedValue({ code: 8 });
    const dash = await dal.getAnalyticsDashboard('30d');
    expect(dash?.overview.state).toBe('quota_exhausted');
    expect(batchRunReports).toHaveBeenCalledTimes(2);

    // inside the backoff window: no new API calls at all
    await dal.getAnalyticsDashboard('30d');
    expect(batchRunReports).toHaveBeenCalledTimes(2);

    // after the window: retried (and succeeds again)
    batchRunReports.mockImplementation(async (req: { requests: { returnPropertyQuota?: boolean }[] }) => [
      { reports: req.requests.map((r) => fakeReport(!!r.returnPropertyQuota)) },
    ]);
    vi.advanceTimersByTime(60_000 + 1);
    const after = await dal.getAnalyticsDashboard('30d');
    expect(after?.overview.state).toBe('ok');
    expect(batchRunReports).toHaveBeenCalledTimes(4);
  });

  it('exposes core quota from returnPropertyQuota', async () => {
    const { dal } = await load();
    const dash = await dal.getAnalyticsDashboard('30d');
    expect(dash?.coreQuota).toEqual({
      tokensPerDay: { consumed: 5, remaining: 95 },
      tokensPerHour: { consumed: 1, remaining: 9 },
    });
  });
});

describe('getRealtimeSnapshot', () => {
  it('fires the three realtime requests and maps the snapshot', async () => {
    const { dal, runRealtimeReport } = await load();
    const snap = await dal.getRealtimeSnapshot();
    expect(runRealtimeReport).toHaveBeenCalledTimes(3);
    expect(snap.state).toBe('ok');
    expect(snap.data?.activeUsersNow).toBe(10);
  });

  it('realtime slot is independent of core ranges (own 45s TTL)', async () => {
    const { dal, runRealtimeReport, batchRunReports } = await load();
    await dal.getRealtimeSnapshot();
    await dal.getAnalyticsDashboard('30d');
    await dal.getAnalyticsDashboard('7d');
    await dal.getRealtimeSnapshot(); // still within 45s → cached
    expect(runRealtimeReport).toHaveBeenCalledTimes(3);
    expect(batchRunReports).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(45_000 + 1);
    await dal.getRealtimeSnapshot();
    expect(runRealtimeReport).toHaveBeenCalledTimes(6);
  });

  it('not configured → not_configured without network', async () => {
    const { dal, client, runRealtimeReport } = await load();
    client.getGa4ConfigStatus.mockResolvedValueOnce({ ok: false, issue: 'missing_property_id' });
    const snap = await dal.getRealtimeSnapshot();
    expect(snap.state).toBe('not_configured');
    expect(runRealtimeReport).not.toHaveBeenCalled();
  });
});
