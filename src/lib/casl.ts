// src/lib/casl.ts
// Isomorphic: no server-only import, so a client component can rebuild the ability
// from the rules the server hands it. (openspec/changes/pilot-casl-package-permissions, design D1).

import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { PlatformPermissionKey } from '@/lib/auth/platform-permission-keys.generated';

export type { PlatformPermissionKey };

// subject -> action -> the key that action needs. `satisfies` makes every value a key of the
// generated catalogue at compile time.
export const PLATFORM_ACTIONS = {
  Package: {
    read: 'manage_billing',
    create: 'manage_billing',
    update: 'manage_billing',
    delete: 'manage_billing',
  },
  // A campaign's run state: pause, close and cancel (staff on the web) and revival (the console). A claim with no
  // conditions (openspec/changes/casl-console-ability-foundation, design D3).
  Campaign: {
    runstate: 'campaigns.runstate',
  },
} as const satisfies Record<string, Record<string, PlatformPermissionKey>>;

export type PlatformSubject = keyof typeof PLATFORM_ACTIONS;
export type PlatformAction<S extends PlatformSubject = PlatformSubject> = keyof (typeof PLATFORM_ACTIONS)[S];

// One [action, subject] tuple per subject, so an action is only valid on the subject that declares it.
export type PlatformAbilityTuple ={ [S in PlatformSubject]: [PlatformAction<S>, S] }[PlatformSubject];
export type PlatformAbility = MongoAbility<PlatformAbilityTuple>;

export interface PlatformActionPair {
  subject: PlatformSubject;
  action: PlatformAction;
  key: PlatformPermissionKey;
}

// The map flattened, for code that walks every action (the ability below, the tests).
// We cast the mapped subjects and actions strictly to guarantee compile-time alignment.
export const PLATFORM_ACTION_PAIRS: readonly PlatformActionPair[] = (
  Object.keys(PLATFORM_ACTIONS) as PlatformSubject[]
).flatMap((subject) => {
  const actionsMap = PLATFORM_ACTIONS[subject];
  return (Object.keys(actionsMap) as PlatformAction<typeof subject>[]).map((action) => ({
    subject,
    action,
    key: actionsMap[action] as PlatformPermissionKey, // Type safe cast directly matching the catalogue union
  }));
});

// Code that serves both package forms (new and edit) — their readers, the schedule check, the copy rewrite — is
// allowed when the caller may create OR update a package.
export const PACKAGE_FORM_ACTIONS = [
  { action: 'create', subject: 'Package' },
  { action: 'update', subject: 'Package' },
] as const satisfies readonly { action: PlatformAction<'Package'>; subject: 'Package' }[];

// The key an action needs.
export function platformActionKey<S extends PlatformSubject>(
  action: PlatformAction<S>,
  subject: S,
): PlatformPermissionKey {
  return PLATFORM_ACTIONS[subject][action] as PlatformPermissionKey;
}

/**
 * The ability of a caller who holds exactly `held` (the keys the database granted them).
 * A key absent from `held` adds no rule: default deny.
 */
export function buildPlatformAbility(held: ReadonlySet<string>): PlatformAbility {
  const { can, build } = new AbilityBuilder<PlatformAbility>(createMongoAbility);

  for (const { subject, action, key } of PLATFORM_ACTION_PAIRS) {
    if (held.has(key)) {
      can(action, subject);
    }
  }

  return build();
}
