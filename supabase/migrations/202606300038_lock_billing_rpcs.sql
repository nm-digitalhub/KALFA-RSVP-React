-- P0 (security) — lock the two billing RPCs to service_role only.
--
-- AUDIT: plans/authz-audit-unified-report.md §4 / §6 P0. Both functions are
-- SECURITY DEFINER with EXECUTE granted to anon + authenticated + PUBLIC and NO
-- internal caller-identity check — the ONLY confirmed, live-proven holes in the
-- audit's scope:
--   * campaign_billing_summary(uuid)  — an anon REST call returned a campaign's
--     exact billing figures (reached/accrued/ceiling/max_contacts), HTTP 200.
--   * try_record_billed_result(...)   — WRITES billed_results (real per-reached
--     charge); anon REST reached the function body.
-- Both are called ONLY by server code through the service-role client, so locking
-- them to service_role breaks no app flow.
--
-- Fix mirrors the lockdown already on submit_rsvp / get_rsvp_by_token /
-- claim_webhook_events: revoke EXECUTE from anon, authenticated AND public (anon
-- inherits the built-in PUBLIC grant — note the `=X/postgres` PUBLIC entry in the
-- live ACL), and keep it only for service_role.
--
-- Forward-only. No function body or signature change. Idempotent (REVOKE of an
-- absent grant is a no-op; GRANT is repeatable). postgres (owner) is untouched.
--
-- search_path-INDEPENDENT: the enum arg is schema-qualified (public.campaign_channel)
-- so the statements resolve regardless of the runner's search_path. uuid/text are
-- pg_catalog (always resolvable); role names are global. (The live Mgmt-API apply
-- runs with search_path = "$user", public, but qualifying makes it portable to a
-- stripped-search_path runner such as `supabase db push`.)

revoke execute on function
  public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text)
  from anon, authenticated, public;

revoke execute on function
  public.campaign_billing_summary(uuid)
  from anon, authenticated, public;

-- Make the only legitimate caller explicit (idempotent).
grant execute on function
  public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text)
  to service_role;

grant execute on function
  public.campaign_billing_summary(uuid)
  to service_role;
