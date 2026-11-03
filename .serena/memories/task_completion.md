# Task completion

Run focused checks after a change (owner rule: no full build / full suite / DB suites unless asked):
1. `npm run typecheck`
2. `npx eslint <changed files>`
3. `npx vitest run <affected test files>`; if worker-reachable code changed also `npm run worker:deps`.
4. SQL/migration changes: `npx supabase migration up` (local is the CLI v3 default), then pgTAP (`SUPABASE_DB_PORT=54322 npx supabase test db supabase/tests/database`) and the gated `*.integration.test.ts` touching the changed functions (see `mem:suggested_commands`).
5. Route deleted/renamed: also `npx tsc --noEmit -p tsconfig.json` (catches stale `.next*/types`).
6. Live verification only through `npx supabase db query "<sql>" --read-only --remote`.

Project Definition of Done (CLAUDE.md) still applies when the owner asks for a release: lint, typecheck, build pass; tests for the change; report changed files, verification, security notes, limitations.
Never: commit/push, deploy, `db push`, `vox:upload`, agent push to Main — unless the owner explicitly asks.
