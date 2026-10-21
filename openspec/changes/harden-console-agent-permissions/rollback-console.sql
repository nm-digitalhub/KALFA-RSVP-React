-- harden-console-agent-permissions: full rollback runbook, S3 -> S2 -> S1 (reverse order).
--
-- Restores the catalog state that production and local had before 20261021194728, 20261021195228 and 20261021195752
-- (read 21.10.2026; production == local). It changes no data. It does NOT edit the migration files or the migration
-- history: run it as a NEW migration (supabase migration new revert_console_hardening, paste, review, push), so the
-- history stays truthful. Each stage is one transaction and can be run alone, newest first.
--
-- Verified: applied on the local database inside one transaction, the resulting catalog equals the saved pre-change
-- baselines (see verification-console.md, Rollback), then ROLLBACK.
--
-- Effects to expect when rolled back (why the stages were made):
--   S3 -> an inactive agent can again update device_id/vox_sdk_call_id on its own monitor leg in raw SQL.
--   S2 -> active agents again read guests and RSVP answers of events outside the console scope.
--   S1 -> active agents again list every agent that has a stored secret; console_agent_shift again grants
--         TRUNCATE/TRIGGER/REFERENCES/MAINTAIN to authenticated, and an inactive agent can update its shift in raw SQL.

-- ───────────────────────── S3 (20261021195752) ─────────────────────────
begin;
alter function public.is_console_agent() set search_path = public;
alter policy human_agent_call_legs_update_own on public.human_agent_call_legs
  using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()));
commit;

-- ───────────────────────── S2 (20261021195228) ─────────────────────────
-- View bodies exactly as pg_get_viewdef rendered them under search_path = '' before the change (fully qualified).
begin;
-- console_events: original md5(pg_get_viewdef) 81337873370552d15577736405cf67b4
create or replace view public.console_events as
 SELECT id AS event_id,
    name AS event_name,
    (event_type)::text AS event_type,
    event_date,
    (EXISTS ( SELECT 1
           FROM public.campaigns c
          WHERE (c.event_id = e.id))) AS has_campaign
   FROM public.events e
  WHERE (((with_ai_calls = true) OR (EXISTS ( SELECT 1
           FROM public.campaigns c
          WHERE (c.event_id = e.id)))) AND public.is_console_agent());

-- console_event_guests: original md5(pg_get_viewdef) 285143c560b82cfbb798169db8d8287f
create or replace view public.console_event_guests as
 SELECT g.id AS guest_id,
    g.event_id,
    g.full_name AS guest_name,
    ((c.normalized_phone IS NOT NULL) AND (c.removal_requested = false)) AS dialable,
        CASE
            WHEN public.has_platform_permission('view_customer_data'::text) THEN c.normalized_phone
            ELSE NULL::text
        END AS phone,
    (g.status)::text AS rsvp_status,
    (EXISTS ( SELECT 1
           FROM public.campaigns cp
          WHERE ((cp.event_id = g.event_id) AND (cp.status = 'active'::public.campaign_status)))) AS has_active_campaign,
    br.reached_at,
    cb.callback_scheduled_at,
    ((br.reached_at IS NULL) AND (cb.callback_scheduled_at IS NULL)) AS can_start_outreach_call,
        CASE
            WHEN (br.reached_at IS NOT NULL) THEN 'already_reached'::text
            WHEN (cb.callback_scheduled_at IS NOT NULL) THEN 'callback_scheduled'::text
            ELSE NULL::text
        END AS call_block_reason
   FROM (((public.guests g
     LEFT JOIN public.contacts c ON ((c.id = g.contact_id)))
     LEFT JOIN LATERAL ( SELECT b.reached_at
           FROM public.billed_results b
          WHERE ((b.event_id = g.event_id) AND (b.contact_id = g.contact_id))) br ON (true))
     LEFT JOIN LATERAL ( SELECT min(ca.callback_iso) AS callback_scheduled_at
           FROM public.call_attempts ca
          WHERE ((ca.event_id = g.event_id) AND (ca.contact_id = g.contact_id) AND (ca.callback_iso IS NOT NULL) AND (ca.callback_dispatched_at IS NULL))) cb ON (true))
  WHERE public.is_console_agent();

