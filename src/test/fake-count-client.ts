// A FILTER-AWARE Supabase double for count/aggregate parity tests.
//
// createMockSupabase (./supabase-mock.ts) answers every query with one canned
// result, so "wrapper and core return the same number" would pass even if
// their filters differed. This fake holds real rows per table and actually
// applies the filters a query chains (eq / in / gte / lte / or), so two
// callers agree only when their predicates agree.
//
// Supported: select(cols, { count, head }), eq, neq, in, gte, lt, lte, is,
// not(col, 'is', v), or, order, range, limit, maybeSingle — enough for the
// owner-agent cores and the admin wrappers that share them. `or` understands
// the PostgREST subset those use: comma-separated terms of `col.op.value`,
// `col.in.(a,b)` and `and(t1,t2)`.
//
// A dotted column ('events.status') reads the embedded object on the row
// (row.events.status), which is what an `events!inner(status)` select filters
// on; a row whose embed is missing fails the filter, as an inner join drops it.
// order / range / limit are applied (a "latest row" read must pick the right
// row), and `count` is taken BEFORE range/limit, as PostgREST does.
//
// Every query is recorded in `calls` (table, select options, filters) so a
// test can pin the query shape too.
//
// `rpc(fn, args)` answers from `opts.rpc[fn]` (a table-returning function is
// an array of rows, as PostgREST returns it) and records the call in
// `rpcCalls`; an rpc with no handler answers with an error, so a core that
// starts calling a new function fails its test until the test says what the
// function returns.

export type FakeRow = Record<string, unknown>;

type Predicate = (row: FakeRow) => boolean;

export interface RecordedQuery {
  table: string;
  columns: string | undefined;
  selectOptions: { count?: string; head?: boolean } | undefined;
  filters: Array<{ op: string; args: unknown[] }>;
}

export interface FakeRpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface FakeCountClient {
  client: {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<FakeRpcResult>;
  };
  calls: RecordedQuery[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }>;
}

