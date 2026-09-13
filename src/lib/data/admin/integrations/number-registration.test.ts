import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  ownerMock,
  permMock,
  slackMock,
  cfgMock,
  addMock,
  requestMock,
  verifyMock,
  registerMock,
  deregisterMock,
  fromMock,
} = vi.hoisted(() => ({
  ownerMock: vi.fn(),
  permMock: vi.fn(),
  slackMock: vi.fn(),
  cfgMock: vi.fn(),
  addMock: vi.fn(),
  requestMock: vi.fn(),
  verifyMock: vi.fn(),
  registerMock: vi.fn(),
  deregisterMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({
  requirePlatformOwner: ownerMock,
  requirePlatformPermission: permMock,
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: cfgMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: fromMock }) }));
vi.mock('@/lib/whatsapp/add-waba-phone-number', () => ({ addWabaPhoneNumber: addMock }));
vi.mock('@/lib/whatsapp/phone-numbers', () => ({
  META_RATE_LIMIT_CODE: 133016,
  metaErrorSubcode: (e: unknown) => {
    const x = e as { errorSubcode?: number; providerSubcode?: number } | null;
    return x?.errorSubcode ?? x?.providerSubcode ?? null;
  },
  metaErrorCode: (e: unknown) => {
    const x = e as { code?: number; providerCode?: number } | null;
    return x?.code ?? x?.providerCode ?? null;
  },
  requestVerificationCode: requestMock,
  verifyPhoneNumberCode: verifyMock,
  registerPhoneNumber: registerMock,
  deregisterPhoneNumber: deregisterMock,
}));

import {
  REGISTRATION_BUDGET,
  addNumber,
  deregisterNumber,
  getRegistrationBudget,
  registerNumber,
  requestCode,
  verifyCode,
} from './number-registration';

const META_ID = '1018741517998430';
const OTHER_ID = '2222222222222222';
const PIN = '246813';

/** Records what the query builder was asked, so the filters can be asserted. */
interface Recorded {
  table: string;
  filters: Record<string, unknown>;
  inserted?: Record<string, unknown>;
}
let recorded: Recorded[] = [];

/** Rows the fake activity_log returns, and whether reading or writing fails. */
let logRows: Array<{ created_at: string; meta: unknown }> = [];
let readError: boolean;
let insertError: boolean;
/** Order of operations, so "reserved before Meta was called" is observable. */
let sequence: string[] = [];

function fakeTable(table: string) {
  const rec: Recorded = { table, filters: {} };
  recorded.push(rec);
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      rec.filters[col] = val;
      return builder;
    },
    gte: (col: string, val: unknown) => {
      rec.filters[`gte:${col}`] = val;
      return builder;
    },
    order: () => builder,
    limit: () => {
      sequence.push('read');
      return Promise.resolve(
        readError ? { data: null, error: { message: 'boom' } } : { data: logRows, error: null },
      );
    },
    insert: (row: Record<string, unknown>) => {
      rec.inserted = row;
      sequence.push('insert');
      return Promise.resolve(insertError ? { error: { message: 'boom' } } : { error: null });
    },
  };
  return builder;
}

