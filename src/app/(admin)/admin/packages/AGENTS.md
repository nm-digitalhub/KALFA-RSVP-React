# /admin/packages

Admin CRUD for the package catalogue (`packages` table). Shared rules live in the root
AGENTS.md and CLAUDE.md; this file covers only what is specific to this folder.

## Map

- `page.tsx`: list, not paginated (small catalogue). `new/page.tsx`: create. `[id]/page.tsx`: edit + delete.
- `actions.ts`: `createPackageAction`, `updatePackageAction(id, ...)`, `deletePackageAction(id, ...)`.
  The two id actions are pre-bound with `.bind(null, id)` so the client gets `(prevState, formData)`.
- `package-form.tsx`: shared client form for create and edit. Edit mode is decided by `initial !== EMPTY`.
- `package-copy-field.tsx` + `rewrite-action.ts`: the AI rewrite button for `description` / `includes`.
- Data layer: `src/lib/data/admin/packages.ts`. Schemas: `packageBaseSchema`, `operationalFieldsSchema`
  in `src/lib/validation/admin.ts`.

## Authorization (CASL pilot)

This folder is the CASL pilot (`openspec/changes/pilot-casl-package-permissions`).
Every action on subject `Package` maps to a permission key only in `PLATFORM_ACTIONS` in `src/lib/casl.ts`.

- Server gates: `requirePlatformAction(action, 'Package')`, or `requireAnyPlatformAction(PACKAGE_FORM_ACTIONS)`
  for code that serves both forms (create OR update). Never the DAL key gates.
- In a Server Action the gate is the first statement, outside any `try`, so its redirect propagates.
- Page gates are optimistic (early redirect). The real check is repeated in every DAL function.
- Client `<Can<PlatformAbility> I=... a="Package">` hides buttons only. It needs
  `PlatformAbilityProvider` (mounted by `src/components/admin-shell.tsx`; tests wrap it themselves).

`src/lib/casl-pilot-static.test.ts` scans EVERY file under this folder, this one included, and fails when:

- a file contains a platform permission key wrapped in quotes or backticks (keys come from PLATFORM_ACTIONS);
- a file calls the DAL key gate functions directly (requirePlatformPermission, hasPlatformPermission);
- an exported function in `page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `actions.ts` or `rewrite-action.ts`
  does not call `requirePlatformAction` / `requireAnyPlatformAction`.

So a new exported helper belongs in a non-gated file (or must open with a gate), and docs here must
not quote a key. `src/lib/auth/admin-data-layer-coverage.test.ts` guards the DAL side the same way.

## Form contract

- `channels` is a checkbox group: read with `formData.getAll('channels')`, never `get()`.
- `outreach_schedule` is edited as rows and sent as one hidden `outreach_schedule_json` field.
  `readOperationalForm()` parses it; malformed JSON becomes `[]` and Zod rejects it as usual.
- A package with a `contact_quota` is campaign-enabled. Only then:
  the price must be positive (`fixedPriceErrors`), and template keys are checked by
  `validateOutreachScheduleForPackage` (whatsapp only; errors go to `outreach_schedule.<i>.message_key`).
- Catch blocks call `unstable_rethrow(err)` first, so `redirect()` / `notFound()` are not swallowed.
- `deletePackageAction` shows `err.message` to the user. The DAL writes a safe Hebrew message there,
  including the FK case (23503: a campaign, even a closed one, still references the package).
- Create and delete `redirect('/admin/packages')`; update returns `{ notice }` and revalidates both paths.

## AI rewrite

`rewritePackageCopyAction` calls `runPackageCopy` (`src/lib/ai/package-copy.ts`), which spawns the local
`claude` CLI (45 s timeout, at most 2 concurrent users, 1 per user, else `busy`).
Input and output must both pass the field's Zod schema and a 12,000 char ceiling.
For `includes` the line count must not change. Do not run it in tests: they mock `./rewrite-action`.

## Tests

Colocated `*.test.ts(x)`. Pages render with `renderToStaticMarkup` in Node; client components
opt into `// @vitest-environment jsdom` and supply rules through `PlatformAbilityProvider`.
Page and action tests mock `@/lib/auth/platform-ability` and the DAL.

```bash
npx vitest run "src/app/(admin)/admin/packages" src/lib/casl-pilot-static.test.ts
```

`deletePackageAction` and `listPackages` are also exercised against the local Supabase stack in
`src/lib/auth/permissions.local-it.test.ts` (skipped under `npm run test`; run via
`scripts/integration/run-local.sh`).
