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
// approveCampaign reads the session user; wind-down transitions require a platform permission.
vi.mock('@/lib/auth/dal', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  requirePlatformPermission: vi.fn(),
}));
// The staff branch of updateThankyouSchedule writes a fail-closed audit row;
// stub it so the tests can assert it happened without a database.
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));
// contacts.ts is owned by another module; stub the two functions prepareCampaignHold
// consumes so this suite runs independently of that module's wiring.
vi.mock('@/lib/data/contacts', () => ({
  countUniqueContactsForEvent: vi.fn(),
}));
// Ops alerting is additive + fail-safe; stub it so lifecycle emits are assertable
// and the real Slack WebClient is never loaded in unit tests.
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
// Activation now writes an activity_log row (auditability); stub the logger so
// lifecycle tests assert the call without touching the activity module.
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
// Base+overage gate: default OFF so createCampaign snapshots 0/0 =
// today's pure per-reached. Per-test override for the gate-ON path.
vi.mock('@/lib/data/payments', () => ({
  // The fixed-price package switch: OFF by default (the production default), per-test override for the package path.
  getPackageModelEnabled: vi.fn().mockResolvedValue(false),
}));
// createCampaign's package path requires the ACTIVE agreement to be the package contract.
vi.mock('@/lib/data/agreements-doc', () => ({ getApprovedPackageAgreementDoc: vi.fn() }));
// A paid package starts only when the LEDGER says it is paid, and its list is filled first.
vi.mock('@/lib/data/authorized-fill', () => ({ fillAuthorizedSet: vi.fn() }));
vi.mock('@/lib/payments/package-paid', () => ({
  getPackagePaymentState: vi.fn(),
  packagePaymentOf: vi.fn().mockResolvedValue(null),
}));

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent } from '@/lib/data/events';
import { requireUser, requireAdmin, requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { logActivity } from '@/lib/data/activity';

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
import { countUniqueContactsForEvent } from '@/lib/data/contacts';
import {
  getCampaignForPurchase,
  listPackageOffers,
  getPackageOffer,
  createCampaign,
  approveCampaign,
  activateCampaign,
  pauseCampaign,
  closeCampaign,
  cancelCampaign,
  getThankyouSchedule,
  updateThankyouSchedule,
  getCampaignStageForEvent,
  NO_PACKAGE_ERROR,
} from '@/lib/data/campaigns';
import { getPackageModelEnabled } from '@/lib/data/payments';
import { getApprovedPackageAgreementDoc } from '@/lib/data/agreements-doc';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import {
  PACKAGE_NOT_PAID_ERROR,
  PACKAGE_PAYMENT_UNVERIFIED_ERROR,
} from '@/lib/data/package-activation-errors';
import { getPackagePaymentState, packagePaymentOf } from '@/lib/payments/package-paid';

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

beforeEach(() => {
  vi.clearAllMocks();
  // Every campaign that is started has a recorded package payment unless a test says otherwise.
  vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 150, credit: 0, committed: 0 });
  // clearAllMocks resets call history but NOT implementations — a test that
  // makes requireAdmin reject (non-admin) would otherwise leak into the next.
  vi.mocked(requireAdmin).mockResolvedValue(
    { id: 'admin' } as unknown as Awaited<ReturnType<typeof requireAdmin>>,
  );
  vi.mocked(requirePlatformPermission).mockResolvedValue(
    { id: 'admin' } as unknown as Awaited<ReturnType<typeof requirePlatformPermission>>,
  );
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

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow(
      'יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
    // The flow never reaches the package read / insert.
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

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow(
      'יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
  });

  it('complete couple celebrants pass the gate — the flow proceeds to the NEXT validation (the package offer), even with zero contacts', async () => {
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
    // The package switch is off (the default mock), so the package is not an offer.
    adminWith({ data: null, error: null });
    // Zero contacts does not block creation — the gate that DOES fire is the next one.
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(0);

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow('החבילה שנבחרה אינה זמינה');
  });

  it('parents kind: parents + host_composition is complete (child optional) — the gate passes, even with zero contacts', async () => {
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

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow('החבילה שנבחרה אינה זמינה');
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

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow(
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

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow(
      'יש למלא את מקום האירוע בעריכת האירוע לפני הפעלת אישורי הגעה',
    );
  });
});

