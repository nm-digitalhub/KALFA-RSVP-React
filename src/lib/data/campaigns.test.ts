import { beforeEach, describe, expect, it, vi } from 'vitest';

// campaigns.ts begins with `import 'server-only'`; computeCeiling is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// Lifecycle transitions verify ownership; stub it as a no-op.
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  computeCeiling,
  getCampaignForHold,
  lockCampaignForHold,
  recordCampaignHold,
  markCampaignHoldFailed,
  activateCampaign,
  pauseCampaign,
  closeCampaign,
} from '@/lib/data/campaigns';

function adminWith<T>(result: QueryResult<T>) {
  const { client, builder } = createMockSupabase<T>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

beforeEach(() => vi.clearAllMocks());

describe('computeCeiling', () => {
  it('is price-per-reached × max contacts (the billing ceiling, §7)', () => {
    expect(computeCeiling(2.5, 100)).toBe(250);
    expect(computeCeiling(4, 250)).toBe(1000);
  });

  it('rounds to agorot (2 decimals), no float drift', () => {
    expect(computeCeiling(0.1, 3)).toBe(0.3); // not 0.30000000000000004
    expect(computeCeiling(1.234, 1)).toBe(1.23); // rounds down
    expect(computeCeiling(1.236, 1)).toBe(1.24); // rounds up
  });
});

describe('getCampaignForHold', () => {
  it('selects the hold columns via the admin client', async () => {
    const { client, builder } = adminWith({
      data: {
        id: 'c1',
        event_id: 'e1',
        status: 'approved',
        max_charge_ceiling: 1400,
        capture_status: null,
      },
      error: null,
    });

    const r = await getCampaignForHold('c1');

    expect(client.from).toHaveBeenCalledWith('campaigns');
    expect(builder.select).toHaveBeenCalledWith(
      'id, event_id, status, max_charge_ceiling, capture_status',
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
    expect(r?.status).toBe('approved');
  });
});

describe('lockCampaignForHold', () => {
  it('wins the lock (true) when the guarded update returns a row', async () => {
    const { builder } = adminWith({ data: { id: 'c1' }, error: null });

    const won = await lockCampaignForHold('c1');

    expect(builder.update).toHaveBeenCalledWith({ capture_status: 'pending' });
    expect(builder.or).toHaveBeenCalledWith(
      'capture_status.is.null,capture_status.in.(hold_failed,hold_review)',
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
    expect(won).toBe(true);
  });

  it('loses the lock (false) when no row matched (already pending/authorized)', async () => {
    adminWith({ data: null, error: null });
    expect(await lockCampaignForHold('c1')).toBe(false);
  });
});

describe('recordCampaignHold', () => {
  it('writes the authorized hold fields scoped by id', async () => {
    const { builder } = adminWith({ data: null, error: null });

    await recordCampaignHold('c1', {
      authNumber: 'A1',
      authAmount: 1400,
      cardToken: 'tok',
    });

    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      capture_status: 'authorized',
      auth_number: 'A1',
      auth_amount: 1400,
      card_token_ref: 'tok',
    });
    expect(payload.authorized_at).toBeTruthy();
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
  });
});

describe('markCampaignHoldFailed', () => {
  it('sets the retryable capture_status without touching campaign status', async () => {
    const { builder } = adminWith({ data: null, error: null });

    await markCampaignHoldFailed('c1', 'hold_review');

    expect(builder.update).toHaveBeenCalledWith({ capture_status: 'hold_review' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
  });
});

describe('campaign lifecycle transitions', () => {
  it('activateCampaign requires an approved+held campaign → status active', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });

    await activateCampaign('c1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
    expect(builder.in).toHaveBeenCalledWith('status', [
      'approved',
      'scheduled',
      'paused',
    ]);
    expect(builder.eq).toHaveBeenCalledWith('capture_status', 'authorized');
  });

  it('pauseCampaign: active → paused', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });

    await pauseCampaign('c1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'paused' });
    expect(builder.in).toHaveBeenCalledWith('status', ['active']);
  });

  it('closeCampaign: active/paused/approved/scheduled → closed', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });

    await closeCampaign('c1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'closed' });
  });

  it('throws when the campaign is not in a transitionable state (0 rows updated)', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    // First await (load campaign) → exists; second await (guarded update) → no row.
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: { id: 'c1', event_id: 'e1' }, error: null }))
      .mockImplementationOnce((f) => f({ data: null, error: null }));

    await expect(closeCampaign('c1')).rejects.toThrow(
      'לא ניתן לשנות את מצב הקמפיין',
    );
  });
});
