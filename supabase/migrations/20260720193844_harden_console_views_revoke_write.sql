-- Console views: revoke write privileges from `authenticated` (read-only, as
-- always intended). Grants only — no view is redefined, no data is touched.
--
-- THE HOLE (verified live 2026-07-20 against pg_class / pg_roles /
-- information_schema.views, and independently flagged ERROR-level by
-- `supabase db advisors --linked` as "Security Definer View"):
--
--   1. All six console views are owned by `postgres`  ................ verified
--   2. `postgres` has rolbypassrls = true  ........................... verified
--   3. None sets security_invoker (reloptions empty)  ................ verified
--      → every access through these views runs with the OWNER's rights,
--        so the base tables' RLS is not evaluated at all.
--   4. Postgres reports console_events / console_campaigns /
--      console_call_analysis as is_updatable = YES (single-relation,
--      "simply updatable" views), i.e. INSERT/UPDATE/DELETE through the
--      view are rewritten into DML on events / campaigns / call_analysis.
--   5. relacl on all six: `authenticated=arwdDxtm` — full write rights,
--      inherited from the schema's default privileges. The creating
--      migrations (20260720025656 / 20260720061244 / 20260720110507) did
--      `revoke all ... from anon` and then `grant select`, but never revoked
--      from `authenticated` — and a grant does not remove what the default
--      privileges already gave.
--
-- Net effect before this migration: a console agent (the view's own
-- `is_console_agent()` predicate is the only filter) could issue
-- `DELETE /rest/v1/console_events?event_id=eq.<any>` — or PATCH
-- console_campaigns, which carries pricing, charge ceilings and settlement
-- state — and Postgres would execute it against the base table as `postgres`,
-- bypassing events_owner_delete / events_org_update entirely. Scope today is
-- limited (exactly one console_agents row, and no application code reads the
-- layer yet), but it is live and reachable through the normal REST API.
--
-- WHY NOT security_invoker = on (the textbook fix):
-- it would restore base-table RLS, but `events_org_select` limits reads to the
-- event's owner/org members. A console agent is neither, so the views would
-- return zero rows and the console would break. Read access here is
-- deliberately gated by `is_console_agent()` inside each view — not by
-- ownership. So the correct fix is to remove the WRITE privileges that were
-- never intended, and leave the read path exactly as it is today.
--
-- Idempotent (revoke/grant are declarative) and additive-safe: SELECT for
-- `authenticated` is re-granted explicitly, service_role is untouched, and no
-- view definition changes — so nothing the Android console reads is affected.

revoke all on
    public.console_events,
    public.console_campaigns,
    public.console_campaign_targets,
    public.console_call_analysis,
    public.console_rsvp_results,
    public.console_me
  from authenticated;

-- Re-grant the ONLY privilege these views were ever meant to expose.
grant select on
    public.console_events,
    public.console_campaigns,
    public.console_campaign_targets,
    public.console_call_analysis,
    public.console_rsvp_results,
    public.console_me
  to authenticated;

-- anon was already revoked by the creating migrations; restate it so a future
-- default-privileges change cannot silently re-open the surface.
revoke all on
    public.console_events,
    public.console_campaigns,
    public.console_campaign_targets,
    public.console_call_analysis,
    public.console_rsvp_results,
    public.console_me
  from anon;

-- console_call_feed / console_agents / agent_status are TABLES with RLS
-- policies, not views, so they do not share this bypass. They are left alone
-- here on purpose; their own grants are reviewed with the pending
-- human_agent_call_legs migration.
