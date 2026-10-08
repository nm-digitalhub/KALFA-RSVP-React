import type { TableRow } from './fake-table-client';

// The part of payment_operations_before_insert that STAMPS a row (migration 20261008033521), for the in-memory ledger doubles. A double
// that did not do this would let every test of the new behaviour pass for the wrong reason:
//   - a row that is not a child gets `is_test` from the terminal it was asked to open on (payment_is_test_terminal: true for the
//     CardCom test terminal, false for any other terminal and for none);
//   - a child (a refund, a release) takes provider, terminal and class from its parent whatever the caller sent, and its own
//     echo starts empty.
// What it leaves out (the double never throws, so a test that depends on any of these must not rely on it):
//   - the refusals of the insert trigger: a refund or release without a parent, a parent that is missing or in another campaign or
//     did not succeed - a child of a parent that is not in the table is simply stamped "sumit, no terminal, real";
//   - payment_operations_provider_stamp_coherent: provider 'cardcom' with no terminal, or a terminal on another provider;
//   - the guard on UPDATE: the frozen stamp and class, and the write-once echo.
// Wrap the double a test already has (it keeps doing what it did, e.g. the once_slot snapshot):
//   createFakeTableClient(tables, {}, { beforeInsert: withLedgerStamp(existingTrigger), uniqueIndexes })

// The terminal that moves no money (the body of payment_is_test_terminal). src/lib/payments/provider.test.ts reads the migration and
// pins that this is the number the database uses.
export const LEDGER_TEST_TERMINAL = 1000;

type Trigger = (table: string, row: TableRow, rows: readonly TableRow[]) => TableRow;

export function withLedgerStamp(inner: Trigger = (_table, row) => row): Trigger {
  return (table, row, rows) => {
    const out = inner(table, row, rows);
    if (table !== 'payment_operations') return out;
    const parentId = out.parent_operation_id;
    if (typeof parentId === 'string' && parentId !== '') {
      const parent = rows.find((r) => r.id === parentId);
      return {
        ...out,
        provider: parent?.provider ?? 'sumit',
        provider_terminal: parent?.provider_terminal ?? null,
        is_test: parent?.is_test === true,
        provider_terminal_echo: null,
      };
    }
    const terminal = typeof out.provider_terminal === 'number' ? out.provider_terminal : null;
    return { ...out, is_test: terminal === LEDGER_TEST_TERMINAL };
  };
}
