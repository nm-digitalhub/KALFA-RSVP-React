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
// update(patch), delete({ count }), eq, neq, in, gt, gte, lt, lte, is, order,
// limit, maybeSingle, and rpc(fn, args) from handlers. Column lists are not
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

export interface FakeTableClient {
  tables: Record<string, TableRow[]>;
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

export function createFakeTableClient(
  tables: Record<string, TableRow[]>,
  rpc: Record<string, RpcHandler> = {},
): FakeTableClient {
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
      if (rec.op === 'insert') {
        const added = (inserts ?? []).map((r) => ({ id: nextId(), ...r }));
        rows.push(...added);
        return { data: returning ? added : null, count: null, error: null };
      }
      const matched = rows.filter((r) => preds.every((p) => p(r)));
      if (rec.op === 'update') {
        for (const r of matched) Object.assign(r, patch);
        return { data: returning ? matched.map((r) => ({ ...r })) : null, count: null, error: null };
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
      then(onFulfilled: (v: ReturnType<typeof execute>) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve().then(execute).then(onFulfilled, onRejected);
      },
    };
    return b;
  }

  const fake: FakeTableClient = {
    tables,
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
