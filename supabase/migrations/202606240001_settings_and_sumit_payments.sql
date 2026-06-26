-- Customer account settings.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  event_updates boolean not null default true,
  reminder_updates boolean not null default true,
  billing_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists user_settings_owner_select on public.user_settings;
create policy user_settings_owner_select
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists user_settings_owner_insert on public.user_settings;
create policy user_settings_owner_insert
  on public.user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists user_settings_owner_update on public.user_settings;
create policy user_settings_owner_update
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
