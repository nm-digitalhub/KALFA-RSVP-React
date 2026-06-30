import { beforeEach, describe, expect, it, vi } from 'vitest';

// campaigns.ts begins with `import 'server-only'`; computeCeiling is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// Lifecycle transitions verify ownership; stub it as a no-op.
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
// approveCampaign reads the session user; stub it.
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
// contacts.ts is owned by another module; stub the two functions prepareCampaignHold
// consumes so this suite runs independently of that module's wiring.
vi.mock('@/lib/data/contacts', () => ({
  countUniqueContactsForEvent: vi.fn(),
  snapshotAuthorizedSet: vi.fn(),
}));

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOwnedEvent } from '@/lib/data/events';
import { requireUser } from '@/lib/auth/dal';

// A future-dated owned event so the L1 past-event guard never trips for the
// generic lifecycle tests (only the dedicated past-event test supplies a past date).
function ownedEvent(eventDate: string | null = '2999-01-01T00:00:00+00:00') {
  return {
    id: 'e1',
    name: 'Test',
    status: 'active' as const,
    event_date: eventDate,
    rsvp_deadline: null,
  };
}
import {
  countUniqueContactsForEvent,
  snapshotAuthorizedSet,
} from '@/lib/data/contacts';
import {
  computeCeiling,
  computeCovered,
  computeHoldAmount,
  prepareCampaignHold,
  getCampaignForHold,
  lockCampaignForHold,
  recordCampaignHold,
  markCampaignHoldFailed,
  approveCampaign,
  activateCampaign,
  pauseCampaign,
  closeCampaign,
  getCampaignForCharge,
  lockCampaignForCharge,
  recordCampaignCharge,
  markCampaignChargeOutcome,
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

describe('computeCovered (the set + hold basis)', () => {
  it('is min(full, reasonable_coverage)', () => {
    expect(computeCovered(350, 300)).toBe(300); // capped by coverage
    expect(computeCovered(250, 300)).toBe(250); // full ≤ coverage → all covered
    expect(computeCovered(300, 300)).toBe(300); // exactly at the cap
  });

  it('never goes below 0 (degenerate coverage)', () => {
    expect(computeCovered(0, 300)).toBe(0);
    expect(computeCovered(350, 0)).toBe(0);
  });
});

describe('computeHoldAmount (J5 hold = security only)', () => {
  it('is covered × price when above the floor (NOT full × price)', () => {
    // covered=300 → 300×4 = 1200, while the ceiling (full=350) would be 1400.
    expect(computeHoldAmount(300, 4, 0, 0)).toBe(1200);
  });

  it('is floored by min_hold_floor when covered × price is smaller', () => {
    expect(computeHoldAmount(10, 4, 100, 0)).toBe(100); // 40 < 100 → 100
    expect(computeHoldAmount(40, 4, 100, 0)).toBe(160); // 160 > 100 → 160
  });

  it('applies hold_buffer_pct as a FRACTION (0.1 = +10%)', () => {
    expect(computeHoldAmount(300, 4, 0, 0.1)).toBe(1320); // 300×4×1.1
  });

  it('rounds to agorot (2 decimals), no float drift', () => {
    expect(computeHoldAmount(3, 0.1, 0, 0)).toBe(0.3); // not 0.30000000000000004
  });
});

describe('prepareCampaignHold (freeze set + size hold + recompute ceiling)', () => {
  it('snapshots to covered, sizes the hold to covered×price, keeps the ceiling at full×price', async () => {
    const { builder } = adminWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    // full grew to 350 since create; reasonable coverage is 300, price ₪4.
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(350);
    vi.mocked(snapshotAuthorizedSet).mockResolvedValue(300); // set size == covered
    vi.spyOn(builder, 'then')
      // 1. load the campaign (event_id, price, template_id)
      .mockImplementationOnce((f) =>
        f({
          data: { event_id: 'e1', price_per_reached: 4, template_id: 'pkg1' },
          error: null,
        }),
      )
      // 2. app_settings.reasonable_coverage_contacts
      .mockImplementationOnce((f) =>
        f({ data: { reasonable_coverage_contacts: 300 }, error: null }),
      )
      // 3. packages.min_hold_floor / hold_buffer_pct
      .mockImplementationOnce((f) =>
        f({ data: { min_hold_floor: 0, hold_buffer_pct: 0 }, error: null }),
      )
      // 4. the campaigns update (recompute ceiling + max_contacts)
      .mockImplementationOnce((f) => f({ data: null, error: null }));

    const r = await prepareCampaignHold('c1');

    expect(r.full).toBe(350);
    expect(r.covered).toBe(300);
    expect(r.ceiling).toBe(1400); // full × price = 350 × 4 — NOT lowered to covered
    expect(r.holdAmount).toBe(1200); // covered × price = 300 × 4 — the hold < ceiling

    // The set is frozen to `covered`, BEFORE the hold is sized/placed.
    expect(snapshotAuthorizedSet).toHaveBeenCalledWith('e1', 'c1', 300);

    // The ceiling (full×price) + max_contacts (= full, NON-NULL) are persisted.
    const persisted = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(persisted).toEqual({ max_contacts: 350, max_charge_ceiling: 1400 });
  });

  it('sizes the hold to the actual frozen-set size when it exceeds covered (leak guard)', async () => {
    const { builder } = adminWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(350);
    // A stale/larger set survived a prior attempt (insert-on-conflict): 320 > covered 300.
    vi.mocked(snapshotAuthorizedSet).mockResolvedValue(320);
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        f({
          data: { event_id: 'e1', price_per_reached: 4, template_id: 'pkg1' },
          error: null,
        }),
      )
      .mockImplementationOnce((f) =>
        f({ data: { reasonable_coverage_contacts: 300 }, error: null }),
      )
      .mockImplementationOnce((f) =>
        f({ data: { min_hold_floor: 0, hold_buffer_pct: 0 }, error: null }),
      )
      .mockImplementationOnce((f) => f({ data: null, error: null }));

    const r = await prepareCampaignHold('c1');

    expect(r.holdAmount).toBe(1280); // max(300, 320) × 4 — the hold covers the set
    expect(r.ceiling).toBe(1400); // ceiling still full × price
  });

  it('throws (and snapshots nothing) when the event has no valid contacts', async () => {
    const { builder } = adminWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    // The campaign loads fine, but the current unique-contact count is 0.
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      f({
        data: { event_id: 'e1', price_per_reached: 4, template_id: null },
        error: null,
      }),
    );
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(0);

    await expect(prepareCampaignHold('c1')).rejects.toThrow(
      'אין אנשי קשר תקינים',
    );
    expect(snapshotAuthorizedSet).not.toHaveBeenCalled();
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
      expMonth: 7,
      expYear: 2031,
      citizenId: '316125434',
      authExternalRef: 'ext-1',
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
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());

    await activateCampaign('c1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
    expect(builder.in).toHaveBeenCalledWith('status', [
      'approved',
      'scheduled',
      'paused',
    ]);
    expect(builder.eq).toHaveBeenCalledWith('capture_status', 'authorized');
  });

  it('approveCampaign rejects a past event (L1)', async () => {
    adminWith({
      data: { id: 'c1', event_id: 'e1', status: 'pending_approval' },
      error: null,
    });
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'u1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );

    await expect(approveCampaign('c1', 'v1')).rejects.toThrow('האירוע כבר חלף');
  });

  it('activateCampaign rejects a past event (L1) — no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );

    await expect(activateCampaign('c1')).rejects.toThrow('האירוע כבר חלף');
    expect(builder.update).not.toHaveBeenCalled();
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

describe('B4 close-charge data layer', () => {
  it('getCampaignForCharge maps the charge state (incl. new columns)', async () => {
    adminWith({
      data: {
        id: 'c1',
        event_id: 'e1',
        status: 'closed',
        capture_status: 'authorized',
        charge_status: null,
        card_token_ref: 'tok-abc',
        card_exp_month: 7,
        card_exp_year: 2031,
        card_citizen_id: '316125434',
        auth_external_ref: 'ext-1',
        max_charge_ceiling: '88',
      },
      error: null,
    });
    await expect(getCampaignForCharge('c1')).resolves.toEqual({
      id: 'c1',
      event_id: 'e1',
      status: 'closed',
      capture_status: 'authorized',
      charge_status: null,
      card_token_ref: 'tok-abc',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_citizen_id: '316125434',
      auth_external_ref: 'ext-1',
      max_charge_ceiling: '88',
    });
  });

  it('lockCampaignForCharge wins (true) via the guarded update, idempotency guard', async () => {
    const { builder } = adminWith({ data: { id: 'c1' }, error: null });
    const won = await lockCampaignForCharge('c1');
    expect(builder.update).toHaveBeenCalledWith({ charge_status: 'pending' });
    expect(builder.or).toHaveBeenCalledWith(
      'charge_status.is.null,charge_status.in.(charge_failed,charge_review)',
    );
    expect(won).toBe(true);
  });

  it('lockCampaignForCharge loses (false) when already charging/charged', async () => {
    adminWith({ data: null, error: null });
    expect(await lockCampaignForCharge('c1')).toBe(false);
  });

  it('recordCampaignCharge persists the charged outcome + document id', async () => {
    const { builder } = adminWith({ data: null, error: null });
    await recordCampaignCharge('c1', {
      amount: 12,
      documentId: 555,
      documentNumber: 40103,
      documentUrl: 'https://pay.sumit.co.il/x?download=555',
      authNumber: '0692601',
      paymentId: 777,
    });
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.charge_status).toBe('charged');
    expect(payload.final_charge_amount).toBe(12);
    expect(payload.sumit_charge_document_id).toBe(555);
    expect(payload.charged_at).toBeTruthy();
  });

  it('markCampaignChargeOutcome(nothing_to_charge) zeroes the amount + stamps charged_at', async () => {
    const { builder } = adminWith({ data: null, error: null });
    await markCampaignChargeOutcome('c1', 'nothing_to_charge');
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.charge_status).toBe('nothing_to_charge');
    expect(payload.final_charge_amount).toBe(0);
    expect(payload.charged_at).toBeTruthy();
  });

  it('markCampaignChargeOutcome(charge_failed) only sets the status', async () => {
    const { builder } = adminWith({ data: null, error: null });
    await markCampaignChargeOutcome('c1', 'charge_failed');
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.charge_status).toBe('charge_failed');
    expect(payload.final_charge_amount).toBeUndefined();
  });
});
