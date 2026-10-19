import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';

import {
  isPlatformPermissionKey,
  type PlatformPermissionKey,
} from '@/lib/auth/platform-permission-keys.generated';
import {
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_PAIRS,
  buildPlatformAbility,
  type PlatformAbility,
} from './casl';

// The action map is the one place the package flow names a permission key. These cases pin what the map
// may hold and prove that an ability built from it decides exactly what the key alone decides — the same
// answer the server gate gets from requirePlatformPermission(key) — for every combination of held keys.

// Every key the map uses, plus view_billing: a key a viewer may hold that the map does NOT bind, so the
// matrix also proves that holding an unrelated key grants no package action.
const KEYS: PlatformPermissionKey[] = [
  ...new Set<PlatformPermissionKey>([...PLATFORM_ACTION_PAIRS.map((p) => p.key), 'view_billing']),
];

function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
}

describe('PLATFORM_ACTIONS', () => {
  it('binds every action to a key of the generated catalogue', () => {
    expect(PLATFORM_ACTION_PAIRS.length).toBeGreaterThan(0);
    for (const { subject, action, key } of PLATFORM_ACTION_PAIRS) {
      expect(isPlatformPermissionKey(key), `${action} ${subject} -> ${key}`).toBe(true);
    }
  });

  it('keeps viewing and editing a package as separate actions', () => {
    expect(Object.keys(PLATFORM_ACTIONS.Package).sort()).toEqual(['create', 'delete', 'read', 'update']);
  });

  // The pilot changes no access: every package action stays on the key every package gate checked before.
  it('binds every Package action to manage_billing', () => {
    expect(PLATFORM_ACTIONS.Package).toEqual({
      read: 'manage_billing',
      create: 'manage_billing',
      update: 'manage_billing',
      delete: 'manage_billing',
    });
  });

  it('lists every (subject, action) of the map exactly once', () => {
    const fromMap = Object.entries(PLATFORM_ACTIONS).flatMap(([subject, actions]) =>
      Object.keys(actions).map((action) => `${action} ${subject}`),
    );
    expect(PLATFORM_ACTION_PAIRS.map((p) => `${p.action} ${p.subject}`).sort()).toEqual(fromMap.sort());
  });
});

describe('buildPlatformAbility', () => {
  for (const held of subsets(KEYS)) {
    it(`decides by the bound key alone when holding [${held.join(', ') || 'nothing'}]`, () => {
      const heldSet = new Set<string>(held);
      const ability = buildPlatformAbility(heldSet);
      for (const { subject, action, key } of PLATFORM_ACTION_PAIRS) {
        expect(ability.can(action, subject), `${action} ${subject}`).toBe(heldSet.has(key));
      }
    });
  }

  it('survives a JSON round trip of its rules, which is how the rules reach the browser', () => {
    for (const held of subsets(KEYS)) {
      const ability = buildPlatformAbility(new Set<string>(held));
      const rebuilt = createMongoAbility<PlatformAbility>(JSON.parse(JSON.stringify(ability.rules)));
      for (const { subject, action } of PLATFORM_ACTION_PAIRS) {
        expect(rebuilt.can(action, subject)).toBe(ability.can(action, subject));
      }
    }
  });

  it('holds no rule of its own: an unknown or empty set of keys grants nothing', () => {
    expect(buildPlatformAbility(new Set()).rules).toEqual([]);
    expect(buildPlatformAbility(new Set(['not_a_key'])).rules).toEqual([]);
  });
});
