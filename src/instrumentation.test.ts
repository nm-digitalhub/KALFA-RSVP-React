import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  isDestinationStreamClosedError,
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
});