describe('getCampaignForPurchase', () => {
  it('selects only what the package purchase needs, via the admin client', async () => {
    const { client, builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', status: 'approved', package_price: 120, package: { name: 'אישורי הגעה — וואטסאפ + שיחות AI' } },
      error: null,
    });

    const r = await getCampaignForPurchase('c1');

    expect(client.from).toHaveBeenCalledWith('campaigns');
    // The package the campaign was created from (template_id → packages): its name is the receipt line.
    expect(builder.select).toHaveBeenCalledWith('id, event_id, status, package_price, package:packages(name)');
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
    expect(r).toEqual({ id: 'c1', event_id: 'e1', status: 'approved', package_price: 120, package_name: 'אישורי הגעה — וואטסאפ + שיחות AI' });
  });

  it('returns null for a campaign that does not exist', async () => {
    adminWith({ data: null, error: null });
    expect(await getCampaignForPurchase('missing')).toBeNull();
  });

  it('throws a safe Hebrew message on a read error (never a null that reads as "not found")', async () => {
    adminWith({ data: null, error: { message: 'boom' } });
    await expect(getCampaignForPurchase('c1')).rejects.toThrow('טעינת הקמפיין נכשלה');
  });
});

describe('campaign lifecycle transitions', () => {
  it('activateCampaign requires an approved, paid package campaign → status active', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
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
    expect(builder.not).toHaveBeenCalledWith('package_price', 'is', null);
    expect(getPackagePaymentState).toHaveBeenCalledWith('c1');
    // Additive campaign_billing alert once activation succeeds (campaign_id only).
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        category: 'campaign_billing',
        title: 'קמפיין הופעל — הפניות מתחילות',
        fields: { campaign_id: 'c1' },
      }),
    );
  });

  it('createCampaign rejects a past event at the entry point (L1)', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );
    // No admin/contacts wiring needed: the guard fires right after the
    // ownership read, before create-or-continue.
    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow('האירוע כבר חלף');
  });

  it('approveCampaign rejects a past event (L1)', async () => {
    adminWith({
      data: { id: 'c1', event_id: 'e1', status: 'pending_approval', package_price: 150 },
      error: null,
    });
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'u1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );

    await expect(approveCampaign('c1', '2026-10-v6')).rejects.toThrow('האירוע כבר חלף');
  });

  it('activateCampaign rejects a past event (L1) — no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(
      ownedEvent('2020-01-01T00:00:00+00:00'),
    );

    await expect(activateCampaign('c1')).rejects.toThrow('האירוע כבר חלף');
    expect(builder.update).not.toHaveBeenCalled();
  });

  // Wind-down is staff-only and NAMED: pause/close/cancel gate on
  // `campaigns.runstate` (NOT event ownership, and not the coarse
  // requireAdmin floor). The regression below (activateCampaign) proves the
  // owner path is unchanged for forward transitions.
  it('pauseCampaign: admin allowed → active → paused, WITHOUT an ownership check', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });

    await pauseCampaign('c1');

    expect(requirePlatformPermission).toHaveBeenCalledWith('campaigns.runstate');
    expect(requireOwnedEvent).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ status: 'paused' });
    expect(builder.in).toHaveBeenCalledWith('status', ['active']);
  });

  it('pauseCampaign: non-admin rejected → no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    const redirected = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' });
    vi.mocked(requirePlatformPermission).mockRejectedValue(redirected);

    await expect(pauseCampaign('c1')).rejects.toThrow('NEXT_REDIRECT');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('closeCampaign: admin allowed → active/paused/approved/scheduled → closed, WITHOUT an ownership check', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });

    await closeCampaign('c1');

    expect(requirePlatformPermission).toHaveBeenCalledWith('campaigns.runstate');
    expect(requireOwnedEvent).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ status: 'closed' });
  });

  it('closeCampaign: non-admin rejected → no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    const redirected = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' });
    vi.mocked(requirePlatformPermission).mockRejectedValue(redirected);

    await expect(closeCampaign('c1')).rejects.toThrow('NEXT_REDIRECT');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('activateCampaign stays owner-gated: calls requireOwnedEvent, NOT the run-state gate', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());

    await activateCampaign('c1');

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(requirePlatformPermission).not.toHaveBeenCalledWith('campaigns.runstate');
    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
  });

  it('throws when the campaign is not in a transitionable state (0 rows updated)', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    // First await (load campaign) → exists; second await (guarded update) → no row.
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: { id: 'c1', event_id: 'e1', package_price: 150 }, error: null }))
      .mockImplementationOnce((f) => f({ data: null, error: null }));

    await expect(closeCampaign('c1')).rejects.toThrow(
      'לא ניתן לשנות את מצב הקמפיין',
    );
  });

  // R9: every commercial (forward) campaign action requires
  // event.status='active'. App-level defense-in-depth on top of the DB trigger
  // (campaigns_require_active_event); cancel/pause/close are explicitly NOT R9
  // paths (wind-down stays allowed regardless of event status).
  it('createCampaign rejects when the event is not active (R9)', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow(
      'יש לאשר את פרטי האירוע לפני אישורי הגעה',
    );
  });

  it('approveCampaign rejects when the event is not active (R9)', async () => {
    adminWith({
      data: { id: 'c1', event_id: 'e1', status: 'pending_approval', package_price: 150 },
      error: null,
    });
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'u1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(approveCampaign('c1', '2026-10-v6')).rejects.toThrow(
      'יש לאשר את פרטי האירוע לפני אישורי הגעה',
    );
  });

  it('activateCampaign rejects when the event is not active (R9) — no status write', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
      error: null,
    });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent(undefined, 'draft'));

    await expect(activateCampaign('c1')).rejects.toThrow(
      'יש לאשר את פרטי האירוע לפני אישורי הגעה',
    );
    expect(builder.update).not.toHaveBeenCalled();
  });

  // Auto-thankyou: activation seeds the
  // default schedule (morning after event_date, ~10:00 Israel) exactly once —
  // `.is('thankyou_send_at', null)` is what keeps a re-activation after pause
  // from clobbering an owner-edited send time.
  it('activateCampaign seeds thankyou_send_at (auto-thankyou default schedule) on activation', async () => {
    const { builder } = adminWith({
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
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
      data: { id: 'c1', event_id: 'e1', package_price: 150 },
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
// The read keeps select('*') + narrowing as a fail-open guard: an absent
// column reads as the default (enabled), not "disabled".
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

  // updateThankyouSchedule reads the campaign (+ its owner) through the SERVICE
  // client and then writes through it, so these tests hand the mock a two-step
  // sequence: the lookup first, the guarded update second. A single fixed result
  // cannot express "found the campaign, but the update matched no rows".
  function adminSequence(results: { data: unknown; error: unknown }[]) {
    const { client, builder } = adminWith<never>({ data: null, error: null });
    let call = 0;
    builder.then = ((onFulfilled: (v: unknown) => unknown) =>
      onFulfilled(results[Math.min(call++, results.length - 1)])) as never;
    return { client, builder };
  }

  const CAMPAIGN_ROW = {
    id: 'c1',
    event_id: 'e1',
    events: { owner_id: 'u1' },
  };

  function asOwner() {
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'u1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
  }

  it('updateThankyouSchedule verifies ownership before writing', async () => {
    asOwner();
    const { builder } = adminSequence([
      { data: CAMPAIGN_ROW, error: null },
      { data: { id: 'c1' }, error: null },
    ]);

    await updateThankyouSchedule('c1', { autoEnabled: false });

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    // The owner path must NOT reach for a staff permission — that branch exists
    // for platform staff, and an owner silently taking it would mean every
    // owner edit of their own campaign wrote a support-access audit row.
    expect(requirePlatformPermission).not.toHaveBeenCalled();
    expect(recordStaffAccess).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ thankyou_auto_enabled: false }),
    );
    expect(builder.is).toHaveBeenCalledWith('thankyou_sent_at', null);
  });

  // Platform staff may pause, close, cancel and settle-and-charge someone
  // else's campaign; refusing them an hour's change to its thank-you time was an
  // inconsistency, not a boundary. The write is allowed — and audited.
  it('updateThankyouSchedule lets platform staff edit a campaign they do not own', async () => {
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'staff-1' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(requirePlatformPermission).mockResolvedValue(
      { id: 'staff-1' } as unknown as Awaited<ReturnType<typeof requirePlatformPermission>>,
    );
    const { builder } = adminSequence([
      { data: CAMPAIGN_ROW, error: null },
      { data: { id: 'c1' }, error: null },
    ]);

    await updateThankyouSchedule('c1', { autoEnabled: false });

    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    // Ownership is NOT required of staff — and must not be silently demanded,
    // which would 404 them instead of authorizing them.
    expect(requireOwnedEvent).not.toHaveBeenCalled();
    // service_role carries no user identity, so this row is the only record of
    // who changed a customer's schedule. It must name the customer, not just the
    // staff member, or "was my account touched" is unanswerable.
    expect(recordStaffAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-1',
        permission: 'manage_billing',
        subjectType: 'campaign',
        subjectId: 'c1',
        ownerId: 'u1',
      }),
    );
    expect(builder.update).toHaveBeenCalled();
  });

  it('updateThankyouSchedule refuses a signed-in stranger who is neither owner nor staff', async () => {
    vi.mocked(requireUser).mockResolvedValue(
      { id: 'someone-else' } as unknown as Awaited<ReturnType<typeof requireUser>>,
    );
    // requirePlatformPermission redirects (throws) for a user without the key.
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    const { builder } = adminSequence([{ data: CAMPAIGN_ROW, error: null }]);

    await expect(updateThankyouSchedule('c1', { autoEnabled: false })).rejects.toThrow();
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('updateThankyouSchedule throws a friendly error once the thank-you already fired (no rows updated)', async () => {
    asOwner();
    adminSequence([
      { data: CAMPAIGN_ROW, error: null },
      { data: null, error: null }, // the guarded update matches 0 rows
    ]);

    await expect(
      updateThankyouSchedule('c1', { sendAt: '2026-07-14T10:00:00+03:00' }),
    ).rejects.toThrow('הודעת התודה כבר נשלחה');
  });

  it('updateThankyouSchedule is a no-op when the patch is empty', async () => {
    asOwner();
    const { builder } = adminSequence([{ data: CAMPAIGN_ROW, error: null }]);

    await updateThankyouSchedule('c1', {});

    // The lookup happens; the WRITE must not.
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe('cancelCampaign (R8 — wind-down, platform-admin only)', () => {
  it('does NOT call the RPC when the caller is not a platform admin', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    const redirected = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' });
    vi.mocked(requirePlatformPermission).mockRejectedValue(redirected);

    await expect(cancelCampaign('c1')).rejects.toThrow('NEXT_REDIRECT');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls cancel_campaign with the correct id once admin is verified, WITHOUT an ownership check', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'cancelled', error: null });

    await cancelCampaign('c1');

    expect(requirePlatformPermission).toHaveBeenCalledWith('campaigns.runstate');
    expect(requireOwnedEvent).not.toHaveBeenCalled();
    // Who cancelled is the staff member who passed the gate (the default mock above), recorded by the RPC in the same transaction.
    expect(client.rpc).toHaveBeenCalledWith('cancel_campaign', { p_campaign: 'c1', p_actor: 'admin' });
    // Additive campaign_billing alert on a FRESH cancellation.
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        category: 'campaign_billing',
        title: 'קמפיין בוטל',
        fields: { campaign_id: 'c1', event_id: 'e1' },
      }),
    );
  });

  it('resolves (idempotent success) on already_cancelled', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'already_cancelled', error: null });

    await expect(cancelCampaign('c1')).resolves.toBeUndefined();
    // already_cancelled is idempotent-retry noise → NO alert (no Slack spam).
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('throws a safe Hebrew message on not_cancellable', async () => {
    const { client } = adminWith<{ id: string; event_id: string }>({
      data: { id: 'c1', event_id: 'e1' },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: 'not_cancellable', error: null });

    await expect(cancelCampaign('c1')).rejects.toThrow('לא ניתן לבטל קמפיין זה');
  });
});

