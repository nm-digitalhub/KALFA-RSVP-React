-- Agent console layer: additive only. No existing table altered except one trigger on call_attempts.

create table if not exists public.console_agents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  vox_username text,
  created_at timestamptz not null default now()
);
alter table public.console_agents enable row level security;

create or replace function public.is_console_agent()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.console_agents where user_id = auth.uid()) $$;

create policy console_agents_select on public.console_agents
  for select to authenticated using (public.is_console_agent());

create table if not exists public.agent_status (
  agent_id uuid primary key references public.console_agents(user_id) on delete cascade,
  status text not null default 'not_ready' check (status in ('ready','not_ready','dnd','in_call')),
  updated_at timestamptz not null default now()
);
alter table public.agent_status enable row level security;
create policy agent_status_select on public.agent_status
  for select to authenticated using (public.is_console_agent());
create policy agent_status_upsert_own on public.agent_status
  for insert to authenticated with check (agent_id = auth.uid() and public.is_console_agent());
create policy agent_status_update_own on public.agent_status
  for update to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create table if not exists public.console_call_feed (
  call_attempt_id uuid primary key references public.call_attempts(id) on delete cascade,
  event_id uuid,
  campaign_id uuid,
  direction text not null default 'outbound',
  kind text not null default 'ai_rsvp',
  status text,
  handled_by text not null default 'ai',
  agent_id uuid,
  rsvp_digit text,
  finish_reason text,
  call_duration_sec integer,
  callback_iso timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.console_call_feed enable row level security;
create policy console_call_feed_select on public.console_call_feed
  for select to authenticated using (public.is_console_agent());
create policy console_call_feed_update_agent on public.console_call_feed
  for update to authenticated using (public.is_console_agent()) with check (public.is_console_agent());

create or replace function public.sync_console_call_feed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.console_call_feed (call_attempt_id, event_id, campaign_id, status,
    rsvp_digit, finish_reason, call_duration_sec, callback_iso, created_at, updated_at)
  values (new.id, new.event_id, new.campaign_id, new.status,
    new.rsvp_digit, new.finish_reason, new.call_duration_sec, new.callback_iso, new.created_at, now())
  on conflict (call_attempt_id) do update set
    status = excluded.status,
    rsvp_digit = excluded.rsvp_digit,
    finish_reason = excluded.finish_reason,
    call_duration_sec = excluded.call_duration_sec,
    callback_iso = excluded.callback_iso,
    updated_at = now();
  return new;
end $$;

drop trigger if exists trg_sync_console_call_feed on public.call_attempts;
create trigger trg_sync_console_call_feed
  after insert or update on public.call_attempts
  for each row execute function public.sync_console_call_feed();

insert into public.console_call_feed (call_attempt_id, event_id, campaign_id, status,
  rsvp_digit, finish_reason, call_duration_sec, callback_iso, created_at, updated_at)
select id, event_id, campaign_id, status, rsvp_digit, finish_reason, call_duration_sec,
  callback_iso, created_at, now()
from public.call_attempts
on conflict (call_attempt_id) do nothing;

create or replace view public.console_campaigns as
  select c.id, c.event_id, c.status, c.enabled, c.start_at, c.close_at,
         c.max_contacts, c.created_at, c.updated_at
  from public.campaigns c
  where public.is_console_agent();

create or replace view public.console_rsvp_results as
  select r.id, r.event_id, r.guest_id, g.full_name as guest_name,
         r.attending, r.adults, r.kids, r.note, r.created_at
  from public.rsvp_responses r
  left join public.guests g on g.id = r.guest_id
  where public.is_console_agent();

create or replace view public.console_campaign_targets as
  select o.id, o.event_id, o.campaign_id, o.contact_id, o.status,
         o.current_step_index, o.next_run_at, o.reached_at, o.reached_channel, o.stop_reason
  from public.outreach_state o
  where public.is_console_agent();

revoke all on public.console_campaigns, public.console_rsvp_results, public.console_campaign_targets from anon;
grant select on public.console_campaigns, public.console_rsvp_results, public.console_campaign_targets to authenticated;

alter publication supabase_realtime add table public.agent_status;
alter publication supabase_realtime add table public.console_call_feed;
