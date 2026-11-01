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
  // The webhook inspector (/admin/webhooks): reading the durable inbox. A failed row's last_error is a field with its
  // own read rule (PLATFORM_READ_FIELDS below).
  WebhookInbox: {
    read: 'view_webhooks',
  },
  // Re-running a stored webhook through the pipeline. Its side effects include RSVP writes and billing, so it takes a
  // managing key, not the inspector's viewing one.
  Webhook: {
    replay: 'manage_settings',
  },
} as const satisfies Record<string, Record<string, PlatformPermissionKey>>;

export type PlatformSubject = keyof typeof PLATFORM_ACTIONS;
export type PlatformAction<S extends PlatformSubject = PlatformSubject> = keyof (typeof PLATFORM_ACTIONS)[S];

// One [action, subject] tuple per subject, so an action is only valid on the subject that declares it.
export type PlatformAbilityTuple ={ [S in PlatformSubject]: [PlatformAction<S>, S] }[PlatformSubject];
export type PlatformAbility = MongoAbility<PlatformAbilityTuple>;

// Subjects with a `read` action — the only ones a field can be withheld from.
type ReadableSubject = { [S in PlatformSubject]: 'read' extends PlatformAction<S> ? S : never }[PlatformSubject];

// Fields whose READ needs a key of its own, on top of the subject's `read` — CASL's field-level rules (docs:
// guide/restricting-fields). They are diagnostic: a failed webhook row's last_error carries the Supabase/Postgres cause
// behind the data layer's Hebrew message (src/lib/error-detail.ts). The server withholds a field the caller may not
// read — ability.can('read', subject, field) — before anything reaches the browser. A field bound to its subject's own
// read key changes no access today (owner, 30.10.2026: view_webhooks is the inspector's diagnostic key); splitting it
// later is a one-line edit here plus a grant migration.
export type PlatformReadFields = { [S in ReadableSubject]?: Readonly<Record<string, PlatformPermissionKey>> };

export const PLATFORM_READ_FIELDS = {
  WebhookInbox: { last_error: 'view_webhooks' },
} as const satisfies PlatformReadFields;

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

// Every key the map reads — the actions' and the fields' — which is the set an ability is built from.
export const PLATFORM_MAP_KEYS: readonly PlatformPermissionKey[] = [
  ...new Set<PlatformPermissionKey>([
    ...PLATFORM_ACTION_PAIRS.map((p) => p.key),
    ...Object.values(PLATFORM_READ_FIELDS).flatMap((fields) => Object.values(fields) as PlatformPermissionKey[]),
  ]),
];

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
 * A key absent from `held` adds no rule: default deny. `readFields` is the field map, replaced only by a test that
 * needs a field bound to a key other than its subject's read.
 */
export function buildPlatformAbility(
  held: ReadonlySet<string>,
  readFields: PlatformReadFields = PLATFORM_READ_FIELDS,
): PlatformAbility {
  const { can, cannot, build } = new AbilityBuilder<PlatformAbility>(createMongoAbility);

  for (const { subject, action, key } of PLATFORM_ACTION_PAIRS) {
    if (held.has(key)) {
      can(action, subject);
    }
  }

  // A withheld field is an inverted rule, and only for a caller who may read the subject at all: without the read
  // there is nothing to withhold from (default deny), so an empty set of keys still yields no rule.
  for (const subject of Object.keys(readFields) as ReadableSubject[]) {
    if (!held.has(PLATFORM_ACTIONS[subject].read)) continue;
    for (const [field, key] of Object.entries(readFields[subject] ?? {})) {
      if (!held.has(key)) cannot('read', subject, field);
    }
  }

  return build();
}