// A console actor's identity is verified by the ROUTE (Bearer + the
// campaigns.runstate permission), so these transitions touch neither the cookie
// ownership check nor the run-state gate. What they must still honour is every
// BUSINESS guard — and the event they are guarded against is read through the
// service-role client, not requireOwnedEvent. This double serves the two reads
// that path makes (campaigns, then events) with different rows.
function adminByTable(rows: Record<string, unknown>) {
  const builders: Record<string, ReturnType<typeof createMockSupabase>['builder']> = {};
  const client = {
    from: vi.fn((table: string) => {
      builders[table] ??= createMockSupabase({
        data: (rows[table] ?? null) as never,
        error: null,
      }).builder;
      return builders[table];
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return builders;
}

describe('campaign run-state: console actor (owner decision 2026-07-21)', () => {
  const CONSOLE = { kind: 'console' as const, staffUserId: 'staff-1' };

  it('activate is REVIVAL only — the from-set is paused, never approved/scheduled', async () => {
    const builders = adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' },
    });

    await activateCampaign('c1', CONSOLE);

    // The narrowing that makes staff activation safe: a paused campaign is proof
    // the OWNER already activated it, so staff resume a commitment and can never
    // create one.
    expect(builders.campaigns.in).toHaveBeenCalledWith('status', ['paused']);
    expect(builders.campaigns.in).not.toHaveBeenCalledWith(
      'status',
      expect.arrayContaining(['approved']),
    );
    expect(builders.campaigns.update).toHaveBeenCalledWith({ status: 'active' });
  });

  it('still requires the package payment', async () => {
    const builders = adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' },
    });

    await activateCampaign('c1', CONSOLE);

    expect(getPackagePaymentState).toHaveBeenCalledWith('c1');
    expect(builders.campaigns.not).toHaveBeenCalledWith('package_price', 'is', null);
  });

  it('still refuses a PAST event — the guard the first draft of the route lost', async () => {
    const builders = adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2020-01-01T00:00:00+00:00', status: 'active' },
    });

    await expect(activateCampaign('c1', CONSOLE)).rejects.toThrow('האירוע כבר חלף');
    expect(builders.campaigns.update).not.toHaveBeenCalled();
  });

  it('still refuses a non-active event', async () => {
    const builders = adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2999-01-01T00:00:00+00:00', status: 'draft' },
    });

    await expect(activateCampaign('c1', CONSOLE)).rejects.toThrow(
      'יש לאשר את פרטי האירוע לפני אישורי הגעה',
    );
    expect(builders.campaigns.update).not.toHaveBeenCalled();
  });

  it('uses neither the cookie ownership check nor the run-state gate', async () => {
    adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' },
    });

    await activateCampaign('c1', CONSOLE);

    expect(requireOwnedEvent).not.toHaveBeenCalled();
    expect(requirePlatformPermission).not.toHaveBeenCalledWith('campaigns.runstate');
  });

  it('pause: active → paused without the run-state gate', async () => {
    const builders = adminByTable({
      campaigns: { id: 'c1', event_id: 'e1', package_price: 150 },
      events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' },
    });

    await pauseCampaign('c1', CONSOLE);

    expect(builders.campaigns.update).toHaveBeenCalledWith({ status: 'paused' });
    expect(builders.campaigns.in).toHaveBeenCalledWith('status', ['active']);
    expect(requirePlatformPermission).not.toHaveBeenCalledWith('campaigns.runstate');
  });

  it('the OWNER path is unchanged — full from-set, ownership still checked', async () => {
    const { builder } = adminWith({ data: { id: 'c1', event_id: 'e1', package_price: 150 }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());

    await activateCampaign('c1');

    expect(requireOwnedEvent).toHaveBeenCalledWith('e1');
    expect(builder.in).toHaveBeenCalledWith('status', ['approved', 'scheduled', 'paused']);
  });
});

