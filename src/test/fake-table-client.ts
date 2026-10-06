// An in-memory, FILTER-AWARE Supabase double that also WRITES — for code whose
// correctness lives in the WHERE clause of an update (a status CAS) or a
// delete (a retention cutoff).
//
// fake-count-client.ts is read-only by design, and a stub that answers every
// update with "one row changed" would let a CAS lose its status filter without
// any test noticing. Here an update changes exactly the rows its filters
// match, and reports them back only when `.select()` is chained, as PostgREST
// does; a delete removes exactly the matched rows and reports the count when
// asked with `{ count: 'exact' }`.
//
// Supported: select(cols, { count, head }), insert(row | rows),
// update(patch), delete({ count }), eq, neq, in, gt, gte, lt, lte, is, not (is /
// eq only), order, limit, maybeSingle, single, rows(table), partial UNIQUE
// indexes (options.uniqueIndexes → 23505), a BEFORE INSERT hook
// (options.beforeInsert), and rpc(fn, args) from handlers. Column lists are not
// projected — a row comes back whole — so a test pins columns through `ops`.
// `fail` makes the next query on a table (optionally of one kind) return an
// error with the given code.

export type TableRow = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update' | 'delete';

export interface RecordedOp {
  table: string;
  op: Op;
  columns?: string;
  filters: Array<[string, string, unknown]>;
  patch?: TableRow;
}

/**
 * A partial UNIQUE index, as Postgres enforces it: two rows that satisfy `where` and carry the same non-NULL
 * `columns` cannot coexist (23505). `where` values are matched with `===`; an array means "any of". Leave `table`
 * out to apply the index to every table that has the columns (fine for a single-table test).
 */
export interface UniqueIndex {
  table?: string;
  columns: string[];
  where?: Record<string, unknown>;
}

export interface FakeTableOptions {
  uniqueIndexes?: UniqueIndex[];
  /**
   * What a BEFORE INSERT trigger does in the database: it can set or rewrite columns (a derived event_id, a
   * `once_slot` snapshot) BEFORE the unique indexes look at the row. Returns the row to store.
   */
  beforeInsert?: (table: string, row: TableRow) => TableRow;
}

export interface FakeTableClient {
  tables: Record<string, TableRow[]>;
  /** The live rows of a table (`[]` when it does not exist). */
  rows(table: string): TableRow[];
  ops: RecordedOp[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }>;
  /** The next query on `table` (and `op`, when given) fails with `code`. */
  fail(table: string, code: string, op?: Op): void;
  client: {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code: string; message: string } | null }>;
  };
}

