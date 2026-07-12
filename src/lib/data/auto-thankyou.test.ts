import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach', () => ({ sendCampaignWhatsApp: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import {
  listDueThankyouCampaigns,
  runThankyouSweep,
} from '@/lib/data/auto-thankyou';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const NOW_MS = Date.parse('2026-07-13T08:00:00+00:00');

beforeEach(() => vi.clearAllMocks());

// listDueThankyouCampaigns reads fresh state on every call (no cached decision
// from a job that was never registered) — every eligibility condition below is
// exercised independently so a future edit can't silently widen the sweep.
describe('listDueThankyouCampaigns', () => {
  // Two-step sequence: (1) campaigns select('*').eq('status','active'),
  // (2) events select('id').eq('status','active').in(...).
  function sequence(
    builder: MockQueryBuilder<Row>,
    campaignRows: Row[],
    activeEventRows: Array<{ id: string }>,
  ) {
    return vi
      .spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: campaignRows, error: null }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: activeEventRows, error: null }),
      );
  }

  function mockedAdmin(): { admin: Admin; builder: MockQueryBuilder<Row> } {
    const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
    return { admin: client as unknown as Admin, builder };
  }

  it('includes a campaign that is opted-in, due, unsent, with an active event', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: true,
          thankyou_send_at: '2020-01-01T00:00:00+00:00', // in the past relative to NOW_MS
          thankyou_sent_at: null,
        },
      ],
      [{ id: 'e1' }],
    );

    const due = await listDueThankyouCampaigns(admin, NOW_MS);
    expect(due).toEqual(['c1']);
  });

  it('excludes a campaign with auto-thankyou disabled', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: false,
          thankyou_send_at: '2020-01-01T00:00:00+00:00',
          thankyou_sent_at: null,
        },
      ],
      [{ id: 'e1' }],
    );

    expect(await listDueThankyouCampaigns(admin, NOW_MS)).toEqual([]);
  });

  it('excludes a campaign already marked processed (thankyou_sent_at set)', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: true,
          thankyou_send_at: '2020-01-01T00:00:00+00:00',
          thankyou_sent_at: '2026-07-13T07:05:00+00:00',
        },
      ],
      [{ id: 'e1' }],
    );

    expect(await listDueThankyouCampaigns(admin, NOW_MS)).toEqual([]);
  });

  it('excludes a campaign not yet due (thankyou_send_at is in the future)', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: true,
          thankyou_send_at: '2026-07-13T09:00:00+00:00', // after NOW_MS
          thankyou_sent_at: null,
        },
      ],
      [{ id: 'e1' }],
    );

    expect(await listDueThankyouCampaigns(admin, NOW_MS)).toEqual([]);
  });

  it('excludes a campaign with no schedule set at all (thankyou_send_at null)', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: true,
          thankyou_send_at: null,
          thankyou_sent_at: null,
        },
      ],
      [{ id: 'e1' }],
    );

    expect(await listDueThankyouCampaigns(admin, NOW_MS)).toEqual([]);
  });

  it('excludes a due+enabled campaign whose event is no longer active (R9-style defense-in-depth)', async () => {
    const { admin, builder } = mockedAdmin();
    sequence(
      builder,
      [
        {
          id: 'c1',
          event_id: 'e1',
          status: 'active',
          thankyou_auto_enabled: true,
          thankyou_send_at: '2020-01-01T00:00:00+00:00',
          thankyou_sent_at: null,
        },
      ],
      [], // e1 not in the active-events result
    );

    expect(await listDueThankyouCampaigns(admin, NOW_MS)).toEqual([]);
  });
});

