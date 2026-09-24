// A FILTER-AWARE Supabase double for count/aggregate parity tests.
//
// createMockSupabase (./supabase-mock.ts) answers every query with one canned
// result, so "wrapper and core return the same number" would pass even if
// their filters differed. This fake holds real rows per table and actually
// applies the filters a query chains (eq / in / gte / lte / or), so two
// callers agree only when their predicates agree.
//
// Supported: select(cols, { count, head }), eq, neq, in, gte, lt, lte, or,
// order, range, limit — enough for the owner-agent cores and the admin
// wrappers that share them. `or` understands the PostgREST subset those use:
// comma-separated terms of `col.op.value`, `col.in.(a,b)` and `and(t1,t2)`.
//
// Every query is recorded in `calls` (table, select options, filters) so a
// test can pin the query shape too.

export type FakeRow = Record<string, unknown>;

type Predicate = (row: FakeRow) => boolean;

export interface RecordedQuery {
  table: string;
  columns: string | undefined;
  selectOptions: { count?: string; head?: boolean } | undefined;
  filters: Array<{ op: string; args: unknown[] }>;
}

export interface FakeCountClient {
  client: { from: (table: string) => unknown };
  calls: RecordedQuery[];
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
  opts: { failTables?: string[] } = {},
): FakeCountClient {
  const calls: RecordedQuery[] = [];

  function from(table: string) {
    const rec: RecordedQuery = { table, columns: undefined, selectOptions: undefined, filters: [] };
    calls.push(rec);
    const preds: Predicate[] = [];

    const builder: Record<string, unknown> = {
      select(columns?: string, options?: { count?: string; head?: boolean }) {
        rec.columns = columns;
        rec.selectOptions = options;
        return builder;
      },
      eq(col: string, v: unknown) {
        rec.filters.push({ op: 'eq', args: [col, v] });
        preds.push((r) => r[col] === v);
        return builder;
      },
      neq(col: string, v: unknown) {
        rec.filters.push({ op: 'neq', args: [col, v] });
        preds.push((r) => r[col] !== v);
        return builder;
      },
      in(col: string, vs: unknown[]) {
        rec.filters.push({ op: 'in', args: [col, vs] });
        preds.push((r) => vs.includes(r[col]));
        return builder;
      },
      gte(col: string, v: unknown) {
        rec.filters.push({ op: 'gte', args: [col, v] });
        preds.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) >= 0);
        return builder;
      },
      lt(col: string, v: unknown) {
        rec.filters.push({ op: 'lt', args: [col, v] });
        preds.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) < 0);
        return builder;
      },
      lte(col: string, v: unknown) {
        rec.filters.push({ op: 'lte', args: [col, v] });
        preds.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) <= 0);
        return builder;
      },
      or(filter: string) {
        rec.filters.push({ op: 'or', args: [filter] });
        preds.push(parseOrFilter(filter));
        return builder;
      },
      order() {
        return builder;
      },
      range() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const result = (() => {
          if (opts.failTables?.includes(table)) {
            return { data: null, count: null, error: { message: 'boom' } };
          }
          const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          const head = rec.selectOptions?.head === true;
          return {
            data: head ? null : rows,
            count: rec.selectOptions?.count ? rows.length : null,
            error: null,
          };
        })();
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { client: { from }, calls };
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
