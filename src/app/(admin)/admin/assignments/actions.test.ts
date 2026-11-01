import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
// redirect() throws Next's control-flow signal; the digest is what next-safe-action recognises and re-throws.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((target: string) => {
    throw Object.assign(new Error(`REDIRECT:${target}`), { digest: `NEXT_REDIRECT;replace;${target};307;` });
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock('@/lib/data/admin/coupon-assignments', () => ({
  createStaffAssignment: vi.fn(),
  findAccountByEmail: vi.fn(),
  voidStaffAssignment: vi.fn(),
}));

import {
  createStaffAssignment,
  findAccountByEmail,
  voidStaffAssignment,
} from '@/lib/data/admin/coupon-assignments';
import { refresh } from 'next/cache';
import { actionErrorMessage } from '@/lib/action-result';
import { GENERIC_ACTION_ERROR } from '@/lib/safe-action';
import { createAssignmentAction, voidAssignmentAction } from './actions';

// The assign action (admin-panel ג.3, spec §8): every successful outcome navigates to the
// assignment the flow should SHOW — the kept one on a duplicate — with an honest notice,
// and the confirmed preview terms ride along for the server-side match.

const TERMS = JSON.stringify([
  { packageId: '11111111-1111-4111-8111-111111111111', listPrice: 100, discountAmount: 10, finalPrice: 90 },
]);

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const VALID = {
  email: 'c@x.il',
  offer_id: '22222222-2222-4222-8222-222222222222',
  idempotency_key: 'op-1',
  confirmed_terms: TERMS,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findAccountByEmail).mockResolvedValue({ id: 'u-1', email: 'c@x.il', name: null });
});
afterEach(() => vi.restoreAllMocks());

describe('createAssignmentAction', () => {
  it('created → redirects to the new assignment with notice=created, passing the confirmed terms', async () => {
    vi.mocked(createStaffAssignment).mockResolvedValue({
      assignmentId: 'a-new',
      keptAssignmentId: 'a-new',
      outcome: 'created',
      duplicateVoided: 'none',
      expiresAt: '2026-10-27T00:00:00.000Z',
      options: [],
    });

    await expect(createAssignmentAction({}, form(VALID))).rejects.toThrow(
      'REDIRECT:/admin/assignments/a-new?notice=created',
    );
    expect(createStaffAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedOptions: [
          { packageId: '11111111-1111-4111-8111-111111111111', listPrice: 100, discountAmount: 10, finalPrice: 90 },
        ],
      }),
    );
  });

  it('an idempotent replay → notice=existing ("מוצגים הפרטים שנשמרו")', async () => {
    vi.mocked(createStaffAssignment).mockResolvedValue({
      assignmentId: 'a-old',
      keptAssignmentId: 'a-old',
      outcome: 'existing',
      duplicateVoided: 'none',
      expiresAt: '2026-10-27T00:00:00.000Z',
      options: [],
    });

    await expect(createAssignmentAction({}, form(VALID))).rejects.toThrow(
      'REDIRECT:/admin/assignments/a-old?notice=existing',
    );
  });

  it('a duplicate that voided the NEW row → navigates to the KEPT assignment with notice=duplicate_kept', async () => {
    vi.mocked(createStaffAssignment).mockResolvedValue({
      assignmentId: 'a-new-voided',
      keptAssignmentId: 'a-kept',
      outcome: 'created',
      duplicateVoided: 'new',
      expiresAt: '2026-10-27T00:00:00.000Z',
      options: [],
    });

    await expect(createAssignmentAction({}, form(VALID))).rejects.toThrow(
      'REDIRECT:/admin/assignments/a-kept?notice=duplicate_kept',
    );
  });

  it('the stale-terms refusal surfaces as the re-confirm message', async () => {
    vi.mocked(createStaffAssignment).mockRejectedValue(new Error('תנאי ההצעה השתנו. בדקו ואשרו מחדש.'));
    const r = await createAssignmentAction({}, form(VALID));
    expect(r).toEqual({ serverError: 'תנאי ההצעה השתנו. בדקו ואשרו מחדש.' });
    // The router is refreshed inside the action, so the preview re-reads the CURRENT terms.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('tampered confirmed_terms fail validation before anything runs', async () => {
    const r = await createAssignmentAction(
      {},
      form({ ...VALID, confirmed_terms: '[{"packageId":"x","finalPrice":-1}]' }),
    );
    expect(actionErrorMessage(r)).toBeTruthy();
    expect(createStaffAssignment).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled(); // nothing on the server moved — no refresh round trip
  });

  it('a lookup failure at confirm time is an error, not a silent assignment', async () => {
    vi.mocked(findAccountByEmail).mockResolvedValue(null);
    const r = await createAssignmentAction({}, form(VALID));
    expect(r?.serverError).toContain('לא נמצא חשבון');
    expect(createStaffAssignment).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled(); // nothing on the server moved
  });

  it.each([
    ['an empty email', { email: '' }, 'נא להזין אימייל'],
    ['a malformed email', { email: 'not-an-email' }, 'כתובת אימייל לא תקינה'],
    ['no offer chosen', { offer_id: '', confirmed_terms: '' }, 'נא לבחור הצעה'],
  ])('%s answers with the schema’s Hebrew message before anything runs', async (_label, override, message) => {
    const r = await createAssignmentAction({}, form({ ...VALID, ...override }));
    expect(actionErrorMessage(r)).toBe(message);
    expect(findAccountByEmail).not.toHaveBeenCalled();
    expect(createStaffAssignment).not.toHaveBeenCalled();
  });
});