describe('activateCampaign — auditability', () => {
  it('writes a campaign.activated activity row with the actor kind', async () => {
    const { builder } = adminWith({ data: { id: 'c1', event_id: 'e1', package_price: 150 }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.spyOn(builder, 'then').mockImplementation((f) =>
      f({ data: { id: 'c1', event_id: 'e1', package_price: 150 }, error: null }),
    );

    await activateCampaign('c1');

    expect(logActivity).toHaveBeenCalledWith({
      eventId: 'e1',
      action: 'campaign.activated',
      meta: { campaignId: 'c1', actor: 'owner' },
    });
  });
});

// The guests page's first-run screen shows the campaign stage next to a resource
// the viewer may hold WITHOUT ('campaigns','view'), so this reader degrades to
// null instead of notFound()-ing the page around it.
describe('getCampaignStageForEvent', () => {
  it('returns null and reads nothing when the viewer lacks campaigns.view', async () => {
    const { client } = serverWith({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: false, error: null });

    expect(await getCampaignStageForEvent('e1')).toBeNull();
    // The RPC is the gate: a denied viewer must not reach the campaigns table.
    expect(client.from).not.toHaveBeenCalled();
  });

  it('gates on ("campaigns","view") for the event', async () => {
    const { client } = serverWith({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: true, error: null });

    await getCampaignStageForEvent('e1');

    expect(client.rpc).toHaveBeenCalledWith('can_access_event', {
      _event_id: 'e1',
      _resource: 'campaigns',
      _action: 'view',
    });
  });

  it('derives the stage rather than returning the raw status', async () => {
    // approved + the package paid is "ממתין להפעלה", not "מאושר".
    const { client } = serverWith({
      data: { id: 'c1', status: 'approved', package_price: 150 },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(packagePaymentOf).mockResolvedValueOnce({ status: 'collected', collected: 150, credit: 0, committed: 0 });

    expect(await getCampaignStageForEvent('e1')).toBe('awaiting_activation');
  });

  it('returns not_set when the event has no campaign yet', async () => {
    const { client } = serverWith({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: true, error: null });

    expect(await getCampaignStageForEvent('e1')).toBe('not_set');
  });

  it('excludes cancelled campaigns, like getCampaignForEvent', async () => {
    const { client, builder } = serverWith({ data: null, error: null });
    client.rpc.mockResolvedValue({ data: true, error: null });

    await getCampaignStageForEvent('e1');

    expect(builder.eq).toHaveBeenCalledWith('event_id', 'e1');
    expect(builder.neq).toHaveBeenCalledWith('status', 'cancelled');
  });
});

// ---- the fixed-price package model (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-F) ----------------
// A package with a contact quota is offered and snapshotted onto a campaign ONLY while the package switch is on, and
// only a quota package (never a pay-per-result one, never a mix) is ever an offer.

const packageRow = (over: Record<string, unknown> = {}) => ({
  id: 'pkg-fixed',
  name: 'חבילת זהב',
  price_with_vat: 150,
  contact_quota: 40,
  description: null,
  includes: ['וואטסאפ', 5, 'שיחות AI'],
  channels: ['whatsapp'],
  outreach_schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' }],
  ...over,
});

describe('listPackageOffers — the catalogue of fixed-price packages', () => {
  it('is EMPTY while the package switch is off, without even reading the catalogue (fail-closed)', async () => {
    const { client } = adminWith<unknown>({ data: [packageRow()], error: null });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(false);

    expect(await listPackageOffers()).toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('with the switch on, returns only active packages that carry a quota', async () => {
    const { client, builder } = adminWith<unknown>({ data: [packageRow()], error: null });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);

    const offers = await listPackageOffers();

    expect(client.from).toHaveBeenCalledWith('packages');
    expect(builder.eq).toHaveBeenCalledWith('active', true);
    expect(builder.not).toHaveBeenCalledWith('contact_quota', 'is', null);
    expect(offers).toEqual([
      {
        id: 'pkg-fixed',
        name: 'חבילת זהב',
        price: 150,
        contact_quota: 40,
        description: null,
        // a non-string entry in the JSON column is dropped, not shown
        includes: ['וואטסאפ', 'שיחות AI'],
        channels: ['whatsapp'],
        outreach_schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' }],
      },
    ]);
  });

  it('drops a row that is not a sellable package: no price, no quota of at least one, or no channel', async () => {
    adminWith<unknown>({
      data: [
        packageRow({ id: 'free', price_with_vat: 0 }),
        packageRow({ id: 'zero-quota', contact_quota: 0 }),
        packageRow({ id: 'no-channel', channels: [] }),
        packageRow({ id: 'ok' }),
      ],
      error: null,
    });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);

    expect((await listPackageOffers()).map((o) => o.id)).toEqual(['ok']);
  });

  it('a read error is thrown, never an empty catalogue', async () => {
    adminWith<unknown>({ data: null, error: { message: 'boom' } });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);
    await expect(listPackageOffers()).rejects.toThrow('טעינת החבילות נכשלה');
  });

  it('getPackageOffer finds one offer by id, and is null for anything that is not an offer', async () => {
    adminWith<unknown>({ data: [packageRow()], error: null });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);
    expect((await getPackageOffer('pkg-fixed'))?.contact_quota).toBe(40);

    adminWith<unknown>({ data: [packageRow()], error: null });
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);
    expect(await getPackageOffer('other')).toBeNull();
  });
});

describe('createCampaign(eventId, packageId) — a campaign from a fixed-price package', () => {
  const celebrants = {
    event_type: 'wedding',
    celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
    venue_name: 'אולמי הגן',
  };
  const PACKAGE_DOC = { version: '2026-10-v6', status: 'approved' as const, bodyHtml: '<p>x</p>' };

  // The cookie client serves the celebrants gate then "no existing campaign"; the admin client serves the offers read
  // then the insert — in that order, exactly as the legacy suite above wires it.
  function wire(opts: { existing?: boolean; offers?: unknown; insertResult?: unknown } = {}) {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(25);
    const server = serverWith<Record<string, unknown>>({ data: null, error: null });
    vi.spyOn(server.builder, 'then')
      .mockImplementationOnce((f) => f({ data: celebrants, error: null }))
      .mockImplementationOnce((f) => f({ data: opts.existing ? { id: 'c-existing', status: 'pending_approval' } : null, error: null }));
    const { builder } = adminWith<unknown>({ data: null, error: null });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) => f({ data: opts.offers ?? [packageRow()], error: null }))
      .mockImplementationOnce((f) => f({ data: opts.insertResult ?? { id: 'c-new' }, error: null }));
    vi.mocked(getPackageModelEnabled).mockResolvedValueOnce(true);
    vi.mocked(getApprovedPackageAgreementDoc).mockResolvedValue(PACKAGE_DOC);
    return builder;
  }

  it('snapshots the package onto the campaign: its price, its quota, and NO per-reached formula or ceiling', async () => {
    const builder = wire();

    const r = await createCampaign('e1', 'pkg-fixed');

    expect(r.id).toBe('c-new');
    const inserted = vi.mocked(builder.insert).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      status: 'pending_approval',
      template_id: 'pkg-fixed',
      package_price: 150,
      contact_quota: 40,
      allowed_channels: ['whatsapp'],
      outreach_schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' }],
      max_contacts: 25,
    });
    // The retired pay-per-result columns are not written at all (reach recording no longer reads them).
    for (const retired of ['price_per_reached', 'base_price', 'included_reached', 'max_charge_ceiling']) {
      expect(inserted).not.toHaveProperty(retired);
    }
  });

  it('refuses while the package switch is off, writing nothing', async () => {
    const builder = wire();
    vi.mocked(getPackageModelEnabled).mockReset();
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow('החבילה שנבחרה אינה זמינה');
    expect(builder.insert).not.toHaveBeenCalled();
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
  });

  it('refuses a package that is not an offer (another id, a pay-per-result package)', async () => {
    const builder = wire({ offers: [] });
    await expect(createCampaign('e1', 'pkg-legacy')).rejects.toThrow('החבילה שנבחרה אינה זמינה');
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('refuses unless the package contract is approved — there would be no terms for the customer to approve', async () => {
    const builder = wire();
    vi.mocked(getApprovedPackageAgreementDoc).mockResolvedValue(null);

    await expect(createCampaign('e1', 'pkg-fixed')).rejects.toThrow('הסכם החבילה טרם הופעל');
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('create-or-continue: an existing campaign is returned unchanged, with no offers read and no second campaign', async () => {
    const builder = wire({ existing: true });

    const r = await createCampaign('e1', 'pkg-fixed');

    expect(r.id).toBe('c-existing');
    expect(builder.insert).not.toHaveBeenCalled();
    expect(getApprovedPackageAgreementDoc).not.toHaveBeenCalled();
  });
});

describe('approveCampaign — only a package campaign, only under the package contract', () => {
  async function approveWith(campaignRow: Record<string, unknown>, version: string) {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    const { builder } = adminWith<unknown>({ data: campaignRow, error: null });
    return { builder, result: approveCampaign('c1', version) };
  }
  const pending = { id: 'c1', event_id: 'e1', status: 'pending_approval' };

  it('a package campaign cannot be approved under an earlier pay-per-result contract version', async () => {
    const { builder, result } = await approveWith({ ...pending, package_price: 150 }, '2026-09-v5');
    await expect(result).rejects.toThrow('ההסכם אינו תואם למודל התמחור של הקמפיין');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('a campaign without a package cannot be approved', async () => {
    const { builder, result } = await approveWith({ ...pending, package_price: null }, '2026-10-v6');
    await expect(result).rejects.toThrow('ההסכם אינו תואם למודל התמחור של הקמפיין');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('the draft form of the package contract counts as the package contract', async () => {
    const { builder, result } = await approveWith({ ...pending, package_price: 150 }, 'draft-2026-10-v6');
    await result;
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', tos_version: 'draft-2026-10-v6' }));
  });
});

describe('activateCampaign — a paid package campaign', () => {
  const PACKAGE_ROW = { id: 'c1', event_id: 'e1', package_price: 150 };
  const FUTURE = { event_date: '2999-01-01T00:00:00+00:00', status: 'active' };

  function wire(row: Record<string, unknown> = PACKAGE_ROW) {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 150, credit: 0, committed: 0 });
    vi.mocked(fillAuthorizedSet).mockResolvedValue({ verdict: 'filled', admitted: 3, size: 3, quota: 100, waiting: 0 });
    return adminByTable({ campaigns: row, events: FUTURE });
  }

  beforeEach(() => {
    vi.mocked(getPackagePaymentState).mockReset();
    vi.mocked(fillAuthorizedSet).mockReset();
  });

  it('checks the ledger and moves to active without filling the guest list', async () => {
    const b = wire();
    await activateCampaign('c1');
    expect(getPackagePaymentState).toHaveBeenCalledWith('c1');
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
    expect(b.campaigns.update).toHaveBeenCalledWith({ status: 'active' });
    expect(b.campaigns.not).toHaveBeenCalledWith('package_price', 'is', null);
  });

  it('proves ownership before reading payment, and payment before changing status', async () => {
    const b = wire();
    await activateCampaign('c1');
    const order = (m: unknown) => (m as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(order(requireOwnedEvent)).toBeLessThan(order(getPackagePaymentState));
    expect(order(getPackagePaymentState)).toBeLessThan(order(b.campaigns.update));
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it.each(['none', 'pending', 'review', 'declined', 'refunded', 'released', 'committed'] as const)(
    'refuses while the payment is %s — and fills nothing',
    async (status) => {
      const b = wire();
      vi.mocked(getPackagePaymentState).mockResolvedValue({ status, collected: 0, credit: 0, committed: 0 });
      await expect(activateCampaign('c1')).rejects.toThrow(PACKAGE_NOT_PAID_ERROR);
      expect(fillAuthorizedSet).not.toHaveBeenCalled();
      expect(b.campaigns.update).not.toHaveBeenCalled();
    },
  );

  it('an unreadable ledger is "cannot verify", never "paid" and never "not paid"', async () => {
    const b = wire();
    vi.mocked(getPackagePaymentState).mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(activateCampaign('c1')).rejects.toThrow(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });

  it('refuses a past event before it touches the ledger or the list', async () => {
    wire();
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent('2020-01-01T00:00:00+00:00'));
    await expect(activateCampaign('c1')).rejects.toThrow('האירוע כבר חלף');
    expect(getPackagePaymentState).not.toHaveBeenCalled();
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
  });

  it('activates a paid campaign that has no guests yet, without filling the list', async () => {
    const b = wire();
    vi.mocked(fillAuthorizedSet).mockResolvedValue({
      verdict: 'filled', admitted: 0, size: 0, quota: 100, waiting: 0,
    });

    await expect(activateCampaign('c1')).resolves.toBeUndefined();

    expect(getPackagePaymentState).toHaveBeenCalledWith('c1');
    expect(fillAuthorizedSet).not.toHaveBeenCalled();
    expect(b.campaigns.update).toHaveBeenCalledWith({ status: 'active' });
  });

  it('does not depend on the guest-list filler being available', async () => {
    const b = wire();
    vi.mocked(fillAuthorizedSet).mockRejectedValue(
      new Error('Guest-list filler unavailable'),
    );

    await expect(activateCampaign('c1')).resolves.toBeUndefined();

    expect(fillAuthorizedSet).not.toHaveBeenCalled();
    expect(b.campaigns.update).toHaveBeenCalledWith({ status: 'active' });
  });

  it('a console revival (paused → active) of a package campaign needs the same payment', async () => {
    const b = wire();
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'refunded', collected: 0, credit: 0, committed: 0 });
    await expect(activateCampaign('c1', { kind: 'console', staffUserId: 's1' })).rejects.toThrow(PACKAGE_NOT_PAID_ERROR);
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });
});

describe('activateCampaign — a campaign without a package', () => {
  it('cannot be started: it has no package payment, and nothing is read or written', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.mocked(getPackagePaymentState).mockReset();
    const b = adminByTable({ campaigns: { id: 'c1', event_id: 'e1', package_price: null }, events: { event_date: '2999-01-01T00:00:00+00:00', status: 'active' } });
    await expect(activateCampaign('c1')).rejects.toThrow(NO_PACKAGE_ERROR);
    expect(getPackagePaymentState).not.toHaveBeenCalled();
    expect(b.campaigns.update).not.toHaveBeenCalled();
  });
});

describe('getCampaignStageForEvent — a package campaign is funded by its payment', () => {
  it('reads the ledger for a package campaign: paid + approved is "awaiting activation"', async () => {
    const { packagePaymentOf } = await import('@/lib/payments/package-paid');
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
    const server = createMockSupabase<unknown>({ data: { id: 'c1', status: 'approved', package_price: 150 }, error: null });
    server.client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createClient).mockResolvedValue(server.client as never);
    vi.mocked(packagePaymentOf).mockResolvedValue({ status: 'collected', collected: 150, credit: 0, committed: 0 });
    expect(await getCampaignStageForEvent('e1')).toBe('awaiting_activation');
    expect(packagePaymentOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', package_price: 150 }));
  });

  it('an unpaid package campaign is still "awaiting payment"', async () => {
    const { packagePaymentOf } = await import('@/lib/payments/package-paid');
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
    const server = createMockSupabase<unknown>({ data: { id: 'c1', status: 'approved', package_price: 150 }, error: null });
    server.client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createClient).mockResolvedValue(server.client as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(null);
    expect(await getCampaignStageForEvent('e1')).toBe('awaiting_payment');
  });
});

describe('approveCampaign update result', () => {
  it.each([
    {
      label: 'zero updated rows',
      error: null,
      message: 'מצב הקמפיין השתנה. יש לרענן ולבדוק את האישור',
    },
    {
      label: 'database error',
      error: { message: 'DB failure' },
      message: 'אישור הקמפיין נכשל',
    },
  ])('rejects on $label', async ({ error, message }) => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());

    const result: QueryResult<Record<string, unknown>> = {
      data: {
        id: 'c1',
        event_id: 'e1',
        status: 'pending_approval',
        package_price: 150,
      },
      error: null,
    };

    const { builder } = adminWith(result);

    builder.update.mockImplementation(() => {
      result.data = null;
      result.error = error;
      return builder;
    });

    await expect(
      approveCampaign('c1', '2026-10-v6'),
    ).rejects.toThrow(message);

    expect(builder.select).toHaveBeenCalledWith('id');
  });
});
