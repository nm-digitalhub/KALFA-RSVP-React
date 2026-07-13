-- Personal @mention for Slack ops-alerts (config-driven, admin-managed).
--
-- When `slack_mention_user_id` is set and an alert's severity is at/above
-- `slack_mention_min_level`, the notifier prepends `<@USERID>` to the message so
-- that member is @-mentioned and notified (works even under a "mentions only"
-- channel preference). Both columns live on the single-row app_settings config
-- table alongside the other slack_* settings and are read server-side only.
--
-- The member id is NOT a secret (like slack_alert_channel_id) — the admin UI may
-- display and echo it back. Only slack_bot_token stays masked.

alter table public.app_settings
  add column if not exists slack_mention_user_id   text,
  add column if not exists slack_mention_min_level text not null default 'off'
    check (slack_mention_min_level in ('off', 'error', 'warn', 'info'));

comment on column public.app_settings.slack_mention_user_id is
  'Slack member id (U…/W…) to @-mention on alerts at/above slack_mention_min_level. Non-secret; may be shown in the admin UI.';
comment on column public.app_settings.slack_mention_min_level is
  'Minimum severity (off|error|warn|info) that triggers the personal @mention. off disables it.';
