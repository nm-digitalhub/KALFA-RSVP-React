import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring tests for the campaign and event actions. The
// ownership/authorization contract lives in the data layer (events.ts /
// campaigns.ts); these tests only verify the thin action wrapper: calls the
// right data-layer function, re-throws Next.js control-flow signals, and
// surfaces the data layer's own Hebrew error message.

// campaign-actions.ts pulls in a wide import graph (signing/agreements/OTP);
// mock the whole surface so the module loads, matching the established
// guests-actions.test.ts pattern (the guests/ directory's precedent for action tests).
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// x-real-ip is what nginx sets from the socket; the x-forwarded-for value is a different, forged address so a
// test that sees 203.0.113.5 proves the forged chain was not used. A test may swap `requestHeaders.current`.
const requestHeaders = vi.hoisted(() => ({
  current: new Headers({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.66, 10.0.0.1', 'user-agent': 'UA/1' }),
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => requestHeaders.current),
  cookies: vi.fn().mockResolvedValue({ set: vi.fn() }),
}));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it
// (same as guests-actions.test.ts) so the happy path is observable.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/x;307;',
      });
    }),
  };
});
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({
  requireOwnedEvent: vi.fn(),
  getEvent: vi.fn(),
  publishEvent: vi.fn(),
  closeEvent: vi.fn(),
}));
vi.mock('@/lib/data/event-exchange-sync', () => ({
  syncEventToExchange: vi.fn(),
  markEventExchangeCancelled: vi.fn(),
}));
vi.mock('@/lib/data/campaigns', () => ({
  createCampaign: vi.fn(),
  // Task 5.3: choosePackageAction dispatches to the package CHANGE when a pending campaign exists.
  changeCampaignPackage: vi.fn(),
  getCampaignForEvent: vi.fn(),
  // Task 5.5: the acceptance flow.
  acceptCampaignBenefit: vi.fn(),
  // The fixed-price package catalogue: EMPTY by default (the production default — the package switch is off).
  listPackageOffers: vi.fn().mockResolvedValue([]),
  pauseCampaign: vi.fn(),
  closeCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  getCampaignRef: vi.fn(),
  updateThankyouSchedule: vi.fn(),
}));
vi.mock('@/lib/data/agreements', () => ({ recordPackageApproval: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/outreach', () => ({ sendCampaignWhatsApp: vi.fn() }));
vi.mock('@/lib/data/admin/events', () => ({ rescheduleEventForAdmin: vi.fn() }));

import { publishEvent, closeEvent, requireOwnedEvent, getEvent } from '@/lib/data/events';
import { syncEventToExchange, markEventExchangeCancelled } from '@/lib/data/event-exchange-sync';
import {
  cancelCampaign,
  createCampaign,
  changeCampaignPackage,
  acceptCampaignBenefit,
  getCampaignForEvent,
  getCampaignRef,
  listPackageOffers,
  pauseCampaign,
  updateThankyouSchedule,
} from '@/lib/data/campaigns';
import { redirect } from 'next/navigation';
import { recordPackageApproval } from '@/lib/data/agreements';
import { logActivity } from '@/lib/data/activity';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import { rescheduleEventForAdmin } from '@/lib/data/admin/events';
import {
  setupCampaignAction,
  choosePackageAction,
  acceptBenefitAction,
  approvePackageTermsAction,
  closeEventAction,
  cancelCampaignAction,
  pauseCampaignAction,
  sendGiftReminderAction,
  updateThankyouScheduleAction,
  rescheduleEventAction,
} from './campaign-actions';

// Real notFound() digest format (verified against node_modules/next/dist/client/
// components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404', not the literal
// string 'NEXT_NOT_FOUND'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

// The bound ids are validated (bindArgsSchemas: z.uuid()).
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => vi.clearAllMocks());

describe('closeEventAction', () => {
  it('calls closeEvent and lands on the event page on success (also from inside setup)', async () => {
    vi.mocked(closeEvent).mockResolvedValue(undefined);

    await expect(closeEventAction(EVENT_ID, {}, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(closeEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}`);
  });

  it('marks the synced Exchange appointment(s) cancelled after a successful close', async () => {
    vi.mocked(closeEvent).mockResolvedValue(undefined);

    await expect(closeEventAction(EVENT_ID, {}, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(markEventExchangeCancelled).toHaveBeenCalledWith(EVENT_ID);
  });

  it('returns the data layer message and does not mark Exchange cancelled when closeEvent fails', async () => {
    vi.mocked(closeEvent).mockRejectedValue(new Error('יש תשלום שעדיין בטיפול'));

    const result = await closeEventAction(EVENT_ID, {}, new FormData());

    expect(result.serverError).toBe('יש תשלום שעדיין בטיפול');
    expect(markEventExchangeCancelled).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal (the ownership gate) instead of swallowing it', async () => {
    vi.mocked(closeEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(closeEventAction(EVENT_ID, {}, new FormData())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('surfaces the R7 blocking-campaign message', async () => {
    vi.mocked(closeEvent).mockRejectedValue(
      new Error('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע'),
    );

    const result = await closeEventAction(EVENT_ID, {}, new FormData());

    expect(result.serverError).toBe('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע');
  });
});

describe('cancelCampaignAction', () => {
  it('calls cancelCampaign with the campaign id and returns a notice on success', async () => {
    vi.mocked(cancelCampaign).mockResolvedValue(undefined);

    const result = await cancelCampaignAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData());

    expect(cancelCampaign).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(result.data?.notice).toBeDefined();
  });

  it('re-throws a Next.js control-flow signal (the ownership gate) instead of swallowing it', async () => {
    vi.mocked(cancelCampaign).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      cancelCampaignAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData()),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('surfaces the not-cancellable message', async () => {
    vi.mocked(cancelCampaign).mockRejectedValue(new Error('לא ניתן לבטל קמפיין זה'));

    const result = await cancelCampaignAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData());

    expect(result.serverError).toBe('לא ניתן לבטל קמפיין זה');
  });
});

describe('setupCampaignAction — "אישור פרטי האירוע והמשך" (audit §2)', () => {
  const e1 = {
    id: 'e1',
    name: 'x',
    status: 'draft',
    event_type: 'wedding',
    event_date: '2999-01-01T16:00:00Z',
    rsvp_deadline: null,
    venue_name: 'אולם',
    venue_address: 'הרצל 1, תל אביב',
    celebrants: { groom: 'דני', bride: 'דנה' },
  } as const;

  // The three acknowledgments the confirm step shows, as a browser posts them.
  const acked = (skip?: string) => {
    const fd = new FormData();
    for (const k of ['ack_datetime', 'ack_venue', 'ack_lock']) if (k !== skip) fd.set(k, 'on');
    return fd;
  };

  it('on a DRAFT event: confirms (publishEvent), syncs Exchange, creates no campaign, returns to the setup flow', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);
    vi.mocked(publishEvent).mockResolvedValue(undefined);

    await expect(setupCampaignAction(EVENT_ID, {}, acked())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(syncEventToExchange).toHaveBeenCalledWith(EVENT_ID);
    // The campaign is created by the package choice, in the next step.
    expect(createCampaign).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}/setup`);
  });

  it('records the acknowledgments on the activity log, without the wording or any personal data', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c1' });

    await expect(setupCampaignAction(EVENT_ID, {}, acked())).rejects.toThrow('NEXT_REDIRECT');

    expect(logActivity).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      action: 'event.setup_confirmed',
      meta: { acknowledged: ['ack_datetime', 'ack_venue', 'ack_lock'], event_date: '2999-01-01T16:00:00Z' },
    });
  });

  it.each(['ack_datetime', 'ack_venue', 'ack_lock'])(
    'a DRAFT event is NOT confirmed when %s is missing (enforced on the server)',
    async (missing) => {
      vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);

      const result = await setupCampaignAction(EVENT_ID, {}, acked(missing));

      expect(result.serverError).toBe('יש לאשר את כל הסעיפים כדי להמשיך.');
      expect(publishEvent).not.toHaveBeenCalled();
      expect(createCampaign).not.toHaveBeenCalled();
      expect(logActivity).not.toHaveBeenCalled();
    },
  );

  it('a DRAFT event with something still missing is NOT confirmed, and the owner is told what', async () => {
    const incomplete = { ...e1, venue_address: null, event_date: '2999-01-01T00:00:00+00:00' };
    vi.mocked(requireOwnedEvent).mockResolvedValue(incomplete as never);
    vi.mocked(getEvent).mockResolvedValue(incomplete as never);

    const result = await setupCampaignAction(EVENT_ID, {}, acked());

    expect(result.serverError).toBe('יש להשלים לפני האישור: שעת האירוע, כתובת המקום');
    expect(publishEvent).not.toHaveBeenCalled();
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('on an already-confirmed (active) event: skips publish and redirects to the package choice', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...e1, status: 'active' } as never);

    await expect(setupCampaignAction(EVENT_ID, {}, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).not.toHaveBeenCalled();
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("surfaces the data layer's Hebrew message when confirming fails, and never creates a campaign", async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);
    vi.mocked(publishEvent).mockRejectedValue(
      new Error('יש להגדיר מועד עתידי לפני אישור פרטי האירוע'),
    );

    const result = await setupCampaignAction(EVENT_ID, {}, acked());

    expect(result.serverError).toBe('יש להגדיר מועד עתידי לפני אישור פרטי האירוע');
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal from the ownership gate', async () => {
    vi.mocked(requireOwnedEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(setupCampaignAction(EVENT_ID, {}, new FormData())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

// The owner CHOOSES the package and that choice creates the campaign (so its price and quota are the ones chosen).
// Earlier suites leave rejected/resolved implementations behind (clearAllMocks keeps them), so these start clean.
function resetPackageMocks() {
  vi.mocked(createCampaign).mockReset();
  vi.mocked(changeCampaignPackage).mockReset();
  vi.mocked(getCampaignForEvent).mockReset();
  vi.mocked(listPackageOffers).mockReset();
  vi.mocked(listPackageOffers).mockResolvedValue([]);
  vi.mocked(logActivity).mockReset();
}

describe('choosePackageAction — the owner picks a fixed-price package', () => {
  beforeEach(resetPackageMocks);
  const PKG = '11111111-1111-4111-8111-111111111111';
  // The bound event id is validated (bindArgsSchemas: z.uuid()).
  const EVENT = '22222222-2222-4222-8222-222222222222';
  const form = (package_id?: string) => {
    const fd = new FormData();
    if (package_id !== undefined) fd.set('package_id', package_id);
    return fd;
  };

  it('creates the campaign from THAT package, records the choice, and returns to the setup flow', async () => {
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c-new' });

    await expect(choosePackageAction(EVENT, {}, form(PKG))).rejects.toThrow('NEXT_REDIRECT');

    expect(createCampaign).toHaveBeenCalledWith(EVENT, PKG);
    expect(logActivity).toHaveBeenCalledWith({
      eventId: EVENT,
      action: 'campaign.package_chosen',
      meta: { campaignId: 'c-new', packageId: PKG },
    });
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT}/setup`);
  });

  it.each([undefined, '', 'not-a-uuid', '1; drop table packages'])(
    'refuses the choice %j before touching anything',
    async (value) => {
      const result = await choosePackageAction(EVENT, {}, form(value));

      expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { package_id: ['יש לבחור חבילה'] } } });
      expect(createCampaign).not.toHaveBeenCalled();
    },
  );

  it('a PENDING campaign routes to the package CHANGE (task 5.3) — never a second campaign', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c-old', status: 'pending_approval' } as never);
    vi.mocked(changeCampaignPackage).mockResolvedValue({ id: 'c-old', changed: true });

    await expect(choosePackageAction(EVENT, {}, form(PKG))).rejects.toThrow('NEXT_REDIRECT');

    expect(changeCampaignPackage).toHaveBeenCalledWith(EVENT, PKG);
    expect(createCampaign).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'campaign.package_chosen',
        meta: expect.objectContaining({ changedExisting: true }),
      }),
    );
  });

  it('an APPROVED campaign keeps the create-or-continue contract — no silent price change past approval', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c-old', status: 'approved' } as never);
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c-old' });

    await expect(choosePackageAction(EVENT, {}, form(PKG))).rejects.toThrow('NEXT_REDIRECT');

    expect(changeCampaignPackage).not.toHaveBeenCalled();
    expect(createCampaign).toHaveBeenCalledWith(EVENT, PKG);
  });

  it("an unchanged package ('unchanged') records nothing", async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c-old', status: 'pending_approval' } as never);
    vi.mocked(changeCampaignPackage).mockResolvedValue({ id: 'c-old', changed: false });

    await expect(choosePackageAction(EVENT, {}, form(PKG))).rejects.toThrow('NEXT_REDIRECT');

    expect(logActivity).not.toHaveBeenCalled();
  });

  it('shows the data layer\'s own safe message when the package is unavailable', async () => {
    vi.mocked(createCampaign).mockRejectedValue(new Error('החבילה שנבחרה אינה זמינה'));

    const result = await choosePackageAction(EVENT, {}, form(PKG));

    expect(result).toEqual({ serverError: 'החבילה שנבחרה אינה זמינה' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal (a failed ownership gate) instead of swallowing it', async () => {
    vi.mocked(createCampaign).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' }),
    );

    await expect(choosePackageAction(EVENT, {}, form(PKG))).rejects.toThrow('NEXT_REDIRECT');
  });
});

// The fixed-price package is approved by ticking two boxes (the terms, the privacy policy) — no signature, no phone
// code. The browser sends which version it showed; the server compares it with the approved package document before approving.
describe('approvePackageTermsAction — the customer approves the package terms', () => {
  const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
  const form = (over: Record<string, string | null> = {}) => {
    const fd = new FormData();
    const base: Record<string, string | null> = {
      terms_accepted: 'on',
      privacy_accepted: 'on',
      terms_version: '2026-10-v6',
      ...over,
    };
    for (const [k, v] of Object.entries(base)) if (v !== null) fd.set(k, v);
    return fd;
  };
  beforeEach(() => {
    vi.mocked(recordPackageApproval).mockReset();
    vi.mocked(recordPackageApproval).mockResolvedValue({ ok: true });
  });

  it('records the approval with the version shown, the caller\'s address and browser — then goes straight to the payment page', async () => {
    await expect(approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form())).rejects.toThrow('NEXT_REDIRECT');

    expect(recordPackageApproval).toHaveBeenCalledWith({
      campaignId: CAMPAIGN,
      termsVersion: '2026-10-v6',
      ip: '203.0.113.5',
      userAgent: 'UA/1',
    });
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}/campaign/${CAMPAIGN}/payment`);
  });

  it('a forged x-forwarded-for never reaches the agreement — without x-real-ip the address is unknown', async () => {
    const socketHeaders = requestHeaders.current;
    requestHeaders.current = new Headers({ 'x-forwarded-for': '198.51.100.66, 10.0.0.1', 'user-agent': 'UA/1' });
    try {
      await expect(approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form())).rejects.toThrow('NEXT_REDIRECT');
      expect(recordPackageApproval).toHaveBeenCalledWith(expect.objectContaining({ ip: null }));
    } finally {
      requestHeaders.current = socketHeaders;
    }
  });

  it.each([
    ['the terms box', { terms_accepted: null }, 'terms_accepted'],
    ['the privacy box', { privacy_accepted: null }, 'privacy_accepted'],
  ])('both boxes are required — without %s nothing is recorded', async (_label, over, field) => {
    const result = await approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form(over));
    const fieldErrors: Partial<Record<string, string[]>> | undefined = result.validationErrors?.fieldErrors;
    expect(fieldErrors?.[field]).toBeDefined();
    expect(recordPackageApproval).not.toHaveBeenCalled();
  });

  it('refuses a form that does not say which version it showed', async () => {
    const result = await approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form({ terms_version: null }));
    expect(result.validationErrors?.fieldErrors?.tos_version).toBeDefined();
    expect(recordPackageApproval).not.toHaveBeenCalled();
  });

  it('answers with the schema\'s Hebrew messages, under the keys the form shows them', async () => {
    const result = await approvePackageTermsAction(
      EVENT_ID,
      CAMPAIGN,
      {},
      form({ terms_version: '', terms_accepted: null, privacy_accepted: null }),
    );
    expect(result.validationErrors?.fieldErrors).toEqual({
      tos_version: ['גרסת תנאי שירות חסרה'],
      terms_accepted: ['יש לאשר את התקנון'],
      privacy_accepted: ['יש לאשר את מדיניות הפרטיות'],
    });
    expect(recordPackageApproval).not.toHaveBeenCalled();
  });

  it('shows the data layer\'s own safe message when the approval is refused', async () => {
    vi.mocked(recordPackageApproval).mockResolvedValue({ ok: false, error: 'נוסח התנאים עודכן. קראו שוב ואשרו.' });
    expect(await approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form())).toEqual({
      serverError: 'נוסח התנאים עודכן. קראו שוב ואשרו.',
    });
  });

  it('an unexpected failure is a generic Hebrew message, never the raw error', async () => {
    vi.mocked(recordPackageApproval).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5'));
    expect(await approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form())).toEqual({
      serverError: 'שמירת האישור נכשלה. נסו שוב.',
    });
  });

  it('re-throws a Next.js control-flow signal (a failed ownership gate) instead of swallowing it', async () => {
    vi.mocked(recordPackageApproval).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' }),
    );
    await expect(approvePackageTermsAction(EVENT_ID, CAMPAIGN, {}, form())).rejects.toThrow('NEXT_REDIRECT');
  });
});

