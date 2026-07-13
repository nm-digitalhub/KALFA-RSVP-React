import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendSlackAlert = vi.fn();
vi.mock('@/lib/alerts/slack', () => ({
  sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args),
}));

import { isUnknownServerActionError, onRequestError } from './instrumentation';

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
