import { describe, expect, it, vi } from 'vitest';

// voximplant-balance.ts begins with `import 'server-only'` — stub it
// (established convention: outreach-calls.test.ts). The collaborators are not
// touched here — evaluateBalanceAlert is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { evaluateBalanceAlert } from './voximplant-balance';

// Pure threshold decision shared by the H2 cron and the B5 account-callback
// route (plan stage 0). Thresholds mirror the live defaults: reserve 0.10,
// low-balance 5.0.
const cfg = { minCallReserve: 0.1, lowBalanceThreshold: 5.0 };

describe('evaluateBalanceAlert', () => {
  it('is silent when the balance is healthy', () => {
    expect(evaluateBalanceAlert({ balance: 9.5, ...cfg })).toBeNull();
  });

  it('warns between reserve and low-balance threshold', () => {
    const d = evaluateBalanceAlert({ balance: 2.88, ...cfg });
    expect(d).toMatchObject({ level: 'warn', title: 'Voximplant balance low' });
    expect(d?.fields.balance).toBeCloseTo(2.88);
  });

  it('errors below the reserve (calls blocked)', () => {
    const d = evaluateBalanceAlert({ balance: 0.05, ...cfg });
    expect(d).toMatchObject({
      level: 'error',
      title: 'Voximplant balance below reserve — calls blocked',
    });
  });

  it('boundary: exactly at a threshold does NOT alert for that threshold', () => {
    // balance === reserve → not below reserve; still below low threshold → warn
    expect(evaluateBalanceAlert({ balance: 0.1, ...cfg })).toMatchObject({ level: 'warn' });
    // balance === low threshold → silent
    expect(evaluateBalanceAlert({ balance: 5.0, ...cfg })).toBeNull();
  });

  it('surfaces an unknown (null) balance loudly instead of staying silent', () => {
    const d = evaluateBalanceAlert({ balance: null, ...cfg });
    expect(d).toMatchObject({ level: 'warn', title: 'Voximplant balance unknown' });
  });
});
