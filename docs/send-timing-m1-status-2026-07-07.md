# Send-Timing M1 — Status & Deferred Follow-ups (2026-07-07)

## M1 implementation — COMPLETE + verified (NOT committed / NOT deployed)

- **terminal-recovery defect FIXED.** The same-J crash-recovery (`enqueue.ts` `runStepExecution`, `alreadyReserved` branch) now RE-CHECKS the terminal preconditions (`removal_requested` / channel-consent) via `checkStepTerminal` + `terminalReasonFor` (`outreach-engine.ts`) and RE-TERMINALIZES (`advance:false, terminalStatus:'stopped'`) instead of a blind `advance:true`. Both branches are non-sending → at-most-once preserved.
- **Full same-J regression (parametric).** `enqueue.test.ts` `it.each(['removal_requested','no_whatsapp_consent'])` "full same-J recovery": run 1 = alreadyReserved:false → reserve → send terminal → resolve `error` → THROW; run 2 = same jobId → alreadyReserved:true → `recheckTerminal` → resolve `resolved`. Asserts: reserve once, send once, **no `advance:true`**, second resolve = `advance:false, terminalStatus:'stopped', same reason`.
- **All 5 gates GREEN:** `npm run lint` (EXIT 0), `npx tsc --noEmit` (EXIT 0), `npx vitest run` (**1023 passed | 12 skipped**), `npm run worker:build` (EXIT 0), `npm run build` (✓ Compiled successfully).
- **Integration gate hardened (fail-closed).** `const RUN = process.env.OUTREACH_DB_IT === '1'; const TEST = RUN ? resolveTestDb() : null;`. `resolveTestDb()` (`src/lib/outreach/test-db-guard.ts`) THROWS if the `OUTREACH_TEST_DB_URL`/`OUTREACH_TEST_SUPABASE_URL`/`OUTREACH_TEST_SERVICE_ROLE_KEY` trio is missing OR points at prod (`== NEXT_PUBLIC_SUPABASE_URL`, contains `SUPABASE_DB_HOST`, or the project ref `cklpaxihpyjbhymqtduv`). Verified: no `OUTREACH_DB_IT` → skipped; `OUTREACH_DB_IT=1` + missing trio → **exit 1, "integration DB not configured"** (fail-fast, not skipped). The old `OUTREACH_DB_IT=1` + `.env.local` path can no longer run the suite against the linked prod DB.
- **Read-only residue check on the linked DB (clean):** 0 `pgboss_test_%` schemas, 0 `outreach_state` rows, 0 recent `outreach.%` audit rows.
- **DB-level RPC logic proven** by the unit suite + an earlier NON-destructive run against the linked DB (12/12, rollback-isolated + isolated pg-boss schema, verified zero residue afterward).

## Task 5 (integration run on a local/test DB) — **DEFERRED**

> **Deferred: requires an external isolated environment after clean migration replay is repaired.**

This is the PRODUCTION server (`NM-DigitalHUB`). Every local-DB path here is blocked (see A, B below) and consuming prod-server resources for it is undesirable. The dedicated local/test-DB integration run (the gated `pgboss-isolation.integration.test.ts` + `outreach-serial-flow.integration.test.ts`, plus the `pgboss_test_%` cleanup proof) belongs in an EXTERNAL isolated environment — a developer machine, CI, or a Supabase preview/test project — once follow-up A is repaired.

## Separate infra follow-ups — NOT send-timing/outreach scope (do NOT fix within this work)

**A. Clean migration replay fails at `202606240002_order_payment_statuses.sql`.**
A from-scratch replay of `supabase/migrations/*` (e.g. `supabase db reset`, or applying the files in order to a fresh DB) errors with `type "order_status" does not exist` — the `order_status` enum is not created by an earlier migration in replay order. The live prod project is unaffected (migrations were applied incrementally, some out-of-band). Repairing the replay ordering is a standalone migration-hygiene task and a prerequisite for provisioning a fresh isolated test DB.

**B. `supabase db dump --schema public` is not portable to a fresh database.**
Loading the public-only dump into a clean `supabase/postgres` container fails (under `psql -v ON_ERROR_STOP=1`) with `ERROR: could not open relation with OID 16732`, `CONTEXT: SQL statement "SELECT pg_catalog.nextval('graphql.seq_schema_version')"`. The `pg_graphql` DDL event trigger fires during the load and depends on objects OUTSIDE the `public` schema. A portable dump must include the graphql dependency (or disable the DDL event trigger during restore). Standalone dump/restore-portability task.

## Constraints honored throughout
No migration changes, no `test-db-guard` behavioral regressions, no hand-editing generated artifacts, **no commit / no deploy / no PM2 restart**, no destructive operations on any live DB (the linked prod project or the host's live `kalfa_rsvp` PostgreSQL on 5432).