type RpcHandler = (args: Record<string, unknown> | undefined) => { data: unknown; error?: { code: string; message: string } | null };

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const ta = typeof a === 'string' ? Date.parse(a) : Number.NaN;
  const tb = typeof b === 'string' ? Date.parse(b) : Number.NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`;
}

const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value violates unique constraint' };

function matchesWhere(ix: UniqueIndex, row: TableRow): boolean {
  return Object.entries(ix.where ?? {}).every(([col, want]) =>
    Array.isArray(want) ? want.includes(row[col]) : row[col] === want,
  );
}

// NULL is distinct in a Postgres unique index, so a row with a NULL key column never conflicts.
function keyOf(ix: UniqueIndex, row: TableRow): string | null {
  const parts = ix.columns.map((c) => row[c]);
  if (parts.some((v) => v === null || v === undefined)) return null;
  return JSON.stringify(parts);
}

// Would `candidates` (rows being written) collide with `others` (rows already there) or with each other?
function violatesUnique(
  indexes: UniqueIndex[],
  table: string,
  candidates: TableRow[],
  others: TableRow[],
): boolean {
  for (const ix of indexes) {
    if (ix.table !== undefined && ix.table !== table) continue;
    const seen = new Set<string>();
    for (const row of others) {
      const k = matchesWhere(ix, row) ? keyOf(ix, row) : null;
      if (k !== null) seen.add(k);
    }
    for (const row of candidates) {
      const k = matchesWhere(ix, row) ? keyOf(ix, row) : null;
      if (k === null) continue;
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}

export function createFakeTableClient(
  tables: Record<string, TableRow[]>,
  rpc: Record<string, RpcHandler> = {},
  options: FakeTableOptions = {},
): FakeTableClient {
  const uniqueIndexes = options.uniqueIndexes ?? [];
  const ops: RecordedOp[] = [];
  const rpcCalls: FakeTableClient['rpcCalls'] = [];
  const failures: Array<{ table: string; code: string; op?: Op }> = [];

  function from(table: string) {
    const rec: RecordedOp = { table, op: 'select', filters: [] };
    let patch: TableRow | null = null;
    let inserts: TableRow[] | null = null;
    let returning = false;
    let head = false;
    let countMode = false;
    let single = false;
    // `.single()` (unlike `.maybeSingle()`) is an error unless exactly one row comes back.
    let strict = false;
    let limitN: number | null = null;
    const orders: Array<{ col: string; ascending: boolean }> = [];
    const preds: Array<(r: TableRow) => boolean> = [];

    const filter = (name: string, col: string, val: unknown, pred: (v: unknown) => boolean) => {
      rec.filters.push([name, col, val]);
      preds.push((r) => pred(r[col]));
      return b;
    };

    const execute = () => {
      ops.push(rec);
      const failAt = failures.findIndex((f) => f.table === table && (!f.op || f.op === rec.op));
      if (failAt >= 0) {
        const [f] = failures.splice(failAt, 1);
        return { data: null, count: null, error: { code: f.code, message: `forced ${f.code}` } };
      }
      const rows = (tables[table] ??= []);
      const notOne = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
      if (rec.op === 'insert') {
        const added = (inserts ?? []).map((r) => {
          const row = { id: nextId(), ...r };
          return options.beforeInsert ? options.beforeInsert(table, row) : row;
        });
        if (violatesUnique(uniqueIndexes, table, added, rows)) {
          return { data: null, count: null, error: UNIQUE_VIOLATION };
        }
        if (returning && strict && added.length !== 1) return { data: null, count: null, error: notOne };
        rows.push(...added);
        return { data: returning ? (strict ? { ...added[0] } : added) : null, count: null, error: null };
      }
      const matched = rows.filter((r) => preds.every((p) => p(r)));
      if (rec.op === 'update') {
        const after = matched.map((r) => ({ ...r, ...patch }));
        const untouched = rows.filter((r) => !matched.includes(r));
        if (violatesUnique(uniqueIndexes, table, after, untouched)) {
          return { data: null, count: null, error: UNIQUE_VIOLATION };
        }
        if (returning && strict && matched.length !== 1) return { data: null, count: null, error: notOne };
        for (const r of matched) Object.assign(r, patch);
        const out = matched.map((r) => ({ ...r }));
        return { data: returning ? (strict ? out[0] : out) : null, count: null, error: null };
      }
      if (rec.op === 'delete') {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: returning ? matched : null, count: countMode ? matched.length : null, error: null };
      }
      const sorted = [...matched].sort((x, y) => {
        for (const o of orders) {
          const c = compare(x[o.col], y[o.col]);
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
      const limited = limitN === null ? sorted : sorted.slice(0, limitN);
      const copies = limited.map((r) => ({ ...r }));
      if (strict && !head && copies.length !== 1) return { data: null, count: null, error: notOne };
      return {
        data: head ? null : single ? (copies[0] ?? null) : copies,
        count: countMode ? matched.length : null,
        error: null,
      };
    };

    const b = {
      select(columns?: string, options?: { count?: string; head?: boolean }) {
        if (rec.op === 'select') rec.columns = columns;
        else returning = true;
        head = options?.head === true;
        countMode = options?.count !== undefined;
        return b;
      },
      insert(row: TableRow | TableRow[]) {
        rec.op = 'insert';
        inserts = Array.isArray(row) ? row : [row];
        rec.patch = inserts[0];
        return b;
      },
      update(p: TableRow) {
        rec.op = 'update';
        patch = p;
        rec.patch = p;
        return b;
      },
      delete(options?: { count?: string }) {
        rec.op = 'delete';
        countMode = options?.count !== undefined;
        return b;
      },
      eq: (col: string, val: unknown) => filter('eq', col, val, (v) => v === val),
      neq: (col: string, val: unknown) => filter('neq', col, val, (v) => v !== val),
      in: (col: string, vals: unknown[]) => filter('in', col, vals, (v) => vals.includes(v)),
      gt: (col: string, val: unknown) => filter('gt', col, val, (v) => v != null && compare(v, val) > 0),
      gte: (col: string, val: unknown) => filter('gte', col, val, (v) => v != null && compare(v, val) >= 0),
      lt: (col: string, val: unknown) => filter('lt', col, val, (v) => v != null && compare(v, val) < 0),
      lte: (col: string, val: unknown) => filter('lte', col, val, (v) => v != null && compare(v, val) <= 0),
      is: (col: string, val: null) => filter('is', col, val, (v) => (v ?? null) === val),
      // Only the two forms the project uses; any other operator would silently return wrong rows, so it throws.
      not(col: string, operator: string, val: unknown) {
        if (operator === 'is') return filter('not.is', col, val, (v) => (v ?? null) !== val);
        if (operator === 'eq') return filter('not.eq', col, val, (v) => v !== val);
        throw new Error(`fake-table-client: .not(${col}, '${operator}') is unsupported`);
      },
      order(col: string, o: { ascending?: boolean } = {}) {
        orders.push({ col, ascending: o.ascending ?? true });
        return b;
      },
      limit(n: number) {
        limitN = n;
        return b;
      },
      maybeSingle() {
        single = true;
        return b;
      },
      single() {
        single = true;
        strict = true;
        return b;
      },
      then(onFulfilled: (v: ReturnType<typeof execute>) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve().then(execute).then(onFulfilled, onRejected);
      },
    };
    return b;
  }

  const fake: FakeTableClient = {
    tables,
    rows: (table) => tables[table] ?? [],
    ops,
    rpcCalls,
    fail(table, code, op) {
      failures.push({ table, code, op });
    },
    client: {
      from,
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        const failAt = failures.findIndex((f) => f.table === `rpc:${fn}`);
        if (failAt >= 0) {
          const [f] = failures.splice(failAt, 1);
          return { data: null, error: { code: f.code, message: `forced ${f.code}` } };
        }
        const handler = rpc[fn];
        if (!handler) return { data: null, error: { code: '42883', message: `no rpc ${fn}` } };
        const out = handler(args);
        return { data: out.data, error: out.error ?? null };
      },
    },
  };
  return fake;
}
