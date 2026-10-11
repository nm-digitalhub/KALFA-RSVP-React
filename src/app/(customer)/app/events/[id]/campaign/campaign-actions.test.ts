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
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it
// (same as guests-actions.test.ts) so the happy path is observable.
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'UA/1' })),
  cookies: vi.fn().mockResolvedValue({ set: vi.fn() }),
}));
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
  // The fixed-price package catalogue: EMPTY by default (the production default — the package switch is off).
  listPackageOffers: vi.fn().mockResolvedValue([]),
  activateCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  closeCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  getCampaignRef: vi.fn(),
}));
vi.mock('@/lib/data/agreements', () => ({ recordPackageApproval: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { publishEvent, closeEvent, requireOwnedEvent, getEvent } from '@/lib/data/events';
import { syncEventToExchange, markEventExchangeCancelled } from '@/lib/data/event-exchange-sync';
import { cancelCampaign, createCampaign, listPackageOffers } from '@/lib/data/campaigns';
import { redirect } from 'next/navigation';
import { recordPackageApproval } from '@/lib/data/agreements';
import { logActivity } from '@/lib/data/activity';
import {
  setupCampaignAction,
  choosePackageAction,
  approvePackageTermsAction,
  closeEventAction,
  cancelCampaignAction,
} from './campaign-actions';

// Real notFound() digest format (verified against node_modules/next/dist/client/
// components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404', not the literal
// string 'NEXT_NOT_FOUND'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

beforeEach(() => vi.clearAllMocks());

describe('closeEventAction', () => {
  it('calls closeEvent and returns a notice on success', async () => {
    vi.mocked(closeEvent).mockResolvedValue(undefined);

    const result = await closeEventAction('e1', null, new FormData());

    expect(closeEvent).toHaveBeenCalledWith('e1');
    expect(result?.notice).toBeDefined();
  });

  it('marks the synced Exchange appointment(s) cancelled after a successful close', async () => {
    vi.mocked(closeEvent).mockResolvedValue(undefined);

    await closeEventAction('e1', null, new FormData());

    expect(markEventExchangeCancelled).toHaveBeenCalledWith('e1');
  });

  it('does not mark Exchange cancelled when closeEvent fails', async () => {
    vi.mocked(closeEvent).mockRejectedValue(
      new Error('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע'),
    );

    await closeEventAction('e1', null, new FormData());

    expect(markEventExchangeCancelled).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal (the ownership gate) instead of swallowing it', async () => {
    vi.mocked(closeEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(closeEventAction('e1', null, new FormData())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('surfaces the R7 blocking-campaign message', async () => {
    vi.mocked(closeEvent).mockRejectedValue(
      new Error('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע'),
    );

    const result = await closeEventAction('e1', null, new FormData());

    expect(result?.error).toBe('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע');
  });
});

describe('cancelCampaignAction', () => {
  it('calls cancelCampaign with the campaign id and returns a notice on success', async () => {
    vi.mocked(cancelCampaign).mockResolvedValue(undefined);

    const result = await cancelCampaignAction('e1', 'c1', null, new FormData());

    expect(cancelCampaign).toHaveBeenCalledWith('c1');
    expect(result?.notice).toBeDefined();
  });

  it('re-throws a Next.js control-flow signal (the ownership gate) instead of swallowing it', async () => {
    vi.mocked(cancelCampaign).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      cancelCampaignAction('e1', 'c1', null, new FormData()),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('surfaces the not-cancellable message', async () => {
    vi.mocked(cancelCampaign).mockRejectedValue(new Error('לא ניתן לבטל קמפיין זה'));

    const result = await cancelCampaignAction('e1', 'c1', null, new FormData());

    expect(result?.error).toBe('לא ניתן לבטל קמפיין זה');
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

    await expect(setupCampaignAction('e1', null, acked())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).toHaveBeenCalledWith('e1');
    expect(syncEventToExchange).toHaveBeenCalledWith('e1');
    // The campaign is created by the package choice, in the next step.
    expect(createCampaign).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/app/events/e1/setup');
  });

  it('records the acknowledgments on the activity log, without the wording or any personal data', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c1' });

    await expect(setupCampaignAction('e1', null, acked())).rejects.toThrow('NEXT_REDIRECT');

    expect(logActivity).toHaveBeenCalledWith({
      eventId: 'e1',
      action: 'event.setup_confirmed',
      meta: { acknowledged: ['ack_datetime', 'ack_venue', 'ack_lock'], event_date: '2999-01-01T16:00:00Z' },
    });
  });

  it.each(['ack_datetime', 'ack_venue', 'ack_lock'])(
    'a DRAFT event is NOT confirmed when %s is missing (enforced on the server)',
    async (missing) => {
      vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);

      const result = await setupCampaignAction('e1', null, acked(missing));

      expect(result?.error).toBe('יש לאשר את כל הסעיפים כדי להמשיך.');
      expect(publishEvent).not.toHaveBeenCalled();
      expect(createCampaign).not.toHaveBeenCalled();
      expect(logActivity).not.toHaveBeenCalled();
    },
  );

  it('a DRAFT event with something still missing is NOT confirmed, and the owner is told what', async () => {
    const incomplete = { ...e1, venue_address: null, event_date: '2999-01-01T00:00:00+00:00' };
    vi.mocked(requireOwnedEvent).mockResolvedValue(incomplete as never);
    vi.mocked(getEvent).mockResolvedValue(incomplete as never);

    const result = await setupCampaignAction('e1', null, acked());

    expect(result?.error).toBe('יש להשלים לפני האישור: שעת האירוע, כתובת המקום');
    expect(publishEvent).not.toHaveBeenCalled();
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('on an already-confirmed (active) event: skips publish and redirects to the package choice', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...e1, status: 'active' } as never);

    await expect(setupCampaignAction('e1', null, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).not.toHaveBeenCalled();
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("surfaces the data layer's Hebrew message when confirming fails, and never creates a campaign", async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(getEvent).mockResolvedValue(e1 as never);
    vi.mocked(publishEvent).mockRejectedValue(
      new Error('יש להגדיר מועד עתידי לפני אישור פרטי האירוע'),
    );

    const result = await setupCampaignAction('e1', null, acked());

    expect(result?.error).toBe('יש להגדיר מועד עתידי לפני אישור פרטי האירוע');
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal from the ownership gate', async () => {
    vi.mocked(requireOwnedEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(setupCampaignAction('e1', null, new FormData())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

// The owner CHOOSES the package and that choice creates the campaign (so its price and quota are the ones chosen).
// Earlier suites leave rejected/resolved implementations behind (clearAllMocks keeps them), so these start clean.
function resetPackageMocks() {
  vi.mocked(createCampaign).mockReset();
  vi.mocked(listPackageOffers).mockReset();
  vi.mocked(listPackageOffers).mockResolvedValue([]);
  vi.mocked(logActivity).mockReset();
}

describe('choosePackageAction — the owner picks a fixed-price package', () => {
  beforeEach(resetPackageMocks);
  const PKG = '11111111-1111-4111-8111-111111111111';
  const form = (package_id?: string) => {
    const fd = new FormData();
    if (package_id !== undefined) fd.set('package_id', package_id);
    return fd;
  };

  it('creates the campaign from THAT package, records the choice, and returns to the setup flow', async () => {
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c-new' });

    await expect(choosePackageAction('e1', null, form(PKG))).rejects.toThrow('NEXT_REDIRECT');

    expect(createCampaign).toHaveBeenCalledWith('e1', PKG);
    expect(logActivity).toHaveBeenCalledWith({
      eventId: 'e1',
      action: 'campaign.package_chosen',
      meta: { campaignId: 'c-new', packageId: PKG },
    });
    expect(redirect).toHaveBeenCalledWith('/app/events/e1/setup');
  });

  it.each([undefined, '', 'not-a-uuid', '1; drop table packages'])(
    'refuses the choice %j before touching anything',
    async (value) => {
      const result = await choosePackageAction('e1', null, form(value));

      expect(result).toEqual({ error: 'יש לבחור חבילה' });
      expect(createCampaign).not.toHaveBeenCalled();
    },
  );

  it('shows the data layer\'s own safe message when the package is unavailable', async () => {
    vi.mocked(createCampaign).mockRejectedValue(new Error('החבילה שנבחרה אינה זמינה'));

    const result = await choosePackageAction('e1', null, form(PKG));

    expect(result).toEqual({ error: 'החבילה שנבחרה אינה זמינה' });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal (a failed ownership gate) instead of swallowing it', async () => {
    vi.mocked(createCampaign).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' }),
    );

    await expect(choosePackageAction('e1', null, form(PKG))).rejects.toThrow('NEXT_REDIRECT');
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
    await expect(approvePackageTermsAction('e1', CAMPAIGN, null, form())).rejects.toThrow('NEXT_REDIRECT');

    expect(recordPackageApproval).toHaveBeenCalledWith({
      campaignId: CAMPAIGN,
      termsVersion: '2026-10-v6',
      ip: '203.0.113.5',
      userAgent: 'UA/1',
    });
    expect(redirect).toHaveBeenCalledWith(`/app/events/e1/campaign/${CAMPAIGN}/payment`);
  });

  it.each([
    ['the terms box', { terms_accepted: null }, 'terms_accepted'],
    ['the privacy box', { privacy_accepted: null }, 'privacy_accepted'],
  ])('both boxes are required — without %s nothing is recorded', async (_label, over, field) => {
    const result = await approvePackageTermsAction('e1', CAMPAIGN, null, form(over));
    expect(result?.fieldErrors?.[field]).toBeDefined();
    expect(recordPackageApproval).not.toHaveBeenCalled();
  });

  it('refuses a form that does not say which version it showed', async () => {
    const result = await approvePackageTermsAction('e1', CAMPAIGN, null, form({ terms_version: null }));
    expect(result?.fieldErrors?.tos_version).toBeDefined();
    expect(recordPackageApproval).not.toHaveBeenCalled();
  });

  it('shows the data layer\'s own safe message when the approval is refused', async () => {
    vi.mocked(recordPackageApproval).mockResolvedValue({ ok: false, error: 'נוסח התנאים עודכן. קראו שוב ואשרו.' });
    expect(await approvePackageTermsAction('e1', CAMPAIGN, null, form())).toEqual({
      error: 'נוסח התנאים עודכן. קראו שוב ואשרו.',
    });
  });

  it('an unexpected failure is a generic Hebrew message, never the raw error', async () => {
    vi.mocked(recordPackageApproval).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5'));
    expect(await approvePackageTermsAction('e1', CAMPAIGN, null, form())).toEqual({
      error: 'שמירת האישור נכשלה. נסו שוב.',
    });
  });

  it('re-throws a Next.js control-flow signal (a failed ownership gate) instead of swallowing it', async () => {
    vi.mocked(recordPackageApproval).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app;307;' }),
    );
    await expect(approvePackageTermsAction('e1', CAMPAIGN, null, form())).rejects.toThrow('NEXT_REDIRECT');
  });
});