// ש5/D21 (task 5.5): accepting the waiting benefit supersedes the approved price and routes back
// to the approval step; ignoring it leaves the approved price payable (nothing here runs then).
describe('acceptBenefitAction — the "יש לך הטבה" banner', () => {
  it('accepts and routes straight back to the setup flow (the new terms await approval)', async () => {
    vi.mocked(acceptCampaignBenefit).mockResolvedValue('accepted');

    await expect(acceptBenefitAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(acceptCampaignBenefit).toHaveBeenCalledWith(EVENT_ID, CAMPAIGN_ID);
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}/setup`);
  });

  it("'none' (expired or gone) answers a safe message and routes nowhere", async () => {
    vi.mocked(acceptCampaignBenefit).mockResolvedValue('none');

    const result = await acceptBenefitAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData());

    expect(result).toEqual({ serverError: 'לא נמצאה הטבה זמינה לקבלת ההנחה. ייתכן שפג תוקפה.' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("surfaces the data layer's own safe message", async () => {
    vi.mocked(acceptCampaignBenefit).mockRejectedValue(
      new Error('ההטבה מתקבלת רק אחרי אישור תנאים וכשטרם שולם'),
    );

    const result = await acceptBenefitAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData());

    expect(result).toEqual({ serverError: 'ההטבה מתקבלת רק אחרי אישור תנאים וכשטרם שולם' });
  });
});

describe('pauseCampaignAction', () => {
  it('a failed transition is its own fixed message', async () => {
    vi.mocked(pauseCampaign).mockRejectedValue(new Error('permission denied'));

    expect(await pauseCampaignAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).toEqual({
      serverError: 'השהיית הקמפיין נכשלה.',
    });
  });
});

describe('sendGiftReminderAction', () => {
  // Earlier suites leave rejected implementations behind (clearAllMocks keeps them).
  beforeEach(() => {
    vi.mocked(requireOwnedEvent).mockReset();
    vi.mocked(getCampaignRef).mockReset();
    vi.mocked(sendCampaignWhatsApp).mockReset();
  });

  it("a campaign of another event is 'not found', not a failed send, and nothing is sent", async () => {
    vi.mocked(getCampaignRef).mockResolvedValue({ event_id: '44444444-4444-4444-8444-444444444444' } as never);

    expect(await sendGiftReminderAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).toEqual({
      serverError: 'השירות לא נמצא.',
    });
    expect(sendCampaignWhatsApp).not.toHaveBeenCalled();
  });

  it('a failure on the way is its own fixed message', async () => {
    vi.mocked(getCampaignRef).mockResolvedValue({ event_id: EVENT_ID } as never);
    vi.mocked(sendCampaignWhatsApp).mockRejectedValue(new Error('timeout'));

    expect(await sendGiftReminderAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).toEqual({
      serverError: 'שליחת תזכורת המתנה נכשלה.',
    });
  });

  it('nothing sent says what to check; a send says how many', async () => {
    vi.mocked(getCampaignRef).mockResolvedValue({ event_id: EVENT_ID } as never);
    vi.mocked(sendCampaignWhatsApp).mockResolvedValueOnce({ sent: 0, skipped: 2, blocked: false });

    expect(await sendGiftReminderAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).toEqual({
      serverError:
        'לא נשלחו תזכורות — ודאו שקישור המתנה מולא באירוע, שהשירות פעיל ושתבנית המתנה מאושרת ופעילה.',
    });

    vi.mocked(sendCampaignWhatsApp).mockResolvedValueOnce({ sent: 3, skipped: 1, blocked: false });

    expect(await sendGiftReminderAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData())).toEqual({
      data: { notice: 'נשלחו 3 תזכורות מתנה (1 דולגו).' },
    });
    expect(sendCampaignWhatsApp).toHaveBeenCalledWith(CAMPAIGN_ID, 'gift');
  });
});

describe('updateThankyouScheduleAction', () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  it('a date without a time is refused with the schema\'s message, and nothing is saved', async () => {
    const result = await updateThankyouScheduleAction(
      EVENT_ID,
      CAMPAIGN_ID,
      {},
      form({ send_date: '2999-01-02', send_time: '' }),
    );

    expect(result.validationErrors?.fieldErrors).toEqual({
      send_date: ['יש למלא גם תאריך וגם שעה, או להשאיר את שניהם ריקים'],
    });
    expect(updateThankyouSchedule).not.toHaveBeenCalled();
  });

  it('the checkbox is its presence; both fields empty clears the schedule', async () => {
    const result = await updateThankyouScheduleAction(
      EVENT_ID,
      CAMPAIGN_ID,
      {},
      form({ auto_enabled: 'on', send_date: '', send_time: '' }),
    );

    expect(updateThankyouSchedule).toHaveBeenCalledWith(CAMPAIGN_ID, { autoEnabled: true, sendAt: null });
    expect(result).toEqual({ data: { notice: 'לוח הזמנים לתודה עודכן' } });
  });
});

describe('rescheduleEventAction — staff move a live event', () => {
  beforeEach(() => vi.mocked(rescheduleEventForAdmin).mockReset());

  it("reads the form's own fields into the schema's keys, with the schema's Hebrew messages", async () => {
    const result = await rescheduleEventAction(EVENT_ID, CAMPAIGN_ID, {}, new FormData());

    expect(result.validationErrors?.fieldErrors).toEqual({
      event_date: ['יש לבחור תאריך'],
      event_time: ['יש לבחור שעה'],
      reason: ['יש לפרט את הסיבה לשינוי המועד (10 תווים לפחות)'],
    });
    expect(rescheduleEventForAdmin).not.toHaveBeenCalled();
  });

  it('moves the date with the reason and says the billing window moved with it', async () => {
    vi.mocked(rescheduleEventForAdmin).mockResolvedValue({ deadlineClamped: false } as never);
    const fd = new FormData();
    fd.set('new_event_date', '2999-01-02');
    fd.set('new_event_time', '19:30');
    fd.set('reschedule_reason', 'האולם ביקש להזיז את האירוע');

    const result = await rescheduleEventAction(EVENT_ID, CAMPAIGN_ID, {}, fd);

    expect(rescheduleEventForAdmin).toHaveBeenCalledWith(EVENT_ID, expect.any(String), 'האולם ביקש להזיז את האירוע');
    expect(result).toEqual({ data: { notice: 'מועד האירוע עודכן, וחלון החיוב של הקמפיין עודכן איתו.' } });
  });
});
