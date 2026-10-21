import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const sendSlackAlert = vi.fn();
const readDeployId = vi.fn(() => null as string | null);
vi.mock('@/lib/alerts/slack', () => ({
  sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args),
  readDeployId: () => readDeployId(),
}));

const opsErrorInsert = vi.fn((_table: string, _row: unknown) => Promise.resolve({ error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => opsErrorInsert(table, row),
    }),
  }),
}));

// register()'s startup check must never construct a database client or a pg-boss
// instance — these count any attempt.
const db = vi.hoisted(() => ({ pgClients: 0, bosses: 0 }));
vi.mock('pg', () => ({
  Client: class {
    constructor() {
      db.pgClients++;
    }
  },
  Pool: class {
    constructor() {
      db.pgClients++;
    }
  },
}));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor() {
      db.bosses++;
    }
  },
}));

import {
  register,
  isDestinationStreamClosedError,
  isRouterStateParseError,
  isClientDisconnectError,
  isUnknownServerActionError,
  onRequestError,
} from './instrumentation';

// Guards the ops-alert filter for Next's benign "Failed to find Server Action"
// (E974/E975): forged/scanner action ids and cross-deploy skew must NOT page ops,
// while every genuine render error must still alert.
describe('isUnknownServerActionError', () => {
  it('matches E975 (thrown MPA form-action path) by framework code', () => {
    expect(
      isUnknownServerActionError({
        __NEXT_ERROR_CODE: 'E975',
        message:
          'Failed to find Server Action. This request might be from an older or newer deployment.',
      }),
    ).toBe(true);
  });

  it('matches E974 (fetch-action path) by framework code', () => {
    expect(
      isUnknownServerActionError({ __NEXT_ERROR_CODE: 'E974', message: 'anything' }),
    ).toBe(true);
  });

  it('matches by message prefix when the code is absent (forward-compat)', () => {
    expect(
      isUnknownServerActionError({
        message: 'Failed to find Server Action. This request might be from ...',
      }),
    ).toBe(true);
  });

  it('does NOT match a generic render error — real errors still alert', () => {
    expect(
      isUnknownServerActionError({
        __NEXT_ERROR_CODE: 'E999',
        message: "Cannot read properties of undefined (reading 'x')",
      }),
    ).toBe(false);
  });

  it('does NOT match an unrelated error with no code', () => {
    expect(isUnknownServerActionError({ message: 'boom' })).toBe(false);
  });

  it('handles a missing message and missing code safely', () => {
    expect(isUnknownServerActionError({})).toBe(false);
  });
});

// Guards the ops-alert filter for React/Next's "destination stream closed
// early" render error — a client disconnect mid-RSC-stream (aborted prefetch,
// navigation away, closed tab) that React's cancel handler throws as a plain
// Error React/Next's own isAbortError() doesn't recognize (see the doc
// comment on isDestinationStreamClosedError). Exact-match only.
describe('isDestinationStreamClosedError', () => {
  it('matches the exact observed message', () => {
    expect(
      isDestinationStreamClosedError({ message: 'The destination stream closed early.' }),
    ).toBe(true);
  });

  it('does NOT match the sibling write-error message (left at full severity)', () => {
    expect(
      isDestinationStreamClosedError({
        message: 'The destination stream errored while writing data.',
      }),
    ).toBe(false);
  });

  it('does NOT match a generic render error — real errors still alert', () => {
    expect(
      isDestinationStreamClosedError({
        message: "Cannot read properties of undefined (reading 'x')",
      }),
    ).toBe(false);
  });

  it('handles a missing message safely', () => {
    expect(isDestinationStreamClosedError({})).toBe(false);
  });
});

// Guards the ops-alert filter for a client that closed the socket mid-request.
// MEASURED 2026-08-17: the alert fired 668ms after the native console wrote its own
// `app.crash` line, i.e. the severed upload WAS the app dying — see the doc comment on
// isClientDisconnectError.
describe('isClientDisconnectError', () => {
  it('matches Node\'s inbound-abort signature, with the code alongside it', () => {
    expect(isClientDisconnectError({ message: 'aborted', code: 'ECONNRESET' })).toBe(true);
  });

  it('matches on the message alone when Next did not preserve the code', () => {
    expect(isClientDisconnectError({ message: 'aborted' })).toBe(true);
  });

  // THE case this predicate exists to get right. ECONNRESET is equally what an
  // OUTBOUND call gets when Supabase / SUMIT / Voximplant resets us mid-flight, and
  // that is a real server fault that must keep paging. Keying on the code alone would
  // have silenced it — and an alert filter that fails toward silence is the dangerous
  // kind.
  it('does NOT suppress a server-side fault that merely carries ECONNRESET', () => {
    expect(
      isClientDisconnectError({ message: 'Database query failed', code: 'ECONNRESET' }),
    ).toBe(false);
  });

  it('does NOT suppress an outbound reset, which reads as a hang-up rather than an abort', () => {
    expect(isClientDisconnectError({ message: 'socket hang up', code: 'ECONNRESET' })).toBe(false);
  });

  it('does NOT suppress an ordinary application error', () => {
    expect(isClientDisconnectError({ message: 'Invalid telemetry payload' })).toBe(false);
  });

  it('does NOT match an empty or absent message', () => {
    expect(isClientDisconnectError({ code: 'ECONNRESET' })).toBe(false);
    expect(isClientDisconnectError({})).toBe(false);
  });
});

