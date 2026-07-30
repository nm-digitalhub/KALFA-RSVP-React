import { describe, expect, it } from 'vitest';

import {
  MAIN_HANDOFF_TARGET,
  buildHandoffRequest,
  parseFleetRoleRegistry,
  parseFleetRoles,
  validateHandoffTarget,
  validateRequestRole,
} from './handoff';

const FLEET_JSON = {
  timezone: 'Asia/Jerusalem',
  roles: {
    'business-ops': { enabled: true, tier: 0 },
    'qa-runner': { enabled: true, tier: 1 },
    'dev-engineer': { enabled: false, tier: 1 },
    $creative_comment: 'inline comment, not a role',
  },
};

describe('parseFleetRoles', () => {
  it('maps role names to their enabled flag and skips $-comment keys', () => {
    const roles = parseFleetRoles(FLEET_JSON);
    expect([...roles.keys()].sort()).toEqual(['business-ops', 'dev-engineer', 'qa-runner']);
    expect(roles.get('business-ops')).toBe(true);
    expect(roles.get('dev-engineer')).toBe(false);
  });

  it('throws on non-fleet.json shapes (fail-closed for callers)', () => {
    expect(() => parseFleetRoles(null)).toThrow();
    expect(() => parseFleetRoles([])).toThrow();
    expect(() => parseFleetRoles({})).toThrow();
    expect(() => parseFleetRoles({ roles: 'nope' })).toThrow();
  });
});

describe('parseFleetRoleRegistry', () => {
  it('normalizes reactive to an array regardless of the config shape', () => {
    const roles = parseFleetRoleRegistry({
      roles: {
        'single-string': { enabled: true, tier: 0, reactive: 'goal_due' },
        'already-array': {
          enabled: true,
          tier: 0,
          reactive: ['callback_requests_pending', 'goal_due'],
        },
        'no-trigger': { enabled: true, tier: 0 },
        // The pre-catalog shape, when a role was hardcoded in the scheduler.
        'legacy-boolean': { enabled: true, tier: 0, reactive: true },
      },
    });
    const byName = (name: string) => roles.find((r) => r.name === name);

    expect(byName('single-string')?.reactive).toEqual(['goal_due']);
    expect(byName('already-array')?.reactive).toEqual(['callback_requests_pending', 'goal_due']);
    expect(byName('no-trigger')?.reactive).toEqual([]);
    expect(byName('legacy-boolean')?.reactive).toEqual([]);
  });

  it('drops non-string entries from an array instead of throwing', () => {
    const roles = parseFleetRoleRegistry({
      roles: { mixed: { enabled: true, tier: 0, reactive: ['goal_due', 42, null] } },
    });
    expect(roles[0]?.reactive).toEqual(['goal_due']);
  });
});

describe('validateRequestRole', () => {
  const roles = parseFleetRoles(FLEET_JSON);

  it('accepts defined roles, enabled or not', () => {
    expect(validateRequestRole(roles, 'business-ops')).toBeNull();
    expect(validateRequestRole(roles, 'dev-engineer')).toBeNull();
  });

  it('rejects unknown roles (the dead-letter hole) including main', () => {
    expect(validateRequestRole(roles, 'sumit-billing-expert')).toMatch(/not a fleet role/);
    expect(validateRequestRole(roles, MAIN_HANDOFF_TARGET)).toMatch(/not a fleet role/);
  });
});

describe('validateHandoffTarget', () => {
  const roles = parseFleetRoles(FLEET_JSON);

  it('accepts main and enabled roles', () => {
    expect(validateHandoffTarget(roles, MAIN_HANDOFF_TARGET)).toBeNull();
    expect(validateHandoffTarget(roles, 'qa-runner')).toBeNull();
  });

  it('rejects unknown targets', () => {
    expect(validateHandoffTarget(roles, 'billing-expert')).toMatch(/not a fleet role/);
  });

  it('rejects disabled targets (their verdict would never spawn)', () => {
    expect(validateHandoffTarget(roles, 'dev-engineer')).toMatch(/disabled/);
  });
});

describe('buildHandoffRequest', () => {
  const original = {
    id: '0eaab2a0-062a-400c-951a-b64e65737b7e',
    role: 'business-ops',
    kind: 'approval',
    tier: 0,
    title: 'שחרור תפיסת J5',
    body: 'גוף הפנייה המקורי',
    payload: {},
  };

  it('carries kind/tier and records provenance in title, body and payload', () => {
    const row = buildHandoffRequest(original, MAIN_HANDOFF_TARGET, 'נדרש ביצוע Tier-2');
    expect(row.role).toBe('main');
    expect(row.kind).toBe('approval');
    expect(row.tier).toBe(0);
    expect(row.title).toBe('[העברה מ-business-ops] שחרור תפיסת J5');
    expect(row.body).toContain('נדרש ביצוע Tier-2');
    expect(row.body).toContain(original.id);
    expect(row.body).toContain('גוף הפנייה המקורי');
    expect(row.payload).toMatchObject({
      handoff_from: original.id,
      handoff_from_role: 'business-ops',
      handoff_note: 'נדרש ביצוע Tier-2',
    });
  });

  it('omits the note when not given and carries attachments when present', () => {
    const withAttach = {
      ...original,
      payload: { attachments: [{ path: '.fleet-logs/drafts/a.mp3', label: 'a.mp3' }] },
    };
    const row = buildHandoffRequest(withAttach, 'qa-runner');
    expect(row.payload.handoff_note).toBeUndefined();
    expect(row.payload.attachments).toEqual([
      { path: '.fleet-logs/drafts/a.mp3', label: 'a.mp3' },
    ]);
  });

  it('does not invent attachments from a payload without them', () => {
    const row = buildHandoffRequest(original, 'qa-runner');
    expect('attachments' in row.payload).toBe(false);
  });
});
