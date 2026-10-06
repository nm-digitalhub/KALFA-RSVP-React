import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createFakeTableClient } from '@/test/fake-table-client';

import { getSumitCustomerId, readSumitCustomerNumber } from './sumit-customers';

// sumit_customers holds one SUMIT customer number per paying account. It is a server-only table: the browser has no
// grant on it, so the number reaches a screen only through these readers, scoped to the account the caller names.

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function wire(rows: Array<Record<string, unknown>>) {
  const db = createFakeTableClient({ sumit_customers: rows });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readSumitCustomerNumber — for display', () => {
  it('returns the number SUMIT gave this account', async () => {
    wire([{ user_id: ME, sumit_customer_id: 2127277236 }]);
    expect(await readSumitCustomerNumber(ME)).toBe(2127277236);
  });

  it("reads only the account it is asked about — never another account's number", async () => {
    wire([
      { user_id: OTHER, sumit_customer_id: 5 },
      { user_id: ME, sumit_customer_id: 7 },
    ]);
    expect(await readSumitCustomerNumber(ME)).toBe(7);
    expect(await readSumitCustomerNumber('33333333-3333-4333-8333-333333333333')).toBeNull();
  });

  it('is null for an account that has not paid yet (SUMIT opens the customer at the first payment)', async () => {
    wire([]);
    expect(await readSumitCustomerNumber(ME)).toBeNull();
  });

  it('turns a bigint that arrives as text into a number', async () => {
    wire([{ user_id: ME, sumit_customer_id: '2127277236' }]);
    expect(await readSumitCustomerNumber(ME)).toBe(2127277236);
  });

  it('selects the one column it needs, filtered by the account', async () => {
    const db = wire([{ user_id: ME, sumit_customer_id: 1 }]);
    await readSumitCustomerNumber(ME);
    expect(db.ops).toHaveLength(1);
    expect(db.ops[0]).toMatchObject({ table: 'sumit_customers', op: 'select', columns: 'sumit_customer_id' });
    expect(db.ops[0].filters).toEqual([['eq', 'user_id', ME]]);
  });

  it('a read failure is THROWN, so a screen can say "unavailable" instead of "no number yet"', async () => {
    const db = wire([{ user_id: ME, sumit_customer_id: 1 }]);
    db.fail('sumit_customers', '57014', 'select');
    await expect(readSumitCustomerNumber(ME)).rejects.toThrow('טעינת מספר הלקוח נכשלה');
  });
});

describe('getSumitCustomerId — best effort, for the card hold', () => {
  it('gives the same answers as the strict reader', async () => {
    wire([{ user_id: ME, sumit_customer_id: 2127277236 }]);
    expect(await getSumitCustomerId(ME)).toBe(2127277236);
    expect(await getSumitCustomerId(OTHER)).toBeNull();
  });

  it('a read failure is NOT thrown: the hold falls back to creating a customer, as it always did', async () => {
    const db = wire([{ user_id: ME, sumit_customer_id: 1 }]);
    db.fail('sumit_customers', '57014', 'select');
    expect(await getSumitCustomerId(ME)).toBeNull();
  });

  it('a missing service-role configuration still fails loudly — it is not swallowed as "no customer"', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('missing service role');
    });
    await expect(getSumitCustomerId(ME)).rejects.toThrow('missing service role');
  });
});
