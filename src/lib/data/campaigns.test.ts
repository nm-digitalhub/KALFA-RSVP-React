import { beforeEach, describe, expect, it, vi } from 'vitest';

// campaigns.ts begins with `import 'server-only'`; computeCeiling is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// createCampaign's create-or-continue check (getCampaignForEvent) reads via the
// cookie-scoped server client; stub the module so tests wire it explicitly.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
// Lifecycle transitions verify ownership; stub it as a no-op.
vi.mock('@/lib/data/events', () => ({
  requireOwnedEvent: vi.fn(),
  requireEventAccess: vi.fn(),
}));
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
import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent } from '@/lib/data/events';
import { requireUser } from '@/lib/auth/dal';

// A future-dated, active owned event so the L1 past-event guard and the R9
// active-event guard never trip for the generic lifecycle tests (only the
// dedicated past-event/R9 tests supply a different date/status).
function ownedEvent(
  eventDate: string | null = '2999-01-01T00:00:00+00:00',
  status: 'draft' | 'active' | 'closed' = 'active',
) {
  return {
    id: 'e1',
    name: 'Test',
    status,
    event_type: 'birthday' as const,
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
  createCampaign,
  approveCampaign,
  activateCampaign,
  pauseCampaign,
  closeCampaign,
  cancelCampaign,
  getCampaignForCharge,
  lockCampaignForCharge,
  recordCampaignCharge,
  markCampaignChargeOutcome,
  getThankyouSchedule,
  updateThankyouSchedule,
} from '@/lib/data/campaigns';

function adminWith<T>(result: QueryResult<T>) {
  const { client, builder } = createMockSupabase<T>(result);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, builder };
}

