import { describe, expect, it } from 'vitest';

import { createFakeTableClient } from './fake-table-client';

// The ledger's correctness lives in two database facts a naive double cannot show: partial UNIQUE indexes
// (once_uq / one_pending_uq → 23505) and `.single()` on an insert. These tests pin the double itself, so a
// ledger test that relies on it is not passing against a stub that never says no.

type Result = { data: unknown; error: { code: string; message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns?: string): Query;
  single(): Query;
  insert(row: object): Query;
  update(patch: object): Query;
  eq(column: string, value: unknown): Query;
  not(column: string, operator: string, value: unknown): Query;
};
const from = (db: { client: unknown }, table: string) => (db.client as { from: (t: string) => Query }).from(table);

const PENDING = { columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } };
const LIVE = { columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } };

describe('rows()', () => {
  it('returns the live rows of a table, and [] for an unknown one', () => {
    const db = createFakeTableClient({ t: [{ id: 'a' }] });
    expect(db.rows('t')).toEqual([{ id: 'a' }]);
    expect(db.rows('missing')).toEqual([]);
  });
});

describe('unique indexes → 23505', () => {
  it('a second pending row for the same campaign + kind fails, and the table is unchanged', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'p', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] },
      {},
      { uniqueIndexes: [PENDING] },
    );
    const res = await from(db, 'ops').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending' }).select('id').single();
    expect(res.error?.code).toBe('23505');
    expect(db.rows('ops')).toHaveLength(1);
  });

  it('a row that does not satisfy the index predicate does not conflict (a failed attempt leaves the slot)', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'f', campaign_id: 'c1', kind: 'charge', outcome: 'failed' }] },
      {},
      { uniqueIndexes: [PENDING] },
    );
    const res = await from(db, 'ops').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending' }).select('id').single();
    expect(res.error).toBeNull();
    expect(db.rows('ops')).toHaveLength(2);
  });

  it('another campaign or another kind does not conflict', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'p', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] },
      {},
      { uniqueIndexes: [PENDING] },
    );
    expect((await from(db, 'ops').insert({ campaign_id: 'c2', kind: 'charge', outcome: 'pending' })).error).toBeNull();
    expect((await from(db, 'ops').insert({ campaign_id: 'c1', kind: 'refund', outcome: 'pending' })).error).toBeNull();
  });

  it('a list in `where` means "any of": a REVIEW row blocks, a FAILED one does not', async () => {
    const blocked = createFakeTableClient(
      { ops: [{ id: 'r', campaign_id: 'c1', kind: 'charge', outcome: 'review', once_slot: true }] },
      {},
      { uniqueIndexes: [LIVE] },
    );
    const res = await from(blocked, 'ops').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending', once_slot: true });
    expect(res.error?.code).toBe('23505');
    const open = createFakeTableClient(
      { ops: [{ id: 'f', campaign_id: 'c1', kind: 'charge', outcome: 'failed', once_slot: true }] },
      {},
      { uniqueIndexes: [LIVE] },
    );
    expect((await from(open, 'ops').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending', once_slot: true })).error).toBeNull();
  });

  it('NULL is distinct, as in Postgres: two rows with a NULL key column never conflict', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'a', campaign_id: null, kind: 'charge', outcome: 'pending' }] },
      {},
      { uniqueIndexes: [PENDING] },
    );
    expect((await from(db, 'ops').insert({ campaign_id: null, kind: 'charge', outcome: 'pending' })).error).toBeNull();
  });

  it('an UPDATE that would create a duplicate fails and is not applied', async () => {
    const db = createFakeTableClient(
      {
        ops: [
          { id: 'p', campaign_id: 'c1', kind: 'charge', outcome: 'pending' },
          { id: 'f', campaign_id: 'c1', kind: 'charge', outcome: 'failed' },
        ],
      },
      {},
      { uniqueIndexes: [PENDING] },
    );
    const res = await from(db, 'ops').update({ outcome: 'pending' }).eq('id', 'f');
    expect(res.error?.code).toBe('23505');
    expect(db.rows('ops').find((r) => r.id === 'f')?.outcome).toBe('failed');
  });

  it('an index scoped to one table does not apply to another', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'p', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }], other: [{ id: 'q', campaign_id: 'c1', kind: 'charge', outcome: 'pending' }] },
      {},
      { uniqueIndexes: [{ ...PENDING, table: 'ops' }] },
    );
    expect((await from(db, 'other').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending' })).error).toBeNull();
  });
});

describe('.single()', () => {
  it('after insert + select returns the inserted row itself, not an array', async () => {
    const db = createFakeTableClient({ ops: [] });
    const res = await from(db, 'ops').insert({ kind: 'charge' }).select('id').single();
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ kind: 'charge', id: expect.any(String) });
  });

  it('on a select with no row or with two rows → an error, unlike maybeSingle', async () => {
    const none = createFakeTableClient({ ops: [] });
    expect((await from(none, 'ops').select('id').single()).error?.code).toBe('PGRST116');
    const two = createFakeTableClient({ ops: [{ id: 'a' }, { id: 'b' }] });
    expect((await from(two, 'ops').select('id').single()).error?.code).toBe('PGRST116');
    const one = createFakeTableClient({ ops: [{ id: 'a' }] });
    expect((await from(one, 'ops').select('id').single()).data).toMatchObject({ id: 'a' });
  });
});

describe('.not()', () => {
  it("not(col, 'is', null) keeps only rows where the column has a value", async () => {
    const db = createFakeTableClient({ ops: [{ id: 'a', tok: 'x' }, { id: 'b', tok: null }, { id: 'c' }] });
    const res = await from(db, 'ops').select('id').not('tok', 'is', null);
    expect(res.data).toEqual([{ id: 'a', tok: 'x' }]);
  });

  it('an operator it cannot honour fails loudly instead of returning wrong rows', () => {
    const db = createFakeTableClient({ ops: [] });
    expect(() => from(db, 'ops').select('id').not('tok', 'gt', 1)).toThrow(/unsupported/);
  });
});

describe('beforeInsert — what a BEFORE INSERT trigger does', () => {
  it('can set a column the unique index depends on, so the index sees the row as the database would', async () => {
    const db = createFakeTableClient(
      { ops: [{ id: 'a', campaign_id: 'c1', kind: 'charge', outcome: 'succeeded', once_slot: true }] },
      {},
      { uniqueIndexes: [LIVE], beforeInsert: (_table, row) => ({ ...row, once_slot: row.kind === 'charge' }) },
    );
    expect((await from(db, 'ops').insert({ campaign_id: 'c1', kind: 'charge', outcome: 'pending' })).error?.code).toBe('23505');
    expect((await from(db, 'ops').insert({ campaign_id: 'c1', kind: 'refund', outcome: 'pending' })).error).toBeNull();
    expect(db.rows('ops').find((r) => r.kind === 'refund')?.once_slot).toBe(false);
  });
});
