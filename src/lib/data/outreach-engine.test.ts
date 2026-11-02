import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/outreach', () => ({
  sendOneWhatsApp: vi.fn(),
  recordTemplateFailure: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({ setContactOpStatus: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { recordReached } from '@/lib/data/billing';
import {
  stepGate,
  writeReach,
  getCampaignContext,
  isContactReached,
  setOutreachStatus,
} from '@/lib/data/outreach-engine';

beforeEach(() => vi.clearAllMocks());

const reachArgs = {
  eventId: 'e1',
  campaignId: 'c1',
  contactId: 'k1',
  channel: 'whatsapp' as const,
  attemptId: 'a1',
  evidence: 'inbound_message',
  providerRef: 'wamid.1',
};

// getCampaignContext reads campaigns, then events: answer each read with its
// own row (the event stays active unless a test says otherwise).
function mockCampaignRow(row: Record<string, unknown>, eventStatus = 'active') {
  const { client, builder } = createMockSupabase<Record<string, unknown>>({ data: null, error: null });
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  vi.spyOn(builder, 'then')
    .mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: row, error: null }))
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: { event_date: row.event_date, status: eventStatus },
        error: null,
      }),
    );
}
const LIVE_ROW = {
  status: 'active',
  event_id: 'e1',
  allowed_channels: ['whatsapp'],
  start_at: null,
  close_at: null,
  outreach_schedule: [],
  event_date: '2099-01-01T00:00:00+00:00',
};

describe('stepGate (fail-closed)', () => {
  it('returns paused when outreach is globally disabled — no send', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    mockCampaignRow(LIVE_ROW);
    const r = await stepGate('c1', 'k1', 'e1');
    expect(r.reason).toBe('paused');
    expect(r.ctx).toBeUndefined();
  });

  // A 'paused' answer re-polls every 5 minutes; a closed campaign must be
  // terminalized even while the global switch is off, or it re-polls forever
  // (two such jobs measured 2026-09-30).
  it.each([
    ['closed', { ...LIVE_ROW, status: 'closed' }],
    ['cancelled', { ...LIVE_ROW, status: 'cancelled' }],
    ['past close_at', { ...LIVE_ROW, close_at: '2000-01-01T00:00:00Z' }],
  ])('a %s campaign stops even when outreach is globally disabled', async (_label, row) => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    mockCampaignRow(row);
    const r = await stepGate('c1', 'k1', 'e1');
    expect(r.reason).toBe('stopped');
  });

  it('a paused campaign stays paused (reversible), switch on or off', async () => {
    for (const enabled of [true, false]) {
      vi.mocked(getOutreachEnabled).mockResolvedValue(enabled);
      mockCampaignRow({ ...LIVE_ROW, status: 'paused' });
      expect((await stepGate('c1', 'k1', 'e1')).reason).toBe('paused');
    }
  });
});

describe('stepGate — L1 past-event stop (live event_date)', () => {
  it('stops an active campaign once the event day is past in Israel', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    // One combined row serves both getCampaignContext reads (campaigns + events);
    // the mock ignores the table name and returns the same result per await.
    const ctxRow = {
      status: 'active',
      event_id: 'e1',
      allowed_channels: ['whatsapp'],
      start_at: null,
      close_at: null, // close_at gate must NOT be what stops it — event_date does
      outreach_schedule: [],
      event_date: '2026-06-22T00:00:00+00:00', // 8 days before NOW
    };
    const { client } = createMockSupabase<typeof ctxRow>({
      data: ctxRow,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const NOW = Date.parse('2026-06-30T08:00:00Z');
    const r = await stepGate('c1', 'k1', 'e1', NOW);
    expect(r.reason).toBe('stopped');
  });
});

// R9: defense-in-depth on top of the DB trigger
// (campaigns_require_active_event) + R7's structural guarantee. Genuinely
// redundant under normal DB operation but required explicitly per the plan's
// "ALL commercial paths" list.
describe('stepGate — R9 active-event stop', () => {
  it('stops an active campaign whose event is not active', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    const { client, builder } = createMockSupabase<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: {
            status: 'active',
            event_id: 'e1',
            allowed_channels: ['whatsapp'],
            start_at: null,
            close_at: null,
            outreach_schedule: [],
          },
          error: null,
        }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: { event_date: '2999-01-01T00:00:00+00:00', status: 'closed' },
          error: null,
        }),
      );

    const r = await stepGate('c1', 'k1', 'e1');

    expect(r.reason).toBe('stopped');
  });
});