// Wire the cookie-scoped server client (the celebrants-gate read +
// getCampaignForEvent go through it); mirror of adminWith.
function serverWith<T>(result: QueryResult<T>) {
  const { client, builder } = createMockSupabase<T>(result);
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
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

  it('compares the floor against the ALREADY-buffered amount (floor + buffer together, §5.5#4)', () => {
    // sized = 10×4×1.1 = 44 < floor 50 → the floor wins over the buffered amount.
    expect(computeHoldAmount(10, 4, 50, 0.1)).toBe(50);
    // sized = 300×4×1.1 = 1320 > floor 50 → the buffered amount wins unchanged.
    expect(computeHoldAmount(300, 4, 50, 0.1)).toBe(1320);
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

  it('live-reads min_hold_floor/hold_buffer_pct on EVERY attempt — a retry reflects the NEW package values (§5.5#5ב)', async () => {
    const { builder } = adminWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(350);
    vi.mocked(snapshotAuthorizedSet).mockResolvedValue(300);
    // One attempt = 4 awaited chains: campaign load → app_settings coverage →
    // packages knobs (the live-read under test) → the campaigns update.
    const sequenceAttempt = (knobs: {
      min_hold_floor: number;
      hold_buffer_pct: number;
    }) =>
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
        .mockImplementationOnce((f) => f({ data: knobs, error: null }))
        .mockImplementationOnce((f) => f({ data: null, error: null }));

    sequenceAttempt({ min_hold_floor: 0, hold_buffer_pct: 0 });
    const first = await prepareCampaignHold('c1');

    // The admin raises the package buffer between attempts; the retry (after
    // hold_failed/hold_review, §1.5) must size the hold from the NEW live-read
    // values — the knobs are NOT snapshotted on the campaign.
    sequenceAttempt({ min_hold_floor: 0, hold_buffer_pct: 0.1 });
    const second = await prepareCampaignHold('c1');

    expect(first.holdAmount).toBe(1200); // 300 × 4 × 1.0
    expect(second.holdAmount).toBe(1320); // 300 × 4 × 1.1 — the NEW buffer
    expect(second.holdAmount).not.toBe(first.holdAmount);
  });
});

describe('createCampaign (§5.5#5א — snapshot locked from the canonical template)', () => {
  it('inserts price/channels/outreach_schedule copied+locked from the template (and the derived ceiling)', async () => {
    // The mock-level equivalent of the plan's "direct campaigns select": the
    // INSERT payload is asserted directly, explicitly NOT via getCampaign/
    // getCampaignForHold (neither returns these snapshot fields).
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(100);

    // The cookie-scoped server client serves (1) the celebrants-gate read
    // (complete for a wedding), (2) getCampaignForEvent (create-or-continue)
    // resolving to "no existing campaign".
    const server = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(server.builder, 'then')
      .mockImplementationOnce((f) =>
        f({
          data: {
            event_type: 'wedding',
            celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
            venue_name: 'אולמי הגן',
          },
          error: null,
        }),
      )
      .mockImplementationOnce((f) => f({ data: null, error: null }));

    // The admin client serves (1) the packages template list, (2) the insert.
    const { builder } = adminWith<unknown>({ data: null, error: null });
    const templateSchedule = [
      { days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' },
    ];
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        f({
          data: [
            {
              id: 'pkg1',
              name: 'x',
              price_per_reached: 4,
              description: null,
              channels: ['whatsapp'],
              outreach_schedule: templateSchedule,
            },
          ],
          error: null,
        }),
      )
      .mockImplementationOnce((f) => f({ data: { id: 'c-new' }, error: null }));

    const r = await createCampaign('e1');

    expect(r.id).toBe('c-new');
    const inserted = vi.mocked(builder.insert).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(inserted.status).toBe('pending_approval');
    expect(inserted.template_id).toBe('pkg1');
    // The locked snapshot copies — the owner chooses nothing (§17/§18.7).
    expect(inserted.price_per_reached).toBe(4);
    expect(inserted.allowed_channels).toEqual(['whatsapp']);
    // Exact shape survives the `as unknown as Json` cast (campaigns.ts insert).
    expect(inserted.outreach_schedule).toEqual(templateSchedule);
    // Derived server-side, never client input: 100 contacts × ₪4.
    expect(inserted.max_contacts).toBe(100);
    expect(inserted.max_charge_ceiling).toBe(400);
  });
});

describe('createCampaign — celebrants gate (בעלי השמחה)', () => {
  // The per-kind completeness matrix (all nine event types × shapes) is
  // covered by celebrantsCompleteFor's own tests in schemas.test.ts; here we
  // verify the GATE wiring only — one couple case and one parents case.
  beforeEach(() => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
  });

  it('blocks creation when celebrants are missing (null) — Hebrew error, nothing inserted', async () => {
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      f({ data: { event_type: 'wedding', celebrants: null }, error: null }),
    );
    const admin = adminWith({ data: null, error: null });

    await expect(createCampaign('e1')).rejects.toThrow(
      'יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
    // The flow never reaches the template read / insert.
    expect(admin.client.from).not.toHaveBeenCalled();
  });

  it('blocks CONTINUING an existing campaign too — the gate precedes the create-or-continue early return', async () => {
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then')
      // 1. the celebrants-gate read — incomplete couple (bride missing)
      .mockImplementationOnce((f) =>
        f({
          data: { event_type: 'wedding', celebrants: { groom: 'דוד לוי' } },
          error: null,
        }),
      )
      // 2. WOULD be getCampaignForEvent returning the EXISTING campaign — the
      //    gate must throw before this early return can ever hand it back.
      .mockImplementationOnce((f) => f({ data: { id: 'c-existing' }, error: null }));

    await expect(createCampaign('e1')).rejects.toThrow(
      'יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
  });

  it('complete couple celebrants pass the gate — the flow proceeds to the NEXT validation (contacts)', async () => {
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        f({
          data: {
            event_type: 'wedding',
            celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
            venue_name: 'אולמי הגן',
          },
          error: null,
        }),
      )
      // getCampaignForEvent → no existing campaign
      .mockImplementationOnce((f) => f({ data: null, error: null }));
    adminWith({ data: null, error: null });
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(0);

    // Rejects on the next gate (no valid contacts) — the celebrants gate passed.
    await expect(createCampaign('e1')).rejects.toThrow('אין אנשי קשר תקינים');
  });

  it('parents kind: parents + host_composition is complete (child optional) — the gate passes', async () => {
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        f({
          data: {
            event_type: 'brit',
            celebrants: { parents: 'משה ורות כהן', host_composition: 'couple' },
            venue_name: 'אולמי הגן',
          },
          error: null,
        }),
      )
      .mockImplementationOnce((f) => f({ data: null, error: null }));
    adminWith({ data: null, error: null });
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(0);

    await expect(createCampaign('e1')).rejects.toThrow('אין אנשי קשר תקינים');
  });

  it('blocks enablement when the event has no event_date — sends could never derive day/date/time', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(null));
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      f({
        data: {
          event_type: 'wedding',
          celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
          venue_name: 'אולמי הגן',
        },
        error: null,
      }),
    );

    await expect(createCampaign('e1')).rejects.toThrow(
      'יש לקבוע תאריך אירוע לפני הפעלת אישורי הגעה',
    );
  });

  it('blocks enablement when venue_name is empty — the location param would be missing on every send', async () => {
    const { builder } = serverWith<Record<string, unknown>>({
      data: null,
      error: null,
    });
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      f({
        data: {
          event_type: 'wedding',
          celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
          venue_name: '   ',
        },
        error: null,
      }),
    );

    await expect(createCampaign('e1')).rejects.toThrow(
      'יש למלא את מקום האירוע בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
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

  it('createCampaign rejects a past event at the entry point (L1)', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );
    // No admin/contacts wiring needed: the guard fires right after the
    // ownership read, before create-or-continue.
    await expect(createCampaign('e1')).rejects.toThrow('האירוע כבר חלף');
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

  // S2.4 — R9: every commercial (forward) campaign action requires
  // event.status='active'. App-level defense-in-depth on top of the DB trigger
  // (campaigns_require_active_event); cancel/pause/close are explicitly NOT R9
  // paths (wind-down stays allowed regardless of event status).
  it('createCampaign rejects when the event is not active (R9)', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(createCampaign('e1')).rejects.toThrow(
      'יש לפרסם את האירוע לפני אישורי הגעה',
    );
  });

  it('approveCampaign rejects when the event is not active (R9)', async () => {
    adminWith({
      data: { id: 'c1', event_id: 'e1', status: 'pending_approval' },
      error: null,
    });
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'u1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(approveCampaign('c1', 'v1')).rejects.toThrow(
      'יש לפרסם את האירוע לפני אישורי הגעה',
    );
  });

  it('activateCampaign rejects when the event is not active (R9) — no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(activateCampaign('c1')).rejects.toThrow(
      'יש לפרסם את האירוע לפני אישורי הגעה',
    );
    expect(builder.update).not.toHaveBeenCalled();
  });

  // Auto-thankyou (§4 auto-thankyou-post-event plan): activation seeds the
  // default schedule (morning after event_date, ~10:00 Israel) exactly once —
  // `.is('thankyou_send_at', null)` is what keeps a re-activation after pause
  // from clobbering an owner-edited send time.
  it('activateCampaign seeds thankyou_send_at (auto-thankyou default schedule) on activation', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2999-01-06T17:00:00+02:00'),
    );

    await activateCampaign('c1');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_send_at: '2999-01-07T10:00:00+02:00' }),
    );
    expect(builder.is).toHaveBeenCalledWith('thankyou_send_at', null);
  });

  it('activateCampaign does not seed a thankyou schedule when the event has no date', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(null));

    await activateCampaign('c1');

    expect(builder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_send_at: expect.anything() }),
    );
  });
});

