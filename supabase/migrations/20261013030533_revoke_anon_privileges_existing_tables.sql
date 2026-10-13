-- `anon` keeps no privilege on any existing table or sequence in `public`, except SELECT on the two
-- tables that serve public pages: `packages` (policy: active rows) and `faq_items` (policy: published rows).
--
-- WHY. Policies do not take grants back ("adding policies doesn't remove them"). `anon` still holds
-- privileges on 48 of 125 public tables (35 with a write privilege), 29 of them every privilege; RLS is
-- the only barrier. This removes the first barrier's gap.
--
-- BEHAVIOUR-NEUTRAL, verified on the live catalog (read-only), 13.10.2026: the only policies that name
-- `anon` are `faq_items_public_read` and `packages_public_read`; the nine other policies scoped to
-- `public` use `is_platform_staff()`, false for `anon`; no view or materialized view in `public` is
-- readable by `anon`; no SECURITY DEFINER function is executable by `anon`. Public pages (RSVP, tokens)
-- reach the data with the service role on the server, not with `anon`.
--
-- NOT TOUCHED: `authenticated` (a larger audit, follow-up) and existing functions (20 invoker
-- functions are anon-callable; not audited here).
--
-- ROLLBACK: re-grant the exact prior `anon` privileges per table. The per-table list (snapshot of
-- information_schema.role_table_grants for `anon` on the live database, 13.10.2026) is in
-- openspec/changes/staff-tables-permission-rls/verification-default-privileges.md; the common shape
-- was `grant all on table public.<t> to anon` for 29 tables and `references, select, trigger` for 11.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select on table public.packages, public.faq_items to anon;
