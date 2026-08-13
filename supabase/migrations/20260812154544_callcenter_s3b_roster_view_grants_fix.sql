-- Fix-up for 20260812154126: the roster view inherited FULL default privileges
-- for authenticated (arwdDxtm) because the parent migration granted SELECT
-- without revoking the default grant first. Not exploitable (a 3-table join
-- view is not auto-updatable, so writes fail regardless) — but grants must say
-- what they mean: agents READ the roster, nothing else.
revoke all on public.console_agents_roster from anon, authenticated;
grant select on public.console_agents_roster to authenticated;
