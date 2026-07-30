-- fleet_goals RLS initplan optimization (PERFORMANCE ONLY; authorization semantics UNCHANGED).
--
-- Same transformation as 20260713143941_gap1_rls_initplan_optimization.sql, applied to
-- fleet_goals_admin_select — missed there because fleet_goals did not exist yet (created
-- 2026-07-29, sixteen days after that migration ran). Found by `get_advisors(type: performance)`
-- during a full fleet-goal-system end-to-end verification pass (2026-07-30).
--
-- has_role(auth.uid(), 'admin') re-evaluates auth.uid() PER ROW under RLS. Wrapping the
-- row-independent auth expression in a scalar subquery hoists it to a single per-statement
-- InitPlan. The boolean result is identical:
--   has_role(auth.uid(), '<role>')  ->  (select has_role((select auth.uid()), '<role>'))
--
-- SELECT-only policy, no WITH CHECK — matches its own USING-only shape (same as
-- ops_alerts_admin_select / rsvp_admin_read in the gap1 migration, which are also SELECT-only).

ALTER POLICY fleet_goals_admin_select ON public.fleet_goals
  USING ((select has_role((select auth.uid()), 'admin'::app_role)));
