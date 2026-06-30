-- Event Lifecycle State Model — advisor-cleanliness hardening (follow-up to
-- 20260630223635_event_lifecycle_state_model.sql).
--
-- Not a security fix: PostgreSQL itself rejects any direct invocation of a
-- function declared RETURNS trigger ("trigger functions can only be called as
-- triggers", errcode 0A000) — verified live against this exact DB before
-- writing this migration. The trigger mechanism that actually fires these
-- functions on INSERT/UPDATE does not go through the EXECUTE-privilege check
-- either, so revoking EXECUTE here changes nothing about how/when the triggers
-- run. This migration exists purely to silence `supabase db advisors
-- --type security`'s anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable WARN findings for the
-- three new SECURITY DEFINER trigger functions added by the lifecycle
-- migration, at the owner's request.
--
-- Note: this makes these three functions an EXCEPTION to this codebase's
-- existing convention — every other trigger function here (including
-- public.handle_new_user and public.set_updated_at, both pre-existing) keeps
-- the default PostgreSQL PUBLIC EXECUTE grant. Both states are equally safe
-- given the points above; this migration only narrows these three further.

revoke all on function public.events_guard_update() from public, anon, authenticated;
revoke all on function public.campaigns_require_active_event() from public, anon, authenticated;
revoke all on function public.campaigns_guard_cancel() from public, anon, authenticated;
