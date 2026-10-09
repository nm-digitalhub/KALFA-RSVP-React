import { describe, expect, it } from 'vitest';

import { LEDGER_TEST_TERMINAL, withLedgerStamp } from './ledger-stamp-trigger';

// The double must stamp rows the way the database trigger does, or every test that relies on it proves nothing.

describe('withLedgerStamp', () => {
  const stamp = withLedgerStamp();

  it('classifies a row by the terminal it was asked to open on: the test terminal is test, any other terminal and none are real', () => {
    expect(stamp('payment_operations', { provider: 'cardcom', provider_terminal: LEDGER_TEST_TERMINAL }, []).is_test).toBe(true);
    expect(stamp('payment_operations', { provider: 'cardcom', provider_terminal: 1001 }, []).is_test).toBe(false);
    expect(stamp('payment_operations', { provider: 'sumit' }, []).is_test).toBe(false);
    expect(stamp('payment_operations', { provider_terminal: null }, []).is_test).toBe(false);
  });

  it('a child takes provider, terminal and class from its parent, whatever the caller sent, and starts with no echo', () => {
    const parent = { id: 'p', provider: 'cardcom', provider_terminal: 1000, is_test: true };
    const child = stamp('payment_operations', { parent_operation_id: 'p', provider: 'sumit', provider_terminal: 1001, is_test: false, provider_terminal_echo: 1001 }, [parent]);
    expect(child).toMatchObject({ provider: 'cardcom', provider_terminal: 1000, is_test: true, provider_terminal_echo: null });
  });

  it('a child of a real payment is real, and a child of a row that has no stamp (an old row) is real and unstamped', () => {
    expect(stamp('payment_operations', { parent_operation_id: 'a' }, [{ id: 'a', provider: 'cardcom', provider_terminal: 1001, is_test: false }])).toMatchObject({ provider: 'cardcom', provider_terminal: 1001, is_test: false });
    expect(stamp('payment_operations', { parent_operation_id: 'b' }, [{ id: 'b' }])).toMatchObject({ provider: 'sumit', provider_terminal: null, is_test: false });
  });

  it('leaves every other table alone, and keeps what the wrapped trigger did', () => {
    expect(stamp('payment_operation_lines', { provider_terminal: 1000 }, [])).toEqual({ provider_terminal: 1000 });
    const wrapped = withLedgerStamp((_t, row) => ({ ...row, once_slot: true }));
    expect(wrapped('payment_operations', { provider_terminal: 1000 }, [])).toMatchObject({ once_slot: true, is_test: true });
  });
});
