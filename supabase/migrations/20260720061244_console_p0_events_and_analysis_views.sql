-- P0: two ADDITIVE console views. No product tables/data/RLS touched.

-- Event names for the console (only events that actually have campaigns)
create or replace view console_events as
select e.id as event_id,
       e.name as event_name,
       e.event_type::text as event_type,
       e.event_date
from events e
where exists (select 1 from campaigns c where c.event_id = e.id)
  and is_console_agent();

-- Post-call analysis (ElevenLabs webhook results). No transcript is stored in DB;
-- no recording URLs and no cost_credits exposed to agents.
create or replace view console_call_analysis as
select ca.call_attempt_id,
       ca.event_id,
       ca.call_successful,
       ca.status,
       coalesce(ca.el_call_score, ca.overall_score) as score,
       ca.call_duration_secs,
       ca.termination_reason,
       ca.el_eval,
       ca.el_data->>'status'          as rsvp_status,
       nullif(ca.el_data->>'adults','')::int   as adults,
       nullif(ca.el_data->>'children','')::int as children,
       ca.analysis_at
from call_analysis ca
where ca.call_attempt_id is not null
  and is_console_agent();

revoke all on console_events, console_call_analysis from anon, public;
grant select on console_events, console_call_analysis to authenticated;;
