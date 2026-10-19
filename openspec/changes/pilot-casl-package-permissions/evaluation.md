# Evaluation

## 1.1 Release notes vs. the installed APIs (19.10.2026)

Sources:
- the GitHub releases page of `stalniy/casl`;
- `packages/casl-ability/CHANGELOG.md` and `packages/casl-react/CHANGELOG.md` on `master`;
- `node_modules/@casl/*/dist`.

**`@casl/ability`**

| Version | Date | What the release notes say |
|---|---|---|
| 7.0.2 | 2026-10-15 | One bug fix: "prevent rulesToFields to set properties on prototype and non-objects". Not breaking. |
| 7.0.1 | 2026-06-10 | Package metadata only. |
| 7.0.0 | 2026-05-21 | Breaking, see below. |

The 7.0.0 breaking changes:
- `PureAbility` is renamed to `Ability`, which has no default options. Clients that want the previous `Ability` behaviour use `createMongoAbility` and the `MongoAbility` type. Design D1 already uses exactly these.
- `rulesFor` and `possibleRulesFor` return `readonly Rule[]`.
- `rulesToQuery` is replaced by `rulesToCondition`. The pilot does not use it.
- Conditions that semantically match everything are treated like a rule without conditions. The pilot has no conditions.

**`@casl/react`**

| Version | Date | What the release notes say |
|---|---|---|
| 7.0.1 | 2026-06-10 | Package metadata only. |
| 7.0.0 | 2026-05-21 | Breaking, see below. |

The 7.0.0 breaking changes:
- `createContextualCan` is replaced by `<AbilityProvider>`, and `useAbility` no longer takes a context argument.
- `<Can>` no longer takes an `ability` prop; it reads the ability through `useAbility`.

**Against the installed packages:**
- `@casl/ability` 7.0.2 exports `createMongoAbility`, `AbilityBuilder` and `MongoAbility`
  (`dist/types/index.d.ts`, `createMongoAbility.d.ts`, `AbilityBuilder.d.ts`).
- `@casl/react` 7.0.1 exports `AbilityProvider`, `Can` and `useAbility`. `AbilityProvider` reads
  `{ children, value }` (`dist/esm/index.mjs`, `dist/types/hooks/useAbility.d.ts`). One README section
  still shows the older `ability=` prop.
- The `@casl/react` bundle has no `'use client'` directive.

**Result:** the APIs in design D1 and D5 match the installed packages. Nothing differs, so 1.2 can start.
