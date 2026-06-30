import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/message-templates', () => ({ getTemplateByKey: vi.fn() }));
vi.mock('@/lib/data/outreach', () => ({ sendOneWhatsApp: vi.fn() }));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({ setContactOpStatus: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { recordReached } from '@/lib/data/billing';
import { stepGate, claimStep, writeReach } from '@/lib/data/outreach-engine';

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

describe('stepGate (fail-closed)', () => {
  it('returns paused when outreach is globally disabled — no send', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const r = await stepGate('c1', 'k1', 'e1');
    expect(r.reason).toBe('paused');
    expect(r.ctx).toBeUndefined();
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

// S2.4 — R9: defense-in-depth on top of the DB trigger
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

describe('claimStep (compare-and-advance)', () => {
  it('wins (true) when the guarded update advances the cursor', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'os1' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const won = await claimStep('c1', 'k1', 2);
    expect(builder.update).toHaveBeenCalledWith({ current_step_index: 3 });
    expect(builder.eq).toHaveBeenCalledWith('current_step_index', 2);
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(won).toBe(true);
  });

  it('loses (false) when no row matched (duplicate delivery)', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    expect(await claimStep('c1', 'k1', 2)).toBe(false);
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

  it('on already_billed: does NOT touch outreach_state (no double-stop)', async () => {
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
    expect(builder.update).not.toHaveBeenCalled();
  });
});