// Auto-thankyou owner controls (getThankyouSchedule / updateThankyouSchedule).
// Forward-compat columns (pending migration 20260712205030) — read via
// select('*') + narrowing, same stance as the rest of this file's pending-
// column readers.
describe('getThankyouSchedule / updateThankyouSchedule', () => {
  it('reads the schedule, fail-open toward auto_enabled=true when the column is absent', async () => {
    serverWith({
      data: { id: 'c1' }, // no thankyou_* columns at all (pre-migration row)
      error: null,
    });

    const schedule = await getThankyouSchedule('c1');
    expect(schedule).toEqual({ autoEnabled: true, sendAt: null, sentAt: null });
  });

  it('reads an explicitly disabled + scheduled + sent row', async () => {
    serverWith({
      data: {
        id: 'c1',
        thankyou_auto_enabled: false,
        thankyou_send_at: '2026-07-13T10:00:00+03:00',
        thankyou_sent_at: '2026-07-13T10:00:05+03:00',
      },
      error: null,
    });

    const schedule = await getThankyouSchedule('c1');
    expect(schedule).toEqual({
      autoEnabled: false,
      sendAt: '2026-07-13T10:00:00+03:00',
      sentAt: '2026-07-13T10:00:05+03:00',
    });
  });

  it('returns null when the campaign is not visible (RLS / not found)', async () => {
    serverWith({ data: null, error: null });
    expect(await getThankyouSchedule('missing')).toBeNull();
  });

  it('updateThankyouSchedule verifies ownership before writing', async () => {
    serverWith({ data: { id: 'c1', event_id: 'e1' }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    const { builder: adminBuilder } = adminWith({ data: { id: 'c1' }, error: null });

    await updateThankyouSchedule('c1', { autoEnabled: false });

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(adminBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_auto_enabled: false }),
    );
    expect(adminBuilder.is).toHaveBeenCalledWith('thankyou_sent_at', null);
  });

  it('updateThankyouSchedule throws a friendly error once the thank-you already fired (no rows updated)', async () => {
    serverWith({ data: { id: 'c1', event_id: 'e1' }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    adminWith({ data: null, error: null }); // the guarded update matches 0 rows

    await expect(
      updateThankyouSchedule('c1', { sendAt: '2026-07-14T10:00:00+03:00' }),
    ).rejects.toThrow('הודעת התודה כבר נשלחה');
  });

  it('updateThankyouSchedule is a no-op when the patch is empty', async () => {
    serverWith({ data: { id: 'c1', event_id: 'e1' }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    const { client: adminClient } = adminWith({ data: { id: 'c1' }, error: null });

    await updateThankyouSchedule('c1', {});

    expect(adminClient.from).not.toHaveBeenCalled();
  });
});

describe('cancelCampaign (R8 — explicit ownership contract, round-3)', () => {
  it('does NOT call the RPC when the calling user does not own the campaign\'s event', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    const notOwned = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
    vi.mocked(requireOwnedEvent).mockRejectedValue(notOwned);

    await expect(cancelCampaign('c1')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls cancel_campaign with the correct id once ownership is verified', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    client.rpc.mockResolvedValue({ data: 'cancelled', error: null });

    await cancelCampaign('c1');

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(client.rpc).toHaveBeenCalledWith('cancel_campaign', { p_campaign: 'c1' });
  });

  it('resolves (idempotent success) on already_cancelled', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    client.rpc.mockResolvedValue({ data: 'already_cancelled', error: null });

    await expect(cancelCampaign('c1')).resolves.toBeUndefined();
  });

  it('throws a safe Hebrew message on not_cancellable', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    client.rpc.mockResolvedValue({ data: 'not_cancellable', error: null });

    await expect(cancelCampaign('c1')).rejects.toThrow('לא ניתן לבטל קמפיין זה');
  });
});

describe('B4 close-charge data layer', () => {
  it('getCampaignForCharge selects the charge columns via the admin client', async () => {
    const { client, builder } = adminWith({
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
        max_charge_ceiling: 88,
      },
      error: null,
    });

    const r = await getCampaignForCharge('c1');

    expect(client.from).toHaveBeenCalledWith('campaigns');
    expect(builder.select).toHaveBeenCalledWith(
      'id, event_id, status, capture_status, charge_status, card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref, max_charge_ceiling',
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
    expect(r).toEqual({
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
      max_charge_ceiling: 88,
    });
  });

  it('getCampaignForCharge maps max_charge_ceiling: null (not-yet-set ceiling)', async () => {
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
        max_charge_ceiling: null,
      },
      error: null,
    });

    const r = await getCampaignForCharge('c1');

    expect(r?.max_charge_ceiling).toBeNull();
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
