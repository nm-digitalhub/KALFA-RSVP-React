-- Singleton system/app settings (exactly one row). Admin-managed operational
-- toggles for the clearing/payments feature. SECRETS STAY IN ENV — never here.
create table if not exists public.app_settings (
  id boolean primary key default true,
  payments_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = true)
);

-- Seed the single row so reads always find it.
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Writes + admin reads: admin only (mirrors orders_admin_all: has_role admin).
drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all
  on public.app_settings for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- payments_enabled is non-sensitive operational state; any signed-in user may
-- read it so the customer pay flow can gate on it via the session client
-- (avoids depending on the service-role key, which may be a placeholder).
drop policy if exists app_settings_auth_read on public.app_settings;
create policy app_settings_auth_read
  on public.app_settings for select
  to authenticated
  using (true);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
