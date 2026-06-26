import { vi } from 'vitest';

// Reusable test double for the Supabase server client, sufficient for unit
// testing the ownership-scoped data layer without a real database.
//
// PostgREST query builders are thenables: you can `await` them at any point in
// the chain and they resolve to `{ data, error }`. We mirror that — every chain
// method (`select`, `eq`, `order`, `range`, `insert`, `single`, ...) is a spy
// that returns the SAME builder, and the builder itself is awaitable. This lets
// a single stub serve any chain shape (e.g. `.select().eq().order().range()` or
// `.insert().select().single()`).
//
// IMPORTANT: the client and the query builder are kept as two separate objects.
// Only the builder is thenable. If the client were thenable, mocking
// `createClient` with `mockResolvedValue(client)` would await the client's
// `.then` and resolve to the query result instead of the client itself.

// Generic result shape returned when a builder is awaited. `count` mirrors
// PostgREST's `{ count: 'exact' }` option used by list/report queries.
export interface QueryResult<Row> {
  data: Row | null;
  error: { message: string } | null;
  count?: number | null;
}

// The chain methods we stub. Each returns the builder for fluent chaining.
const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'upsert',
  'eq',
  'neq',
  'gte',
  'lte',
  'or',
  'not',
  'ilike',
  'in',
  'order',
  'range',
  'limit',
  'single',
  'maybeSingle',
] as const;

type ChainMethod = (typeof CHAIN_METHODS)[number];

// A query builder: chain spies plus a `then` so it can be awaited.
export type MockQueryBuilder<Row> = {
  [K in ChainMethod]: ReturnType<typeof vi.fn>;
} & {
  then: (
    onFulfilled: (value: QueryResult<Row>) => unknown,
  ) => unknown;
};

export interface MockSupabase<Row> {
  /**
   * The stubbed client; pass where `createClient()` would resolve. `rpc` is a
   * plain spy (RPCs are awaited directly, not chained) — configure per test with
   * `client.rpc.mockResolvedValue({ data, error })`.
   */
  client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  /** The shared query builder; assert against its chain-method spies. */
  builder: MockQueryBuilder<Row>;
}

/**
 * Build a Supabase server-client double whose awaited chains resolve to
 * `result`. Wire it into a test with:
 *
 *   vi.mocked(createClient).mockResolvedValue(
 *     client as unknown as Awaited<ReturnType<typeof createClient>>,
 *   );
 *
 * and assert ownership scoping via the builder spies, e.g.
 *   expect(builder.eq).toHaveBeenCalledWith('owner_id', user.id);
 */
export function createMockSupabase<Row>(
  result: QueryResult<Row>,
): MockSupabase<Row> {
  // Built incrementally so each chain spy can return the same builder.
  const builder = {} as MockQueryBuilder<Row>;

  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }

  // Make the builder awaitable; resolving with the configured result.
  builder.then = (onFulfilled) => onFulfilled(result);

  const client = {
    from: vi.fn(() => builder),
    // Default no-op RPC; tests override with mockResolvedValue.
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };

  return { client, builder };
}
