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

The repo is linked to the live `kalfa-event-magic` project. There is no local
stack — every query below hits production. Read-only unless the user
explicitly approved a change.

## Sync state (auto-checked at load)

!`cd /var/www/vhosts/kalfa.me/beta && npx supabase migration list --linked 2>/dev/null | tail -5`

## The right tool per job

| Need | Command |
|---|---|
| Ad-hoc SQL (runs as postgres, CAN exec service_role SECDEF) | `npx supabase db query --linked "<sql>"` |
| Constraints / FKs / UNIQUE | query **pg_catalog** (`pg_constraint`, `pg_indexes`) — `information_schema` returns EMPTY for real constraints here |
| RLS policies | `select * from pg_policies where tablename='…'` |
| Regenerate types (never hand-edit) | `npx supabase gen types typescript --linked > src/lib/supabase/types.ts` |
| Post-change lint | `npx supabase db advisors --linked` |
| Programmatic access in app code | `createAdminClient()` (service role — server-only) |
| MCP alternative | `mcp__supabase__*` tools (list_tables, execute_sql, get_advisors) |

## Rules

- Read-only by default; any INSERT/UPDATE/DDL needs explicit user approval
  first (this is the live production DB — no throwaway test rows: memory
  `no-live-test-events-in-qa`).
- `db query` WITHOUT `--linked`-postgres context (e.g. read_only Mgmt API
  query) cannot execute service_role SECDEF functions (42501) — use
  `--linked` or the Management API non-read_only path.
- Never print connection strings or service keys into the conversation.
- Applying migrations / schema changes: hand off to the
  **rls-schema-engineer** agent (plan + approval flow).