describe('writeReach (shared reach path — stop on billed)', () => {
  it('on billed: records via the RPC AND stops the contact outreach', async () => {
    vi.mocked(recordReached).mockResolvedValue('billed');
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const outcome = await writeReach(reachArgs);
    expect(outcome).toBe('billed');
    expect(recordReached).toHaveBeenCalledWith(reachArgs); // campaignId+attemptId carried
    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe('reached');
  });

  it('on already_billed: still marks outreach_state reached (replay after a crash completes the lost marker)', async () => {
    // A crash between the billing RPC and the status write leaves the contact
    // billed but not marked reached; the replay sees 'already_billed' and must
    // complete the marker. Idempotent — a second run only refreshes reached_at.
    vi.mocked(recordReached).mockResolvedValue('already_billed');
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const outcome = await writeReach(reachArgs);
    expect(outcome).toBe('already_billed');
    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: 'reached', stop_reason: 'reached' });
  });

  it('on a refused verdict (e.g. not_active): does NOT touch outreach_state', async () => {
    vi.mocked(recordReached).mockResolvedValue('not_active');
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    expect(await writeReach(reachArgs)).toBe('not_active');
    expect(builder.update).not.toHaveBeenCalled();
  });
});

// A read/write error is THROWN, never folded into a terminal-looking answer:
// callers read null / false as "no such campaign" / "not reached", and a
// transient outage must neither end a contact's outreach nor reopen the gate
// for a contact who already answered. Every caller runs inside a guardedWorker
// job (or a route that maps the throw to a 500), so a throw is retried.
describe('outreach-engine DB errors are thrown, not swallowed', () => {
  function mockAdmin(result: { data: unknown; error: unknown; count?: number | null }) {
    const { client, builder } = createMockSupabase<Record<string, unknown>>(
      result as never,
    );
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return builder;
  }

  it('getCampaignContext: campaign read error → throws', async () => {
    mockAdmin({ data: null, error: { message: 'timeout' } });
    await expect(getCampaignContext('c1')).rejects.toThrow('טעינת הקמפיין נכשלה');
  });

  it('getCampaignContext: no such campaign → null (a real "not found")', async () => {
    mockAdmin({ data: null, error: null });
    expect(await getCampaignContext('c1')).toBeNull();
  });

  it('getCampaignContext: event read error → throws', async () => {
    const builder = mockAdmin({ data: null, error: null });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: LIVE_ROW, error: null }))
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: null, error: { message: 'timeout' } }),
      );
    await expect(getCampaignContext('c1')).rejects.toThrow('טעינת האירוע נכשלה');
  });

  it('stepGate: a campaign read error propagates — never answered as stopped', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    mockAdmin({ data: null, error: { message: 'timeout' } });
    await expect(stepGate('c1', 'k1', 'e1')).rejects.toThrow();
  });

  it('isContactReached: count error → throws (never "not reached")', async () => {
    mockAdmin({ data: null, error: { message: 'timeout' }, count: null });
    await expect(isContactReached('e1', 'k1')).rejects.toThrow('בדיקת הגעה נכשלה');
  });

  it('setOutreachStatus: update error → throws', async () => {
    mockAdmin({ data: null, error: { message: 'timeout' } });
    await expect(setOutreachStatus('c1', 'k1', 'exhausted')).rejects.toThrow(
      'עדכון סטטוס ה-outreach נכשל',
    );
  });
});

