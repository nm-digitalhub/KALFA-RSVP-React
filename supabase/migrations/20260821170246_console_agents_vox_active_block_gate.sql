alter table public.console_agents
  add column if not exists vox_active boolean not null default true;

comment on column public.console_agents.vox_active is
  'Whether this agent''s Voximplant SDK identity is active. Written ONLY after a successful Voximplant SetUserInfo(user_active=...) call — never toggled locally on its own. FALSE means the console access gate (is_console_agent) treats this user as not a console agent.';

create or replace function public.is_console_agent()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.is_staff()
    and exists (
      select 1 from public.console_agents
      where user_id = auth.uid() and vox_active
    )
$function$;
