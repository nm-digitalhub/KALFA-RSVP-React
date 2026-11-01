import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/call-dnc', () => ({
  addToCallDnc: vi.fn(),
  checkNumberAsStaff: vi.fn(),
  setRegistryGateEnabled: vi.fn(),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { addToCallDnc, checkNumberAsStaff, setRegistryGateEnabled } from '@/lib/data/admin/call-dnc';
import { actionErrorMessage, actionFormError } from '@/lib/action-result';
import type { RegistryCheck } from '@/lib/dnc/registry-check';
import { addToCallDncAction, checkNumberAction, setRegistryGateAction } from './actions';

// The staff gate (manage_voice) lives in the data layer for all three; these tests prove what reaches the operator:
// the field messages, the fixed failure messages, the data layer's own refusals, and that a redirect passes through.

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

// Reset, not just clear: a failure one test sets up must not leak into the next.
beforeEach(() => vi.resetAllMocks());

describe('addToCallDncAction — the local block list', () => {
  it('adds the number with its reason and refreshes the page', async () => {
    vi.mocked(addToCallDnc).mockResolvedValue({ ok: true });

    const result = await addToCallDncAction({}, fd({ phone: ' 050-1234567 ', reason: ' בקשת הסרה ' }));

    expect(addToCallDnc).toHaveBeenCalledWith({ phone: '050-1234567', reason: 'בקשת הסרה' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/dnc');
    expect(result).toEqual({ data: { notice: 'נוסף לרשימת החסימה' } });
  });

  it('an empty reason is passed as an empty string (the data layer maps it to null)', async () => {
    vi.mocked(addToCallDnc).mockResolvedValue({ ok: true });

    await addToCallDncAction({}, fd({ phone: '0501234567', reason: '' }));

    expect(addToCallDnc).toHaveBeenCalledWith({ phone: '0501234567', reason: '' });
  });

  it('an empty phone gets the length message under the field, not a form-level one', async () => {
    const result = await addToCallDncAction({}, fd({ phone: '', reason: '' }));

    expect(result).toEqual({
      validationErrors: {
        formErrors: [],
        fieldErrors: { phone: ['Too small: expected string to have >=6 characters'] },
      },
    });
    expect(actionFormError(result)).toBeUndefined();
    expect(addToCallDnc).not.toHaveBeenCalled();
  });

  it("shows the data layer's own refusal as it is", async () => {
    vi.mocked(addToCallDnc).mockResolvedValue({ ok: false, error: 'מספר טלפון לא תקין' });

    const result = await addToCallDncAction({}, fd({ phone: '123456' }));

    expect(result).toEqual({ serverError: 'מספר טלפון לא תקין' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a thrown failure becomes the fixed message', async () => {
    vi.mocked(addToCallDnc).mockRejectedValue(new Error('db down'));

    const result = await addToCallDncAction({}, fd({ phone: '0501234567' }));

    expect(result).toEqual({ serverError: 'הוספה לרשימת ה-DNC נכשלה. נסו שוב.' });
  });

  it('propagates the gate redirect instead of returning an error', async () => {
    vi.mocked(addToCallDnc).mockRejectedValue(NEXT_REDIRECT);

    await expect(addToCallDncAction({}, fd({ phone: '0501234567' }))).rejects.toBe(NEXT_REDIRECT);
  });
});

describe('checkNumberAction — the registry lookup', () => {
  const CHECK: RegistryCheck = {
    result: 'registry_clear',
    source: 'national_registry',
    checkedAt: '2026-10-30T10:00:00.000Z',
    transactionId: 'tx-1',
    errorCode: null,
    failure: null,
  };

  it('returns the result, its source, time and transaction id — not the phone', async () => {
    vi.mocked(checkNumberAsStaff).mockResolvedValue({ ok: true, check: CHECK });

    const result = await checkNumberAction({}, fd({ phone: ' 0501234567 ' }));

    expect(checkNumberAsStaff).toHaveBeenCalledWith('0501234567');
    expect(result).toEqual({
      data: {
        result: 'registry_clear',
        checkedAt: '2026-10-30T10:00:00.000Z',
        source: 'national_registry',
        transactionId: 'tx-1',
      },
    });
  });

  it.each(['', '12345', '0'.repeat(33)])(
    'answers the invalid phone %j with the one form-level message',
    async (phone) => {
      const result = await checkNumberAction({}, fd({ phone }));

      expect(actionErrorMessage(result)).toBe('מספר טלפון לא תקין');
      expect(checkNumberAsStaff).not.toHaveBeenCalled();
    },
  );

  it('a missing phone gets the same message', async () => {
    const result = await checkNumberAction({}, fd({}));

    expect(actionErrorMessage(result)).toBe('מספר טלפון לא תקין');
  });

  it("shows the data layer's own refusal (the rate limit) as it is", async () => {
    vi.mocked(checkNumberAsStaff).mockResolvedValue({
      ok: false,
      error: 'יותר מדי בדיקות בזמן קצר. נסו שוב בעוד מספר דקות.',
    });

    const result = await checkNumberAction({}, fd({ phone: '0501234567' }));

    expect(result).toEqual({ serverError: 'יותר מדי בדיקות בזמן קצר. נסו שוב בעוד מספר דקות.' });
  });

  it('a thrown failure becomes the fixed message', async () => {
    vi.mocked(checkNumberAsStaff).mockRejectedValue(new Error('timeout'));

    const result = await checkNumberAction({}, fd({ phone: '0501234567' }));

    expect(result).toEqual({ serverError: 'הבדיקה נכשלה. נסו שוב.' });
  });

  it('propagates the gate redirect', async () => {
    vi.mocked(checkNumberAsStaff).mockRejectedValue(NEXT_REDIRECT);

    await expect(checkNumberAction({}, fd({ phone: '0501234567' }))).rejects.toBe(NEXT_REDIRECT);
  });
});

describe('setRegistryGateAction — the registry gate switch', () => {
  it('a checked box enables the gate, audits it, and says so', async () => {
    const result = await setRegistryGateAction({}, fd({ dnc_registry_gate_enabled: 'on' }));

    expect(setRegistryGateEnabled).toHaveBeenCalledWith(true);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', category: 'security' }));
    expect(result).toEqual({ data: { notice: 'הבדיקה מול המאגר הופעלה' } });
  });

  it('an absent checkbox disables it, with a warning-level audit', async () => {
    const result = await setRegistryGateAction({}, fd({}));

    expect(setRegistryGateEnabled).toHaveBeenCalledWith(false);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    expect(result).toEqual({ data: { notice: 'הבדיקה מול המאגר כובתה' } });
  });

  it('a failure becomes the fixed message, with no audit and no refresh', async () => {
    vi.mocked(setRegistryGateEnabled).mockRejectedValue(new Error('db down'));

    const result = await setRegistryGateAction({}, fd({ dnc_registry_gate_enabled: 'on' }));

    expect(result).toEqual({ serverError: 'עדכון מתג הבדיקה מול המאגר נכשל. נסו שוב.' });
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('propagates the gate redirect', async () => {
    vi.mocked(setRegistryGateEnabled).mockRejectedValue(NEXT_REDIRECT);

    await expect(setRegistryGateAction({}, fd({}))).rejects.toBe(NEXT_REDIRECT);
  });
});