// Guards the ops-alert filter for Next's "router state header was sent but
// could not be parsed" (E10) — a stale/foreign RSC request Next throws on
// before any component renders, dominated by non-genuine traffic replaying a
// captured `_rsc=` URL (see the doc comment on isRouterStateParseError).
describe('isRouterStateParseError', () => {
  it('matches E10 (framework code) regardless of message', () => {
    expect(isRouterStateParseError({ __NEXT_ERROR_CODE: 'E10', message: 'anything' })).toBe(true);
  });

  it('matches by exact message when the code is absent (forward-compat)', () => {
    expect(
      isRouterStateParseError({
        message: 'The router state header was sent but could not be parsed.',
      }),
    ).toBe(true);
  });

  it('does NOT match a generic render error — real errors still alert', () => {
    expect(
      isRouterStateParseError({
        __NEXT_ERROR_CODE: 'E999',
        message: "Cannot read properties of undefined (reading 'x')",
      }),
    ).toBe(false);
  });

  it('does NOT match the sibling "too large" router-state error (E142)', () => {
    expect(
      isRouterStateParseError({
        __NEXT_ERROR_CODE: 'E142',
        message: 'The router state header was too large.',
      }),
    ).toBe(false);
  });

  it('handles a missing message and missing code safely', () => {
    expect(isRouterStateParseError({})).toBe(false);
  });
});

// The alert level is the actual behavior guests/ops feel: a benign unknown Server
// Action must DOWNGRADE to info (no page), while a real error stays 'error'.
describe('onRequestError alert level', () => {
  // Minimal shapes for Next's onRequestError args (only the read fields matter).
  const req = { method: 'POST', path: '/' } as never;
  const ctx = { routeType: 'render', routePath: '/(public)/page' } as never;

  beforeEach(() => sendSlackAlert.mockClear());

  it('downgrades a benign unknown Server Action to info', async () => {
    await onRequestError(
      {
        name: 'Error',
        __NEXT_ERROR_CODE: 'E975',
        message: 'Failed to find Server Action. This request might be from ...',
      } as never,
      req,
      ctx,
    );
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      level: 'info',
      title: 'Unknown Server Action (benign)',
    });
  });

  it('downgrades a benign destination-stream-closed error to info', async () => {
    await onRequestError(
      { name: 'Error', message: 'The destination stream closed early.' } as never,
      req,
      ctx,
    );
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      level: 'info',
      title: 'Client disconnected mid-stream (benign)',
    });
  });

  it('downgrades a benign router-state-parse error to info', async () => {
    await onRequestError(
      {
        name: 'Error',
        __NEXT_ERROR_CODE: 'E10',
        message: 'The router state header was sent but could not be parsed.',
      } as never,
      req,
      ctx,
    );
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      level: 'info',
      title: 'Unparseable router state header (benign)',
    });
  });

  it('keeps a genuine render error at error level (still pages)', async () => {
    await onRequestError(
      { name: 'TypeError', message: 'Cannot read properties of undefined' } as never,
      req,
      ctx,
    );
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      level: 'error',
      title: 'Unhandled server error',
    });
  });
});

