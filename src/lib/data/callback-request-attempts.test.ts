import { describe, expect, it, vi } from 'vitest';

// callback-request-attempts.ts begins with `import 'server-only'` — stub it
// (convention: call-attempts.test.ts). console-calls.ts is a large shared
// module with its own import chain — stub the two symbols this file actually
// imports from it rather than pull the real module into a unit test.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/console-calls', () => ({
  CALLBACK_MAX_ATTEMPTS: 3,
  CONSOLE_DIAL_AUDIT_ACTION: 'console_call.dial_intent',
}));

import { DISPATCH_PRE_TERMINAL } from './callback-request-attempts';

// Mirrors call_attempts' PRE_TERMINAL exactly (call-attempts.ts) — every
// consumer that guards a CAS update or counts a concurrency slot depends on
// this staying in sync with the dispatch_status CHECK constraint's
// pre-terminal subset (migration 20260822104344). A drift here would either
// let a stuck row escape the concurrency count or let a concluded row be
// clobbered by a stale update.
describe('DISPATCH_PRE_TERMINAL', () => {
  it('matches call_attempts.PRE_TERMINAL exactly', () => {
    expect(DISPATCH_PRE_TERMINAL).toEqual(['queued', 'dialing', 'in_progress']);
  });
});