describe('voidAssignmentAction', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const LIST = '?status=waiting&sort=expiry&page=2';

  it('a refusal navigates to the detail page with the refusal code and the list filters — the dialog may no longer exist there', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'refused', reason: 'already_ended' });
    await expect(voidAssignmentAction(ID, LIST, {}, form({ reason: 'x' }))).rejects.toThrow(
      `REDIRECT:/admin/assignments/${ID}?status=waiting&sort=expiry&page=2&notice=void_refused_already_ended`,
    );
  });

  it('a refusal code outside the closed set never reaches the URL', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({
      outcome: 'refused',
      reason: '<script>' as unknown as 'already_ended',
    });
    const result = await voidAssignmentAction(ID, LIST, {}, form({ reason: 'x' }));
    expect(result).toEqual({ serverError: expect.stringContaining('המצב השתנה') });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['   ', ''])('an empty reason (%j) fails validation before anything runs', async (reason) => {
    const result = await voidAssignmentAction(ID, LIST, {}, form({ reason }));
    expect(result).toEqual({ validationErrors: { formErrors: [], fieldErrors: { reason: ['נדרשת סיבת ביטול'] } } });
    expect(actionErrorMessage(result)).toBe('נדרשת סיבת ביטול');
    expect(voidStaffAssignment).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('an unexpected server failure keeps the dialog open and refreshes the details in the same round trip', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(voidStaffAssignment).mockRejectedValue(new Error('void: assignment changed'));
    const result = await voidAssignmentAction(ID, LIST, {}, form({ reason: 'x' }));
    // An internal (non-Hebrew) message is logged on the server and replaced by the generic one (src/lib/safe-action.ts).
    expect(result).toEqual({ serverError: GENERIC_ACTION_ERROR });
    expect(log).toHaveBeenCalledWith('[action] Error: void: assignment changed');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a data-layer Hebrew failure reaches the dialog as it is, after the same refresh', async () => {
    vi.mocked(voidStaffAssignment).mockRejectedValue(new Error('ההטבה כבר בוטלה'));
    const result = await voidAssignmentAction(ID, LIST, {}, form({ reason: 'x' }));
    expect(result).toEqual({ serverError: 'ההטבה כבר בוטלה' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('voids from an unfiltered list (an empty list query is a valid bound argument)', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'voided' });
    await expect(voidAssignmentAction(ID, '', {}, form({ reason: 'x' }))).rejects.toThrow(
      `REDIRECT:/admin/assignments/${ID}?notice=voided`,
    );
  });

  it('a successful void carries the trimmed reason, then answers on the detail page keeping the filters', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'voided' });
    await expect(
      voidAssignmentAction(ID, LIST, {}, form({ reason: '  טעות בהקצאה  ' })),
    ).rejects.toThrow(`REDIRECT:/admin/assignments/${ID}?status=waiting&sort=expiry&page=2&notice=voided`);
    expect(voidStaffAssignment).toHaveBeenCalledWith(ID, 'טעות בהקצאה');
  });

  it('the list filters are re-validated: unknown keys and malformed values are dropped, never echoed', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'voided' });
    await expect(
      voidAssignmentAction(ID, '?status=waiting&evil=https://x.example&page=abc&q=a/b', {}, form({ reason: 'x' })),
    ).rejects.toThrow(`REDIRECT:/admin/assignments/${ID}?status=waiting&notice=voided`);
  });
});