// ops_errors exists specifically because sendSlackAlert's own gates (disabled /
// category off / deduped / rate-capped) mean an alert can be dropped with zero
// trace anywhere — measured live: 135 suppressed alerts in 30 days, none
// recoverable. This write must happen regardless of what Slack does.
describe('onRequestError writes ops_errors independent of Slack', () => {
  const req = { method: 'POST', path: '/' } as never;
  const ctx = { routeType: 'render', routePath: '/(public)/page' } as never;

  beforeEach(() => {
    sendSlackAlert.mockClear();
    opsErrorInsert.mockClear();
    readDeployId.mockReset().mockReturnValue(null);
  });

  it('inserts a PII-safe ops_errors row (no error.message, no headers/body)', async () => {
    readDeployId.mockReturnValue('abc123');
    await onRequestError(
      {
        name: 'TypeError',
        message: "Cannot read properties of undefined (owner: admin@nm-digitalhub.com)",
        digest: 'DIGEST1',
      } as never,
      req,
      ctx,
    );
    expect(opsErrorInsert).toHaveBeenCalledTimes(1);
    const [table, row] = opsErrorInsert.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe('ops_errors');
    expect(row).toMatchObject({
      route_path: '/(public)/page',
      route_type: 'render',
      method: 'POST',
      error_name: 'TypeError',
      digest: 'DIGEST1',
      deploy_id: 'abc123',
    });
    expect(JSON.stringify(row)).not.toContain('admin@nm-digitalhub.com');
  });

  it('still writes ops_errors when the Slack send rejects (e.g. alerting disabled)', async () => {
    sendSlackAlert.mockRejectedValueOnce(new Error('slack not configured'));
    await onRequestError({ name: 'Error', message: 'boom' } as never, req, ctx);
    expect(opsErrorInsert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1); // attempted, but its outcome doesn't gate the write above
  });

  it('writes ops_errors for a benign downgraded Server Action error too', async () => {
    await onRequestError(
      {
        name: 'Error',
        __NEXT_ERROR_CODE: 'E975',
        message: 'Failed to find Server Action. This request might be from ...',
      } as never,
      req,
      ctx,
    );
    expect(opsErrorInsert).toHaveBeenCalledTimes(1);
  });

  it('writes ops_errors for a benign downgraded destination-stream-closed error too', async () => {
    await onRequestError(
      { name: 'Error', message: 'The destination stream closed early.' } as never,
      req,
      ctx,
    );
    expect(opsErrorInsert).toHaveBeenCalledTimes(1);
  });

  it('writes ops_errors for a benign downgraded router-state-parse error too', async () => {
    await onRequestError(
      {
        name: 'Error',
        __NEXT_ERROR_CODE: 'E10',
        message: 'The router state header was sent but could not be parsed.',
      } as never,
      req,
      ctx,
    );
    expect(opsErrorInsert).toHaveBeenCalledTimes(1);
  });
});

describe('register — database configuration startup check (report-only)', () => {
  const FLAG = Symbol.for('kalfa.instrumentation.db-config-checked');
  const POOLER = 'aws-1-ap-south-1.pooler.supabase.com';
  const setEnv = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  };
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  let log: MockInstance<typeof console.log>;
  let err: MockInstance<typeof console.error>;

  beforeEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[FLAG];
    sendSlackAlert.mockReset();
    db.pgClients = 0;
    db.bosses = 0;
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return () => {
      vi.unstubAllEnvs();
      log.mockRestore();
      err.mockRestore();
    };
  });

  it('a refused target is logged and alerted once — the server is not stopped and nothing connects', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: '54322', SUPABASE_DB_PASSWORD: 'pw-secret', SUPABASE_DB_USER: 'postgres.refsecret' });
    await expect(register()).resolves.toBeUndefined(); // report-only: no throw, boot continues
    await flush();
    const line = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toMatch(/\[db-config\] startup check FAILED .*SUPABASE_DB_PORT=54322/);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error', source: 'kalfa-beta-startup' });
    const everything = JSON.stringify([err.mock.calls, log.mock.calls, sendSlackAlert.mock.calls]);
    for (const secret of [POOLER, 'pw-secret', 'postgres.refsecret']) expect(everything).not.toContain(secret);
    expect(db).toEqual({ pgClients: 0, bosses: 0 });
  });

  it('a valid target logs one clear pass line and sends no alert', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: '5432' });
    await register();
    await flush();
    expect(log.mock.calls.map((c) => c.join(' '))).toEqual(['[db-config] startup check passed (web sender database target)']);
    expect(err).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect(db).toEqual({ pgClients: 0, bosses: 0 });
  });

  it('runs once per process: a second register() call is a no-op', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: '54322' });
    await register();
    await register();
    await flush();
    expect(err.mock.calls.filter((c) => String(c[0]).includes('[db-config]'))).toHaveLength(1);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside the Node.js server runtime (edge, or unset)', async () => {
    for (const NEXT_RUNTIME of ['edge', '']) {
      setEnv({ NEXT_RUNTIME, NODE_ENV: 'production', SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: '54322' });
      await register();
    }
    await flush();
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect((globalThis as unknown as Record<symbol, unknown>)[FLAG]).toBeUndefined();
  });

  it('a failing alert transport does not reject register() or delay it', async () => {
    setEnv({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', SUPABASE_DB_HOST: POOLER, SUPABASE_DB_PORT: '54322' });
    sendSlackAlert.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('slack down')), 50)));
    const t0 = Date.now();
    await expect(register()).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(40); // returned before the alert settled
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
});