-- console_rsvp_results: original md5(pg_get_viewdef) 7e35470e219bdf7be65231259879f1b0
create or replace view public.console_rsvp_results as
 SELECT r.id,
    r.event_id,
    r.guest_id,
    g.full_name AS guest_name,
    r.attending,
    r.adults,
    r.kids,
    r.note,
    r.created_at
   FROM (public.rsvp_responses r
     LEFT JOIN public.guests g ON ((g.id = r.guest_id)))
  WHERE public.is_console_agent();

-- console_campaign_targets: original md5(pg_get_viewdef) ef2e481320b8588208c5550bca19f198
create or replace view public.console_campaign_targets as
 SELECT o.id,
    o.event_id,
    o.campaign_id,
    o.contact_id,
    o.status,
    o.current_step_index,
    o.next_run_at,
    o.reached_at,
    o.reached_channel,
    o.stop_reason,
    g.full_name AS guest_name,
        CASE
            WHEN public.has_platform_permission('view_customer_data'::text) THEN c.normalized_phone
            ELSE NULL::text
        END AS phone
   FROM ((public.outreach_state o
     LEFT JOIN public.contacts c ON ((c.id = o.contact_id)))
     LEFT JOIN public.guests g ON (((g.event_id = o.event_id) AND (regexp_replace(replace(g.phone, '-'::text, ''::text), '^0'::text, '+972'::text) = c.normalized_phone))))
  WHERE public.is_console_agent();

-- console_call_analysis: original md5(pg_get_viewdef) 549da86043190ecd2ca863e76e1162de
create or replace view public.console_call_analysis as
 SELECT call_attempt_id,
    event_id,
    call_successful,
    status,
    COALESCE(el_call_score, overall_score) AS score,
    call_duration_secs,
    termination_reason,
    el_eval,
    (el_data ->> 'status'::text) AS rsvp_status,
    (NULLIF((el_data ->> 'adults'::text), ''::text))::integer AS adults,
    (NULLIF((el_data ->> 'children'::text), ''::text))::integer AS children,
    analysis_at
   FROM public.call_analysis ca
  WHERE ((call_attempt_id IS NOT NULL) AND public.is_console_agent());

-- The views no longer reference the helper, so it can go.
drop function public.console_event_in_scope(uuid);
commit;

-- ───────────────────────── S1 (20261021194728) ─────────────────────────
begin;
-- Roster: original body (header of 20261021194728; md5 a97cffd7661f24de69fa392bbc220927 under the default search_path).
create or replace view public.console_agents_roster with (security_invoker = on) as
  select ca.user_id, ca.display_name, coalesce(ast.status, 'not_ready'::text) as status, ast.updated_at as status_updated_at,
         ((ca.vox_username is not null) and (cas.user_id is not null)) as provisioned,
         cp.busy_until as calendar_busy_until, cp.show_as as calendar_show_as
    from public.console_agents ca
    left join public.agent_status ast on ast.agent_id = ca.user_id
    left join public.console_agent_secrets cas on cas.user_id = ca.user_id
    left join public.console_agent_calendar_presence cp on cp.agent_id = ca.user_id
   where public.is_console_agent();
drop function public.console_agent_provisioned(uuid);

-- console_agent_secrets: column SELECT(user_id) for authenticated and the agent policy (attacl {authenticated=r/postgres}).
grant select (user_id) on public.console_agent_secrets to authenticated;
create policy console_agent_secrets_select on public.console_agent_secrets for select to authenticated
  using (public.is_console_agent());

-- console_agent_shift: remove the S1 column grants first (the migration header omits this step; without it attacl keeps
-- stray column entries), then restore the original table-level arwdDxtm and the ownership-only update policy.
revoke insert (agent_id, active, updated_at), update (agent_id, active, updated_at) on public.console_agent_shift from authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.console_agent_shift to authenticated;
-- Restore the original aclitem order {postgres, authenticated, service_role}: re-grant service_role after authenticated
-- (same privileges; atomic inside this transaction). Without it the privileges are equal but relacl text differs.
revoke all on public.console_agent_shift from service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.console_agent_shift to service_role;
alter policy console_agent_shift_update_own on public.console_agent_shift
  using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()));
commit;
