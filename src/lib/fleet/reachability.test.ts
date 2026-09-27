import { describe, expect, it } from 'vitest';

import type { FleetRoleInfo } from './handoff';
import { reachability } from './reachability';

const role = (overrides: Partial<FleetRoleInfo> = {}): FleetRoleInfo => ({
  name: 'ops-monitor',
  enabled: true,
  tier: 0,
  reactive: [],
  scheduleSlots: 0,
  ...overrides,
});

describe('reachability', () => {
  it('blocks an unknown or disabled role', () => {
    expect(reachability(undefined).tone).toBe('blocked');
    expect(reachability(role({ enabled: false }))).toMatchObject({ tone: 'blocked', status: 'כבוי' });
  });

  it('is fast only for the matching reactive trigger', () => {
    expect(reachability(role({ reactive: ['owner_direct_request'] })).text).toContain('תוך כדקה');
    expect(reachability(role({ reactive: ['goal_due'] }), 'owner_direct_request').tone).toBe('warn');
    expect(reachability(role({ reactive: ['goal_due'] }), 'goal_due').text).toBe(
      'יצירת המטרה תפעיל את הסוכן — תוך כדקה',
    );
  });

  it('falls back to the next scheduled slot, then to manual runs', () => {
    expect(reachability(role({ scheduleSlots: 2 }))).toMatchObject({ tone: 'ok', status: 'מתוזמן' });
    expect(reachability(role())).toMatchObject({ tone: 'warn', status: 'הרצה ידנית בלבד' });
  });
});
