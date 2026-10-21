-- harden-console-agent-permissions, stage S2 (design D3a): every console data view returns rows of console-scope events only.
--
-- WHY. Only console_events limited itself to events with AI calls or a campaign. console_event_guests, console_rsvp_results,
-- console_campaign_targets and console_call_analysis filtered on is_console_agent() alone, so an active agent read the guests and
-- RSVP answers of every event, including events the console never works on (executed on the local database, 21.10.2026). In
-- production 2 of 10 events are outside the scope, and no console work references them (0 of 1267 calls, 0 of 20 call-feed rows,
-- 0 of 18 call analyses). Work data inside the scope is unchanged (design D2).
--
-- HOW. One definer helper holds the rule, so every view uses the same definition. It must be SECURITY DEFINER: functions called
-- from an owner-rights view run as the CALLER, and an agent cannot read public.events. Each view keeps its select list byte for byte
-- (generated from the live definition rendered with search_path = '', identical on production and local); only WHERE changes:
--   - console_events: the inline scope condition becomes the helper (same meaning);
--   - console_event_guests, console_rsvp_results: the helper on the row's event (the reviewed exposure);
--   - console_campaign_targets: in scope by construction (outreach_state.campaign_id is NOT NULL); the helper states it;
--   - console_call_analysis: attempt-linked rows are in scope by construction (call_attempts.campaign_id is NOT NULL); the helper
--     applies to the row's own event_id when it is set, and a row with no event_id stays visible (call_analysis.event_id is
--     nullable; 0 such rows today, 0 rows whose event differs from the attempt's).
-- is_console_agent() stays in every WHERE explicitly (the console-view-grants guard pins it). Grants and owners are unchanged:
-- create or replace view keeps them.
--
-- ROLLBACK: re-create each view with its previous body (live md5 of pg_get_viewdef under search_path = '' on 21.10.2026), then drop
-- the helper:
--   console_events: md5 81337873370552d15577736405cf67b4; latest create in 20260720110507_console_event_centric_views_v2.sql
--   console_event_guests: md5 285143c560b82cfbb798169db8d8287f; latest create in 20260722170739_console_event_guests_reach_state.sql
--   console_rsvp_results: md5 7e35470e219bdf7be65231259879f1b0; latest create in 20260720025656_console_agent_layer.sql
--   console_campaign_targets: md5 ef2e481320b8588208c5550bca19f198; latest create in 20260720110507_console_event_centric_views_v2.sql
--   console_call_analysis: md5 549da86043190ecd2ca863e76e1162de; latest create in 20260720061244_console_p0_events_and_analysis_views.sql
--   drop function public.console_event_in_scope(uuid);

create function public.console_event_in_scope(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_console_agent())
     and exists (
       select 1
         from public.events e
        where e.id = p_event_id
          and (e.with_ai_calls or exists (select 1 from public.campaigns c where c.event_id = e.id))
     );
$$;

comment on function public.console_event_in_scope(uuid) is
  'The console scope rule: the caller is an active console agent and the event has AI calls or a campaign. Used by every console '
  'data view (harden-console-agent-permissions D3a).';

revoke all on function public.console_event_in_scope(uuid) from public, anon;
grant execute on function public.console_event_in_scope(uuid) to authenticated, service_role;

-- console_events
create or replace view public.console_events as
 SELECT id AS event_id,
    name AS event_name,
    (event_type)::text AS event_type,
    event_date,
    (EXISTS ( SELECT 1
           FROM public.campaigns c
          WHERE (c.event_id = e.id))) AS has_campaign
   FROM public.events e
  WHERE public.is_console_agent() AND public.console_event_in_scope(e.id);

-- console_event_guests
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
  WHERE public.is_console_agent() AND public.console_event_in_scope(g.event_id);

-- console_rsvp_results
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
  WHERE public.is_console_agent() AND public.console_event_in_scope(r.event_id);

-- console_campaign_targets
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
  WHERE public.is_console_agent() AND public.console_event_in_scope(o.event_id);

-- console_call_analysis
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
  WHERE ca.call_attempt_id IS NOT NULL AND public.is_console_agent()
    AND (ca.event_id IS NULL OR public.console_event_in_scope(ca.event_id));