function attempt(phoneNumberId: string, hoursAgo = 1) {
  return {
    created_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    meta: { phoneNumberId, operation: 'register' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  logRows = [];
  sequence = [];
  readError = false;
  insertError = false;
  ownerMock.mockResolvedValue({ id: 'owner-1' });
  permMock.mockResolvedValue({ id: 'staff-1' });
  cfgMock.mockResolvedValue({ wabaId: 'w1', accessToken: 't1' });
  fromMock.mockImplementation(fakeTable);
  registerMock.mockImplementation(() => {
    sequence.push('meta');
    return Promise.resolve(undefined);
  });
  deregisterMock.mockImplementation(() => {
    sequence.push('meta');
    return Promise.resolve(undefined);
  });
});

describe('the 72-hour registration budget', () => {
  it('claims a unit BEFORE calling Meta, not after', async () => {
    // The order is the whole point. Reserving after the call means a crash mid-flight
    // leaves a request Meta counted and we did not — and that drift only ever
    // surfaces as a block that looked impossible.
    await registerNumber(META_ID, PIN);
    expect(sequence).toEqual(['read', 'insert', 'meta']);
  });

  it('refuses at OUR ceiling, which is below Meta\'s ten', async () => {
    logRows = Array.from({ length: REGISTRATION_BUDGET }, () => attempt(META_ID));
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/מכסת הרישום/);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('leaves headroom rather than spending Meta\'s last request', () => {
    // If this guard is ever wrong — a row that failed to write, an attempt made from
    // WhatsApp Manager instead of from here — the remaining requests are what let the
    // owner recover the number by hand.
    expect(REGISTRATION_BUDGET).toBeLessThan(10);
  });

  it('counts only attempts against THIS number', async () => {
    logRows = Array.from({ length: REGISTRATION_BUDGET }, () => attempt(OTHER_ID));
    await expect(registerNumber(META_ID, PIN)).resolves.toBeUndefined();
    expect(registerMock).toHaveBeenCalled();
  });

  it('asks the database for a 72-hour window, not for everything', async () => {
    await registerNumber(META_ID, PIN);
    const read = recorded[0];
    expect(read.filters.action).toBe('admin.integrations.number_registration_attempt');
    const since = new Date(String(read.filters['gte:created_at'])).getTime();
    const hours = (Date.now() - since) / 3600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
  });

  it('register and deregister spend the SAME budget', async () => {
    // A register/deregister cycle burns the window twice as fast, so counting them
    // separately would let two loops of five walk straight into the block.
    logRows = Array.from({ length: REGISTRATION_BUDGET }, () => attempt(META_ID));
    await expect(deregisterNumber(META_ID)).rejects.toThrow(/מכסת הרישום/);
    expect(deregisterMock).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the counter cannot be read', async () => {
    // An unreadable counter is not an empty counter. Guessing "empty" costs a
    // 72-hour block on a number that may be sending invitations.
    readError = true;
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/לא ניתן לאמת/);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the attempt row cannot be written', async () => {
    // Unlike logActivity's best-effort audit rows, this write IS the budget: if it
    // did not land, the next attempt would under-count and the drift compounds.
    insertError = true;
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/לא ניתן לרשום/);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('records the Meta object id and the operation, and nothing personal', async () => {
    await registerNumber(META_ID, PIN);
    const insert = recorded.find((r) => r.inserted)?.inserted;
    expect(insert?.meta).toEqual({ phoneNumberId: META_ID, operation: 'register' });
    expect(JSON.stringify(insert)).not.toContain(PIN);
  });

  it('reports the remaining budget without spending any of it', async () => {
    logRows = [attempt(META_ID), attempt(META_ID)];
    const budget = await getRegistrationBudget(META_ID);
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(REGISTRATION_BUDGET - 2);
    expect(recorded.some((r) => r.inserted)).toBe(false);
  });
});

describe('gates', () => {
  it('register is owner-only, not merely staff-only', async () => {
    await registerNumber(META_ID, PIN);
    expect(ownerMock).toHaveBeenCalled();
  });

  it('deregister is owner-only', async () => {
    await deregisterNumber(META_ID);
    expect(ownerMock).toHaveBeenCalled();
  });

  it('adding and verifying take manage_settings', async () => {
    addMock.mockResolvedValue({ id: META_ID });
    await addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' });
    verifyMock.mockResolvedValue(undefined);
    await verifyCode(META_ID, '123456');
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('refuses every operation when Meta was never connected', async () => {
    cfgMock.mockResolvedValue({ wabaId: null, accessToken: null });
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/חסרים פרטי חיבור/);
    // And the budget is untouched: a missing token is our problem, not Meta's quota.
    expect(recorded.some((r) => r.inserted)).toBe(false);
  });
});

describe('what Meta says, translated into something actionable', () => {
  it('turns 133016 into "wait", never into "try again"', async () => {
    const err = Object.assign(new Error('x'), { code: 133016 });
    registerMock.mockRejectedValue(err);
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/72 שעות/);
  });

  it('does NOT invent a meaning for a code it cannot identify', async () => {
    // 136024 was mapped to "finish the verification step" and shown to the owner at
    // the moment he was trying to do exactly that. An invented cause sends someone to
    // fix the wrong thing; the number is what can be looked up.
    registerMock.mockRejectedValue(Object.assign(new Error('x'), { code: 136024 }));
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/לא מסרה סיבה שאנחנו מזהים/);
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/קוד Meta 136024/);
  });

  it('lets a documented SUBCODE outrank an undocumented code', async () => {
    // Meta's error page does not list 136024 at all, but it documents subcode
    // 2388091. The subcode is where the meaning lives, so it wins.
    registerMock.mockRejectedValue(
      Object.assign(new Error('x'), { code: 136024, errorSubcode: 2388091 }),
    );
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/חשבון WhatsApp/);
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/תת-קוד 2388091/);
  });

  it('carries the SUBCODE too — often the only thing that separates two failures', async () => {
    registerMock.mockRejectedValue(
      Object.assign(new Error('x'), { code: 136024, errorSubcode: 2494102 }),
    );
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/תת-קוד 2494102/);
    // An UNKNOWN subcode must not borrow the known one's explanation.
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow(/לא מסרה סיבה שאנחנו מזהים/);
  });

  it('never lets Meta\'s own error text reach the admin', async () => {
    const err = Object.assign(new Error('Bearer EAAG... invalid'), { code: 190 });
    registerMock.mockRejectedValue(err);
    await expect(registerNumber(META_ID, PIN)).rejects.not.toThrow(/Bearer/);
  });
});

