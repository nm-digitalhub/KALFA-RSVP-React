---
name: querying-live-supabase
description: >
  Use when inspecting or querying the LIVE KALFA Supabase database — checking
  real schema/constraints/policies/data ("מה יש בטבלה", "בדוק מול ה-DB החי"),
  running SQL against the linked project, regenerating types.ts, checking
  migration sync, or running database advisors. Do NOT use for writing new
  migrations end-to-end (that's the rls-schema-engineer agent's job).
---

# Querying the live KALFA Supabase

The repo is linked to the live `kalfa-event-magic` project. Supabase CLI v3
(`package.json`, since 03.11.2026): a command with NO target runs against the
LOCAL stack (`supabase start`, project `beta`). Every live command below ends
with `--remote` (put it last — `--remote <word>` is read as a branch/ref).
Read-only unless the user explicitly approved a change.

## Sync state (auto-checked at load)

!`cd /var/www/vhosts/kalfa.me/beta && npx supabase migration list --remote 2>/dev/null | tail -5`

## The right tool per job

| Need | Command |
|---|---|
| Read-only SQL (a read-only transaction as `supabase_read_only_user`; SELECT / WITH / VALUES / TABLE / SHOW / EXPLAIN only) | `npx supabase db query "<sql>" --read-only --remote` |
| SQL that must run as postgres (a service_role-only SECDEF function fails `42501` under `--read-only`, measured 03.11.2026), or any write | `npx supabase db query "<sql>" --remote` — in an agent run v3 stops with `HostedMutationConsentRequiredError` and runs nothing. Ask the user; only after an explicit yes re-run with `--yes` |
| Constraints / FKs / UNIQUE | query **pg_catalog** (`pg_constraint`, `pg_indexes`) — `information_schema` returns EMPTY for real constraints here |
| RLS policies | `select * from pg_policies where tablename='…'` |
| Regenerate types (never hand-edit) | `npm run gen:types` (→ `src/lib/supabase/types.generated.ts`; `types.ts` is the hand-maintained MergeDeep override layer) |
| Post-change lint | `npx supabase db advisors --remote` |
| Programmatic access in app code | `createAdminClient()` (service role — server-only) |
| MCP alternative | `mcp__supabase__*` tools (list_tables, execute_sql, get_advisors) |

## Rules

- Read-only by default; any INSERT/UPDATE/DDL needs explicit user approval
  first (this is the live production DB — no throwaway test rows: memory
  `no-live-test-events-in-qa`).
- `db query --read-only` cannot execute service_role-only SECDEF functions
  (42501) — that needs the postgres path (`--remote` without `--read-only`,
  which is a hosted change in v3: user approval, then `--yes`).
- Never get around the confirmation with `SUPABASE_YES`, `--agent=no` or a
  piped `y` — `--yes` is the user's consent, passed only after they gave it.
- Never print connection strings or service keys into the conversation.
- Applying migrations / schema changes: hand off to the
  **rls-schema-engineer** agent (plan + approval flow).
