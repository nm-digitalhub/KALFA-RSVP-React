import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin user actions: the gate lives in the data layer (requirePlatformPermission('manage_staff')), so these tests
// cover the wrapper — the fields reach the shared schemas as posted and keep their Hebrew messages, the data layer's own
// Hebrew refusals reach the admin, and the break-glass view returns the detail only on success.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/admin/users', () => ({
  setUserSuspended: vi.fn(),
  grantBillingCredit: vi.fn(),
  voidBillingCredit: vi.fn(),
  getUserDetail: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { actionErrorMessage } from '@/lib/action-result';
import { getUserDetail, grantBillingCredit, setUserSuspended, voidBillingCredit } from '@/lib/data/admin/users';

import {
  grantCreditAction,
  reactivateUserAction,
  suspendUserAction,
  viewUserDetailAction,
  voidCreditAction,
} from './actions';

const USER = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';
const EVENT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const CREDIT = '33333333-3333-4333-8333-333333333333';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('suspendUserAction / reactivateUserAction', () => {
  it('suspends, revalidates the users subtree and says so', async () => {
    const result = await suspendUserAction({}, fd({ user_id: USER }));

    expect(setUserSuspended).toHaveBeenCalledWith(USER, true);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/users', 'layout');
    expect(result).toEqual({ data: { notice: 'המשתמש הושהה' } });
  });

  it('reactivates', async () => {
    expect(await reactivateUserAction({}, fd({ user_id: USER }))).toEqual({ data: { notice: 'המשתמש שוחזר' } });
    expect(setUserSuspended).toHaveBeenCalledWith(USER, false);
  });

  it('refuses a malformed user id with the schema’s Hebrew message', async () => {
    const result = await suspendUserAction({}, fd({ user_id: 'x' }));

    expect(result.validationErrors?.fieldErrors?.user_id).toEqual(['מזהה משתמש לא תקין']);
    expect(setUserSuspended).not.toHaveBeenCalled();
  });

  it("shows the data layer's own refusal (no self-lockout)", async () => {
    vi.mocked(setUserSuspended).mockRejectedValue(new Error('לא ניתן להשהות את עצמך'));

    expect(await suspendUserAction({}, fd({ user_id: USER }))).toEqual({ serverError: 'לא ניתן להשהות את עצמך' });
  });
});

describe('grantCreditAction', () => {
  const FIELDS = { user_id: USER, event_id: EVENT, campaign_id: '', amount: '50', reason: 'פיצוי' };

  it('an empty campaign is an event-level credit', async () => {
    const result = await grantCreditAction({}, fd(FIELDS));

    expect(grantBillingCredit).toHaveBeenCalledWith({
      eventId: EVENT,
      campaignId: null,
      amount: 50,
      reason: 'פיצוי',
      ownerId: USER,
    });
    expect(result).toEqual({ data: { notice: 'ההטבה ניתנה' } });
  });

  it('a chosen campaign scopes the credit to it', async () => {
    await grantCreditAction({}, fd({ ...FIELDS, campaign_id: CAMPAIGN }));

    expect(grantBillingCredit).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN }));
  });

  it('an empty amount and an empty reason reach the schema and get its Hebrew messages', async () => {
    const result = await grantCreditAction({}, fd({ ...FIELDS, amount: '', reason: '' }));

    expect(result.validationErrors?.fieldErrors?.amount).toEqual(['הסכום חייב להיות חיובי']);
    expect(result.validationErrors?.fieldErrors?.reason).toEqual(['נא להזין סיבה']);
    expect(grantBillingCredit).not.toHaveBeenCalled();
  });
});

describe('viewUserDetailAction — the break-glass view', () => {
  it('returns the detail read with the reason', async () => {
    vi.mocked(getUserDetail).mockResolvedValue({ id: USER } as never);

    const result = await viewUserDetailAction({ user_id: USER, reason: 'בירור פנייה בנושא חיוב' });

    expect(getUserDetail).toHaveBeenCalledWith(USER, 'בירור פנייה בנושא חיוב');
    expect(result).toEqual({ data: { id: USER } });
  });

  it('refuses a short reason before any detail is read', async () => {
    const result = await viewUserDetailAction({ user_id: USER, reason: 'קצר' });

    expect(actionErrorMessage(result)).toBe('יש לציין סיבה לצפייה (לפחות 10 תווים)');
    expect(result.data).toBeUndefined();
    expect(getUserDetail).not.toHaveBeenCalled();
  });

  it('says so when the user does not exist', async () => {
    vi.mocked(getUserDetail).mockResolvedValue(null);

    expect(await viewUserDetailAction({ user_id: USER, reason: 'בירור פנייה בנושא חיוב' })).toEqual({
      serverError: 'המשתמש לא נמצא',
    });
  });
});

describe('voidCreditAction', () => {
  it('voids the credit and says so', async () => {
    const result = await voidCreditAction({ credit_id: CREDIT, user_id: USER, reason: 'טעות' });

    expect(voidBillingCredit).toHaveBeenCalledWith({ creditId: CREDIT, reason: 'טעות', ownerId: USER });
    expect(result).toEqual({ data: { notice: 'הזיכוי בוטל' } });
  });

  it('refuses a missing reason as a validation error', async () => {
    const result = await voidCreditAction({ credit_id: CREDIT, user_id: USER, reason: ' ' });

    expect(result.validationErrors?.fieldErrors?.reason).toEqual(['נא להזין סיבה לביטול']);
    expect(voidBillingCredit).not.toHaveBeenCalled();
  });

  it("shows the data layer's refusal of a consumed credit", async () => {
    vi.mocked(voidBillingCredit).mockRejectedValue(new Error('לא ניתן לבטל זיכוי שכבר נוצל'));

    expect(await voidCreditAction({ credit_id: CREDIT, user_id: USER, reason: 'טעות' })).toEqual({
      serverError: 'לא ניתן לבטל זיכוי שכבר נוצל',
    });
  });
});
