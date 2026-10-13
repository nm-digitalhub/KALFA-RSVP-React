import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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

import { createStaffAssignment, findAccountByEmail } from '@/lib/data/admin/coupon-assignments';
import { createAssignmentAction } from './actions';

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
  });

  it('tampered confirmed_terms fail validation before anything runs', async () => {
    const r = await createAssignmentAction(
      null,
      form({ ...VALID, confirmed_terms: '[{"packageId":"x","finalPrice":-1}]' }),
    );
    expect(r?.error).toBeTruthy();
    expect(createStaffAssignment).not.toHaveBeenCalled();
  });

  it('a lookup failure at confirm time is an error, not a silent assignment', async () => {
    vi.mocked(findAccountByEmail).mockResolvedValue(null);
    const r = await createAssignmentAction(null, form(VALID));
    expect(r?.error).toContain('לא נמצא חשבון');
    expect(createStaffAssignment).not.toHaveBeenCalled();
  });
});
