import { beforeEach, describe, expect, it, vi } from 'vitest';

// S2.5a — wiring tests for the lifecycle actions (Publish/Close/Cancel). The
// ownership/authorization contract lives in the data layer (events.ts /
// campaigns.ts); these tests only verify the thin action wrapper: calls the
// right data-layer function, re-throws Next.js control-flow signals, and
// surfaces the data layer's own Hebrew error message.

// campaign-actions.ts pulls in a wide import graph (signing/agreements/OTP);
// mock the whole surface so the module loads, matching the established
// guests-actions.test.ts pattern (this directory's precedent for action tests).
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({
  requireOwnedEvent: vi.fn(),
  publishEvent: vi.fn(),
  closeEvent: vi.fn(),
}));
vi.mock('@/lib/data/campaigns', () => ({
  createCampaign: vi.fn(),
  activateCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  closeCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
  getCampaignForHold: vi.fn(),
}));
vi.mock('@/lib/data/close-charge', () => ({ closeCampaignAndCharge: vi.fn() }));
vi.mock('@/lib/data/agreements', () => ({ recordSignedAgreement: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/otp', () => ({ requestOtp: vi.fn() }));
vi.mock('@/lib/data/agreements-doc', () => ({ getActiveAgreementDoc: vi.fn() }));

import { publishEvent, closeEvent } from '@/lib/data/events';
import { cancelCampaign } from '@/lib/data/campaigns';
import {
  publishEventAction,
  closeEventAction,
  cancelCampaignAction,
} from './campaign-actions';

// Real notFound() digest format (verified against node_modules/next/dist/client/
// components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404', not the literal
// string 'NEXT_NOT_FOUND'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});
const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

beforeEach(() => vi.clearAllMocks());

describe('publishEventAction', () => {
  it('calls publishEvent and returns a notice on success', async () => {
    vi.mocked(publishEvent).mockResolvedValue(undefined);

    const result = await publishEventAction('e1', null, new FormData());

    expect(publishEvent).toHaveBeenCalledWith('e1');
    expect(result?.notice).toBeDefined();
  });

  it('surfaces the data layer\'s Hebrew error message', async () => {
    vi.mocked(publishEvent).mockRejectedValue(
      new Error('יש להגדיר מועד עתידי לפני פרסום'),
    );

    const result = await publishEventAction('e1', null, new FormData());

    expect(result?.error).toBe('יש להגדיר מועד עתידי לפני פרסום');
  });

  it('re-throws a Next.js control-flow signal instead of swallowing it', async () => {
    vi.mocked(publishEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(publishEventAction('e1', null, new FormData())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('re-throws a NEXT_REDIRECT (e.g. session expired) instead of returning { error }', async () => {
    vi.mocked(publishEvent).mockRejectedValue(NEXT_REDIRECT);

    await expect(publishEventAction('e1', null, new FormData())).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });
});

describe('closeEventAction', () => {
  it('calls closeEvent and returns a notice on success', async () => {
    vi.mocked(closeEvent).mockResolvedValue(undefined);

    const result = await closeEventAction('e1', null, new FormData());

    expect(closeEvent).toHaveBeenCalledWith('e1');
    expect(result?.notice).toBeDefined();
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
