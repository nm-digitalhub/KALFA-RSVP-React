import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/console-calls', () => ({
  CALLBACK_MAX_ATTEMPTS: 3,
  CONSOLE_DIAL_AUDIT_ACTION: 'console_call.dial_intent',
}));

import { DISPATCH_PRE_TERMINAL } from './sales-call-attempts';

// Mirrors call_attempts.PRE_TERMINAL and callback_request_attempts'
// DISPATCH_PRE_TERMINAL exactly — see sales_call_attempts_dispatch_status_valid
// (migration 20260822104725) for the CHECK constraint this must stay in sync
// with.
describe('DISPATCH_PRE_TERMINAL', () => {
  it('matches call_attempts.PRE_TERMINAL exactly', () => {
    expect(DISPATCH_PRE_TERMINAL).toEqual(['queued', 'dialing', 'in_progress']);
  });
});
