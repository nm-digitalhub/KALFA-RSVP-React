import { describe, expect, it, vi } from 'vitest';

// call-attempts.ts begins with `import 'server-only'` — stub it (convention:
// call-result-processing.test.ts). createAdminClient itself only throws when
// CALLED (missing env), not at import time, so no admin mock is needed for
// this file: it only exercises the exported TERMINAL_STATUSES constant.
vi.mock('server-only', () => ({}));

import { TERMINAL_STATUSES } from './call-attempts';

// Stage 6: 'handed_off' (a KALFA console agent took over the call) must be
// terminal — otherwise recordCallOutcome's compare-and-set guard (the CAS
// that stops a stale/out-of-order callback from downgrading a row that
// already reached a terminal state) would NOT protect a handed-off row, and
// a late legitimate-looking callback could downgrade it. Every consumer of
// this set (the /api/calls/{id}/{end,monitor,agent-command} 409 guards,
// vox-log-export.ts's eligibility filter) is documented at the declaration
// site in call-attempts.ts.
describe('TERMINAL_STATUSES', () => {
  it('includes handed_off (Stage 6 AI→human handoff billing)', () => {
    expect(TERMINAL_STATUSES).toContain('handed_off');
  });

  it('still includes every pre-existing terminal status (no accidental removal)', () => {
    expect(TERMINAL_STATUSES).toEqual(
      expect.arrayContaining(['completed', 'failed', 'no_answer', 'no_response', 'cancelled']),
    );
  });
});