// runThankyouSweep: each due campaign is independent — a thrown send must not
// block the others, and (crucially) must NOT mark thankyou_sent_at, so the
// per-guest dedup (not this flag) is what makes the next tick's retry safe.
describe('runThankyouSweep', () => {
  function mockedAdmin(
    campaignRows: Row[],
    activeEventRows: Array<{ id: string }>,
  ): { builder: MockQueryBuilder<Row> } {
    const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: campaignRows, error: null }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: activeEventRows, error: null }),
      );
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as Admin);
    return { builder };
  }

  const dueCampaign = (id: string, eventId: string): Row => ({
    id,
    event_id: eventId,
    status: 'active',
    thankyou_auto_enabled: true,
    thankyou_send_at: '2020-01-01T00:00:00+00:00',
    thankyou_sent_at: null,
  });

  it('sends and marks a single due campaign as processed', async () => {
    vi.mocked(sendCampaignWhatsApp).mockResolvedValue({ sent: 3, skipped: 0, blocked: false });
    const { builder } = mockedAdmin([dueCampaign('c1', 'e1')], [{ id: 'e1' }]);

    const result = await runThankyouSweep();

    expect(sendCampaignWhatsApp).toHaveBeenCalledWith('c1', 'thankyou');
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_sent_at: expect.any(String) }),
    );
  });

  it('does NOT mark thankyou_sent_at when sendCampaignWhatsApp throws — safe to retry next tick', async () => {
    vi.mocked(sendCampaignWhatsApp).mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { builder } = mockedAdmin([dueCampaign('c1', 'e1')], [{ id: 'e1' }]);

    const result = await runThankyouSweep();

    expect(result).toEqual({ processed: 0, blocked: 0, failed: 1 });
    expect(builder.update).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Bug fix (thankyou-review, high — BUG #2): a transient config/state gate
  // (kill-switch off, WhatsApp not configured, template not approved,
  // campaign/event not active) makes sendCampaignWhatsApp return
  // `{sent:0, skipped:0, blocked:true}` WITHOUT throwing. Marking
  // thankyou_sent_at here would permanently stop retrying this campaign once
  // the blocker clears, AND lock the owner's UI out of editing the schedule —
  // silently dropping the thank-you forever. Must stay unmarked + visible.
  it('does NOT mark thankyou_sent_at when sendCampaignWhatsApp reports blocked (transient gate, not a real completion)', async () => {
    vi.mocked(sendCampaignWhatsApp).mockResolvedValue({ sent: 0, skipped: 0, blocked: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { builder } = mockedAdmin([dueCampaign('c1', 'e1')], [{ id: 'e1' }]);

    const result = await runThankyouSweep();

    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    expect(builder.update).not.toHaveBeenCalled();
    // Visible, not silent: an operator must be able to see this in logs.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('blocked'),
      'c1',
    );
    errorSpy.mockRestore();
  });

  it('marks thankyou_sent_at on a real completion even when NO contact was eligible (sent:0, not blocked)', async () => {
    // e.g. the attending-filter / claim left zero eligible contacts this tick
    // — a legitimate "nothing to do right now", not a config gate.
    vi.mocked(sendCampaignWhatsApp).mockResolvedValue({ sent: 0, skipped: 0, blocked: false });
    const { builder } = mockedAdmin([dueCampaign('c1', 'e1')], [{ id: 'e1' }]);

    const result = await runThankyouSweep();

    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_sent_at: expect.any(String) }),
    );
  });

  it('one failing campaign does not block the others in the same sweep', async () => {
    vi.mocked(sendCampaignWhatsApp)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ sent: 1, skipped: 0, blocked: false });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedAdmin([dueCampaign('c1', 'e1'), dueCampaign('c2', 'e2')], [{ id: 'e1' }, { id: 'e2' }]);

    const result = await runThankyouSweep();

    expect(sendCampaignWhatsApp).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 1 });
    errorSpy.mockRestore();
  });

  it('returns {processed: 0, blocked: 0, failed: 0} with no provider call when nothing is due', async () => {
    mockedAdmin([], []);

    const result = await runThankyouSweep();

    expect(result).toEqual({ processed: 0, blocked: 0, failed: 0 });
    expect(sendCampaignWhatsApp).not.toHaveBeenCalled();
  });
});