// Column value, following a dotted path into embedded objects.
function get(row: FakeRow, col: string): unknown {
  if (!col.includes('.')) return row[col];
  let cur: unknown = row;
  for (const part of col.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function time(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function compare(a: unknown, b: unknown): number {
  const ta = time(a);
  const tb = time(b);
  if (ta !== null && tb !== null) return ta - tb;
  return String(a).localeCompare(String(b));
}

// Split on commas that are not inside parentheses.
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseTerm(term: string): Predicate {
  if (term.startsWith('and(') && term.endsWith(')')) {
    const inner = splitTopLevel(term.slice(4, -1)).map(parseTerm);
    return (row) => inner.every((p) => p(row));
  }
  if (term.startsWith('or(') && term.endsWith(')')) {
    const inner = splitTopLevel(term.slice(3, -1)).map(parseTerm);
    return (row) => inner.some((p) => p(row));
  }
  const firstDot = term.indexOf('.');
  const col = term.slice(0, firstDot);
  const rest = term.slice(firstDot + 1);
  const secondDot = rest.indexOf('.');
  const op = rest.slice(0, secondDot);
  const value = rest.slice(secondDot + 1);
  switch (op) {
    case 'eq':
      return (row) => String(row[col]) === value;
    case 'in': {
      const set = new Set(value.replace(/^\(|\)$/g, '').split(','));
      return (row) => row[col] !== null && row[col] !== undefined && set.has(String(row[col]));
    }
    default:
      throw new Error(`fake-count-client: unsupported or-operator '${op}'`);
  }
}

export function parseOrFilter(filter: string): Predicate {
  const terms = splitTopLevel(filter).map(parseTerm);
  return (row) => terms.some((p) => p(row));
}

export function createFakeCountClient(
  tables: Record<string, FakeRow[]>,
  opts: {
    failTables?: string[];
    rpc?: Record<string, (args: Record<string, unknown> | undefined) => FakeRpcResult>;
  } = {},
): FakeCountClient {
  const calls: RecordedQuery[] = [];
  const rpcCalls: FakeCountClient['rpcCalls'] = [];

  function rpc(fn: string, args?: Record<string, unknown>): Promise<FakeRpcResult> {
    rpcCalls.push({ fn, args });
    const handler = opts.rpc?.[fn];
    return Promise.resolve(handler ? handler(args) : { data: null, error: { message: `no rpc ${fn}` } });
  }

  function from(table: string) {
    const rec: RecordedQuery = { table, columns: undefined, selectOptions: undefined, filters: [] };
    calls.push(rec);
    const preds: Predicate[] = [];
    const sorts: Array<{ col: string; ascending: boolean; nullsFirst: boolean }> = [];
    let slice: { from: number; to: number } | null = null;
    let single = false;

    const builder: Record<string, unknown> = {
      select(columns?: string, options?: { count?: string; head?: boolean }) {
        rec.columns = columns;
        rec.selectOptions = options;
        return builder;
      },
      eq(col: string, v: unknown) {
        rec.filters.push({ op: 'eq', args: [col, v] });
        preds.push((r) => get(r, col) === v);
        return builder;
      },
      neq(col: string, v: unknown) {
        rec.filters.push({ op: 'neq', args: [col, v] });
        preds.push((r) => get(r, col) !== v);
        return builder;
      },
      in(col: string, vs: unknown[]) {
        rec.filters.push({ op: 'in', args: [col, vs] });
        preds.push((r) => vs.includes(get(r, col)));
        return builder;
      },
      gte(col: string, v: unknown) {
        rec.filters.push({ op: 'gte', args: [col, v] });
        preds.push((r) => {
          const x = get(r, col);
          return x !== null && x !== undefined && compare(x, v) >= 0;
        });
        return builder;
      },
      lt(col: string, v: unknown) {
        rec.filters.push({ op: 'lt', args: [col, v] });
        preds.push((r) => {
          const x = get(r, col);
          return x !== null && x !== undefined && compare(x, v) < 0;
        });
        return builder;
      },
      lte(col: string, v: unknown) {
        rec.filters.push({ op: 'lte', args: [col, v] });
        preds.push((r) => {
          const x = get(r, col);
          return x !== null && x !== undefined && compare(x, v) <= 0;
        });
        return builder;
      },
      is(col: string, v: null) {
        rec.filters.push({ op: 'is', args: [col, v] });
        preds.push((r) => (get(r, col) ?? null) === v);
        return builder;
      },
      not(col: string, op: string, v: unknown) {
        rec.filters.push({ op: 'not', args: [col, op, v] });
        if (op !== 'is') throw new Error(`fake-count-client: unsupported not-operator '${op}'`);
        preds.push((r) => (get(r, col) ?? null) !== v);
        return builder;
      },
      or(filter: string) {
        rec.filters.push({ op: 'or', args: [filter] });
        preds.push(parseOrFilter(filter));
        return builder;
      },
      order(col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
        const ascending = o.ascending ?? true;
        // PostgREST default: NULLS LAST ascending, NULLS FIRST descending.
        sorts.push({ col, ascending, nullsFirst: o.nullsFirst ?? !ascending });
        return builder;
      },
      range(from: number, to: number) {
        slice = { from, to };
        return builder;
      },
      limit(n: number) {
        slice = { from: 0, to: n - 1 };
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const result = (() => {
          if (opts.failTables?.includes(table)) {
            return { data: null, count: null, error: { message: 'boom' } };
          }
          const matched = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          const sorted = [...matched].sort((a, b) => {
            for (const s of sorts) {
              const x = get(a, s.col) ?? null;
              const y = get(b, s.col) ?? null;
              if (x === y) continue;
              if (x === null) return s.nullsFirst ? -1 : 1;
              if (y === null) return s.nullsFirst ? 1 : -1;
              const c = compare(x, y);
              if (c !== 0) return s.ascending ? c : -c;
            }
            return 0;
          });
          const w = slice as { from: number; to: number } | null;
          const rows = w ? sorted.slice(w.from, w.to + 1) : sorted;
          const head = rec.selectOptions?.head === true;
          return {
            data: head ? null : single ? (rows[0] ?? null) : rows,
            count: rec.selectOptions?.count ? matched.length : null,
            error: null,
          };
        })();
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { client: { from, rpc }, calls, rpcCalls };
}

// Every leaf of a core's result must be a number, null, or one of the allowed
// enum literals — never free text (names, emails, phones, URLs, message
// bodies). Returns the offending paths.
export function nonNumericLeaves(value: unknown, allowedStrings: readonly string[] = [], path = ''): string[] {
  if (value === null || typeof value === 'number') return [];
  if (typeof value === 'string') return allowedStrings.includes(value) ? [] : [path || '<root>'];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => nonNumericLeaves(v, allowedStrings, `${path}[${i}]`));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      nonNumericLeaves(v, allowedStrings, path ? `${path}.${k}` : k),
    );
  }
  return [path || '<root>'];
}
