import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';

import {
  isPlatformPermissionKey,
  type PlatformPermissionKey,
} from '@/lib/auth/platform-permission-keys.generated';
import {
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_PAIRS,
  PLATFORM_MAP_KEYS,
  PLATFORM_READ_FIELDS,
  buildPlatformAbility,
  type PlatformAbility,
} from './casl';

// The action map is the one place the package flow names a permission key. These cases pin what the map
// may hold and prove that an ability built from it decides exactly what the key alone decides — the same
// answer the server gate gets from requirePlatformPermission(key) — for every combination of held keys.

// Every key the map uses, plus view_billing: a key a viewer may hold that the map does NOT bind, so the
// matrix also proves that holding an unrelated key grants no package action.
const KEYS: PlatformPermissionKey[] = [...new Set<PlatformPermissionKey>([...PLATFORM_MAP_KEYS, 'view_billing'])];

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

  // Moving the campaign run-state gates onto the map changes no access: the action is bound to the key every one of
  // those gates checked before (staff pause/close/cancel on the web, the console revival and pause).
  it('binds the Campaign run state to campaigns.runstate', () => {
    expect(PLATFORM_ACTIONS.Campaign).toEqual({ runstate: 'campaigns.runstate' });
  });

  // Moving the webhook inspector onto the map changes no access: reading stays on view_webhooks, the page's and the
  // data layer's key, and reprocessing on manage_settings, the key its action checked.
  it('binds the webhook inspector to view_webhooks and reprocessing to manage_settings', () => {
    expect(PLATFORM_ACTIONS.WebhookInbox).toEqual({ read: 'view_webhooks' });
    expect(PLATFORM_ACTIONS.Webhook).toEqual({ replay: 'manage_settings' });
  });

  // last_error is diagnostic (the Supabase/Postgres cause); view_webhooks is the inspector's diagnostic key
  // (owner, 30.10.2026).
  it('binds the read of a webhook row last_error to view_webhooks', () => {
    expect(PLATFORM_READ_FIELDS).toEqual({ WebhookInbox: { last_error: 'view_webhooks' } });
  });

  it('builds the ability from every key the map reads, the field rules included', () => {
    for (const fields of Object.values(PLATFORM_READ_FIELDS)) {
      for (const key of Object.values(fields)) expect(PLATFORM_MAP_KEYS).toContain(key);
    }
    for (const { key } of PLATFORM_ACTION_PAIRS) expect(PLATFORM_MAP_KEYS).toContain(key);
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

  it('lets a field be read only with its own key, for every combination of held keys', () => {
    for (const held of subsets(KEYS)) {
      const heldSet = new Set<string>(held);
      const ability = buildPlatformAbility(heldSet);
      for (const subject of Object.keys(PLATFORM_READ_FIELDS) as (keyof typeof PLATFORM_READ_FIELDS)[]) {
        const readKey = PLATFORM_ACTIONS[subject].read;
        for (const [field, key] of Object.entries(PLATFORM_READ_FIELDS[subject])) {
          expect(ability.can('read', subject, field), `${subject}.${field}`).toBe(
            heldSet.has(readKey) && heldSet.has(key),
          );
        }
      }
    }
  });

  // The mechanism, with a field bound to a key other than its subject's read (as a later split would do): the
  // subject stays readable, the field is withheld, and holding both keys reads it.
  describe('a field bound to a key of its own', () => {
    const split = { WebhookInbox: { last_error: 'manage_settings' } } as const;

    it('withholds the field from a reader without its key, without hiding the subject', () => {
      const ability = buildPlatformAbility(new Set(['view_webhooks']), split);
      expect(ability.can('read', 'WebhookInbox')).toBe(true);
      expect(ability.can('read', 'WebhookInbox', 'last_error')).toBe(false);
      expect(ability.can('read', 'WebhookInbox', 'received_at')).toBe(true);
    });

    it('lets a reader who holds both keys read it', () => {
      const ability = buildPlatformAbility(new Set(['view_webhooks', 'manage_settings']), split);
      expect(ability.can('read', 'WebhookInbox', 'last_error')).toBe(true);
    });

    it('adds no rule for a caller who cannot read the subject at all', () => {
      expect(buildPlatformAbility(new Set(['manage_settings']), split).can('read', 'WebhookInbox', 'last_error')).toBe(
        false,
      );
      expect(buildPlatformAbility(new Set(), split).rules).toEqual([]);
    });

    it('survives the JSON round trip that carries the rules to the browser', () => {
      const ability = buildPlatformAbility(new Set(['view_webhooks']), split);
      const rebuilt = createMongoAbility<PlatformAbility>(JSON.parse(JSON.stringify(ability.rules)));
      expect(rebuilt.can('read', 'WebhookInbox')).toBe(true);
      expect(rebuilt.can('read', 'WebhookInbox', 'last_error')).toBe(false);
    });
  });

  it('holds no rule of its own: an unknown or empty set of keys grants nothing', () => {
    expect(buildPlatformAbility(new Set()).rules).toEqual([]);
    expect(buildPlatformAbility(new Set(['not_a_key'])).rules).toEqual([]);
  });
});