describe('the PIN', () => {
  it('never appears in a Slack alert, on success or on failure', async () => {
    await registerNumber(META_ID, PIN);
    expect(JSON.stringify(slackMock.mock.calls)).not.toContain(PIN);

    slackMock.mockClear();
    registerMock.mockRejectedValue(Object.assign(new Error('x'), { code: 100 }));
    await expect(registerNumber(META_ID, PIN)).rejects.toThrow();
    expect(JSON.stringify(slackMock.mock.calls)).not.toContain(PIN);
  });

  it('is not returned to the caller', async () => {
    // registerNumber resolves to void by design: there is nothing to hand back, and a
    // return value is the easiest place for a credential to escape by accident.
    await expect(registerNumber(META_ID, PIN)).resolves.toBeUndefined();
  });
});

describe('alerting', () => {
  it('announces a registration, so it is never silent', async () => {
    await registerNumber(META_ID, PIN);
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'security', level: 'info' }),
    );
  });

  it('announces a DEREGISTRATION louder — sending just stopped', async () => {
    await deregisterNumber(META_ID);
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'security', level: 'warn' }),
    );
  });

  it('does not let a broken Slack fail the operation', async () => {
    // sendSlackAlert is fail-safe by contract; this pins that the caller relies on it
    // rather than awaiting a notification it cannot guarantee.
    slackMock.mockImplementation(() => Promise.reject(new Error('slack down')));
    await expect(registerNumber(META_ID, PIN)).resolves.toBeUndefined();
  });
});

describe('requestCode', () => {
  it('passes the delivery method through to Meta', async () => {
    requestMock.mockResolvedValue(undefined);
    await requestCode(META_ID, 'VOICE');
    expect(requestMock).toHaveBeenCalledWith(META_ID, 't1', 'VOICE');
  });

  it('costs nothing against the registration budget', async () => {
    // Asking for a code is repeatable; registering is not. Conflating them would
    // spend the scarce budget on the cheap step.
    requestMock.mockResolvedValue(undefined);
    await requestCode(META_ID, 'SMS');
    expect(recorded.some((r) => r.inserted)).toBe(false);
  });
});

describe('a failed add says WHY', () => {
  it('maps the typed client\'s providerCode, not just postGraph\'s code', async () => {
    // AddWabaPhoneNumberError calls the field `providerCode`. Reading only `code`
    // meant every add failure arrived as null and reached the admin as four words
    // with no information in them.
    addMock.mockRejectedValue(
      Object.assign(new Error('Meta rejected the WhatsApp phone number creation request'), {
        providerCode: 100,
        httpStatus: 400,
      }),
    );
    await expect(
      addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' }),
    ).rejects.toThrow(/קוד Meta 100/);
  });

  it('names the most likely cause of a 100, rather than only its number', async () => {
    addMock.mockRejectedValue(Object.assign(new Error('x'), { providerCode: 100 }));
    await expect(
      addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' }),
    ).rejects.toThrow(/כבר רשום בחשבון WhatsApp אחר/);
  });

  it('records the failure, which previously left no trace at all', async () => {
    addMock.mockRejectedValue(Object.assign(new Error('x'), { providerCode: 190 }));
    await expect(
      addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' }),
    ).rejects.toThrow();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ code: 190 }) }),
    );
  });

  it('never puts the phone number in the alert', async () => {
    addMock.mockRejectedValue(Object.assign(new Error('x'), { providerCode: 100 }));
    await expect(
      addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' }),
    ).rejects.toThrow();
    expect(JSON.stringify(slackMock.mock.calls)).not.toContain('972501234567');
  });

  it('still carries a code even when Meta gave a shape we do not recognise', async () => {
    addMock.mockRejectedValue(Object.assign(new Error('x'), { providerCode: 999999 }));
    await expect(
      addNumber({ cc: '972', phoneNumber: '972501234567', verifiedName: 'KALFA' }),
    ).rejects.toThrow(/קוד Meta 999999/);
  });
});
