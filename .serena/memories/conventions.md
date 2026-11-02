# Code conventions

- Server Components by default; `"use client"` only for browser state/handlers/effects.
- Every server module starts `import 'server-only'`; data access through `src/lib/data/*`. Request-free modules (used by the worker) must not import cookies/`requireUser`/next headers — enforced by `npm run worker:deps`.
- Authorization server-side on every page/action/route: `requireUser` / `requireEventAccess(eventId, resource, action)` / platform checks; permission keys defined in CASL `PLATFORM_ACTIONS` (`src/lib/casl.ts`), never hard-coded. Staff and customer paths are separate functions.
- Server actions via next-safe-action client (`src/lib/safe-action.ts`); Zod 4 validation at every external boundary.
- DB enum/types only from generated types: `Enums<'…'>`, `Tables<'…'>` via `@/lib/supabase/types` (`types.ts` = MergeDeep override layer over generated). Never hand-write DB types; never edit `types.generated.ts` by hand.
- Label maps are exhaustive `Record<Enum, string>` so an enum change is a compile error (e.g. `src/app/(customer)/app/events/[id]/guests/labels.ts`).
- Read paths THROW on DB error (never fold an error into `null`/0 — callers treat null as terminal). Display-only writes may be best-effort but must say so.
- Supabase column names are strings → LSP cannot see them; use pattern search for column/RPC usage, LSP/Serena for symbols.
- Logging: never log tokens, phones, payloads, secrets; ids/codes only.
- Hebrew user-facing strings; RTL logical CSS (`ps-*`/`pe-*`, start/end); dates via `src/lib/date.ts` he-IL formatters.
- Tests colocated as `*.test.ts`; DB-backed suites are `*.local-it.test.ts` (run-local.sh) or `*.integration.test.ts` (gated by `OUTREACH_DB_IT`).
- Migrations: new file per change in `supabase/migrations/` (never move/edit applied ones); rebuild functions from LIVE definitions; end with a verification `DO` block; header documents WHY / WHAT / DEPLOY ORDER (code first when columns are dropped).
- No suppression of failures (`@ts-ignore`, skipped tests, weakened asserts) without explicit approval.
