import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
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

    await expect(createAssignmentAction(null, form(VALID))).rejects.toThrow(
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

    await expect(createAssignmentAction(null, form(VALID))).rejects.toThrow(
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

    await expect(createAssignmentAction(null, form(VALID))).rejects.toThrow(
      'REDIRECT:/admin/assignments/a-kept?notice=duplicate_kept',
    );
  });

  it('the stale-terms refusal surfaces as the re-confirm message', async () => {
    vi.mocked(createStaffAssignment).mockRejectedValue(new Error('תנאי ההצעה השתנו. בדקו ואשרו מחדש.'));
    const r = await createAssignmentAction(null, form(VALID));
    expect(r).toEqual({ error: 'תנאי ההצעה השתנו. בדקו ואשרו מחדש.' });
    // The router is refreshed inside the action, so the preview re-reads the CURRENT terms.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('tampered confirmed_terms fail validation before anything runs', async () => {
    const r = await createAssignmentAction(
      null,
      form({ ...VALID, confirmed_terms: '[{"packageId":"x","finalPrice":-1}]' }),
    );
    expect(r?.error).toBeTruthy();
    expect(createStaffAssignment).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled(); // nothing on the server moved — no refresh round trip
  });

  it('a lookup failure at confirm time is an error, not a silent assignment', async () => {
    vi.mocked(findAccountByEmail).mockResolvedValue(null);
    const r = await createAssignmentAction(null, form(VALID));
    expect(r?.error).toContain('לא נמצא חשבון');
    expect(createStaffAssignment).not.toHaveBeenCalled();
  });
});

describe('voidAssignmentAction', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const LIST = '?status=waiting&sort=expiry&page=2';

  it('a refusal navigates to the detail page with the refusal code and the list filters — the dialog may no longer exist there', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'refused', reason: 'already_ended' });
    await expect(voidAssignmentAction(ID, LIST, null, form({ reason: 'x' }))).rejects.toThrow(
      `REDIRECT:/admin/assignments/${ID}?status=waiting&sort=expiry&page=2&notice=void_refused_already_ended`,
    );
  });

  it('a refusal code outside the closed set never reaches the URL', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({
      outcome: 'refused',
      reason: '<script>' as unknown as 'already_ended',
    });
    const result = await voidAssignmentAction(ID, LIST, null, form({ reason: 'x' }));
    expect(result).toEqual({ error: expect.stringContaining('המצב השתנה') });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('an empty reason fails validation before anything runs', async () => {
    const result = await voidAssignmentAction(ID, LIST, null, form({ reason: '   ' }));
    expect(result).toEqual({ error: 'נדרשת סיבת ביטול' });
    expect(voidStaffAssignment).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('an unexpected server failure keeps the dialog open and refreshes the details in the same round trip', async () => {
    vi.mocked(voidStaffAssignment).mockRejectedValue(new Error('void: assignment changed'));
    const result = await voidAssignmentAction(ID, LIST, null, form({ reason: 'x' }));
    expect(result).toEqual({ error: 'void: assignment changed' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a successful void carries the trimmed reason, then answers on the detail page keeping the filters', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'voided' });
    await expect(
      voidAssignmentAction(ID, LIST, null, form({ reason: '  טעות בהקצאה  ' })),
    ).rejects.toThrow(`REDIRECT:/admin/assignments/${ID}?status=waiting&sort=expiry&page=2&notice=voided`);
    expect(voidStaffAssignment).toHaveBeenCalledWith(ID, 'טעות בהקצאה');
  });

  it('the list filters are re-validated: unknown keys and malformed values are dropped, never echoed', async () => {
    vi.mocked(voidStaffAssignment).mockResolvedValue({ outcome: 'voided' });
    await expect(
      voidAssignmentAction(ID, '?status=waiting&evil=https://x.example&page=abc&q=a/b', null, form({ reason: 'x' })),
    ).rejects.toThrow(`REDIRECT:/admin/assignments/${ID}?status=waiting&notice=voided`);
  });
});
