-- Slack operational-alerting configuration + history (Phase 3).
--
-- Config lives on the single-row `app_settings` table (same place the ExtrA SMS
-- token already lives) so it is admin-managed from the UI and read server-side
-- only. The bot token is a SECRET: it is never exposed to the browser (the admin
-- UI shows only a masked "configured" status), and app_settings is read via the
-- server/service-role clients, never the anon client.
--
-- `ops_alerts` is an append-only history of alerts actually emitted, shown in the
-- admin UI. RLS: admins may SELECT; inserts happen only via the service-role
-- client (which bypasses RLS); no UPDATE/DELETE for anyone.

-- --- config columns on app_settings ---------------------------------------
alter table public.app_settings
  add column if not exists slack_alerts_enabled          boolean not null default false,
  add column if not exists slack_bot_token               text,
  add column if not exists slack_alert_channel_id        text,
  add column if not exists slack_alert_errors            boolean not null default true,
  add column if not exists slack_alert_campaign_billing  boolean not null default true,
  add column if not exists slack_alert_send_health       boolean not null default true,
  add column if not exists slack_alert_security          boolean not null default true;

comment on column public.app_settings.slack_bot_token is
  'SECRET Slack bot OAuth token (xoxb-…). Server-only; never expose to the browser.';

-- --- append-only alert history --------------------------------------------
create table if not exists public.ops_alerts (
  id               uuid primary key default gen_random_uuid(),
  level            text not null check (level in ('error', 'warn', 'info')),
  title            text not null,
  source           text,
  category         text,
  delivered        boolean not null default false,
  suppressed_count integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists ops_alerts_created_idx on public.ops_alerts (created_at desc);

alter table public.ops_alerts enable row level security;

-- Admins read the history (cookie/authenticated client + this policy). Non-admin
-- authenticated users match no policy → see nothing. anon has no grant at all.
grant select on public.ops_alerts to authenticated;

create policy ops_alerts_admin_select on public.ops_alerts
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies: writes come only from the service-role
-- client (RLS-bypassing) in the notifier; the table is append-only by contract.
