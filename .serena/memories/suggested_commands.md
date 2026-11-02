# Suggested commands (run from repo root)

## Dev / build / deploy
- `npm run dev` — Next dev server.
- `npm run build` — verification build into `.next-verify` (not the live dir).
- `npm run deploy` — OWNER runs it: checks types vs linked DB, builds `.next-stage`, swaps `.next`, restarts pm2 `kalfa-beta`, rebuilds+restarts worker, owner-agent, fleet. Before it, after deleting a route: `rm -rf .next/types` (stale typegen of the live build breaks the type-check; `tsconfig.json` includes every `.next*/types`). Never `rm -rf .next` (live build).
- `npm run worker:build` — esbuild `worker/main.ts` → `dist/worker.cjs`.

## Checks
- `npm run typecheck` — `next typegen` into `.next-typecheck` + `tsc -p tsconfig.typecheck.json`. Does NOT catch stale `.next/types`; for that `npx tsc --noEmit -p tsconfig.json`.
- `npm run lint` (eslint; pass file paths for focused runs).
- `npm run worker:deps` — dependency-cruiser boundary (worker must not pull next/headers etc.).
- `npm test` / `npx vitest run <files>` — unit tests (`pretest` runs worker:deps + control-char check).

## Database
- New migration: `npx supabase migration new <name> < /dev/null` (never scaffold by hand); apply locally `npx supabase migration up --local`.
- pgTAP: `SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database`.
- Local-only integration: `bash scripts/integration/run-local.sh` (`*.local-it.test.ts`).
- Gated DB integration (`*.integration.test.ts`, otherwise silently skipped): export `DB_URL/API_URL/SERVICE_ROLE_KEY` from `npx supabase status -o env`, then `OUTREACH_DB_IT=1 OUTREACH_TEST_DB_URL=… OUTREACH_TEST_SUPABASE_URL=… OUTREACH_TEST_SERVICE_ROLE_KEY=… npx vitest run integration.test`.
- Live DB (read-only unless approved): `npx supabase db query --linked "<sql>"`; `npx supabase migration list --linked`. OWNER pushes: `npx supabase db push --linked`, then `npm run gen:types` + `npm run types:check`.

## Voice
- `npm run vox:upload` — uploads EVERY scenario whose built hash differs from `voxfiles/.voxengine-ci` metadata (not just the one you edited); commit the updated metadata. Never touch DTMF rule `OutCall` (1494311).
- ElevenLabs agent: `elevenlabs agents pull --agent <id> --update` before any edit; push to test branch, read back; `push --branch` rewrites top-level ids in `agents.json` — restore them.
