-- Add the per-category Slack toggle for the new `customer_inquiry` alert
-- category (fires on a new contact_messages / callback_requests row).
--
-- Additive + safe: single boolean column on the app_settings singleton
-- (id = true), default true to match the four existing category toggles
-- (slack_alert_errors / _campaign_billing / _send_health / _security). Being
-- "on" is still a silent no-op until the master switch + bot token/channel are
-- configured, so this changes no runtime behavior on its own.
--
-- ops_alerts.category is free text (no CHECK), so writing the new category
-- value needs no migration — only this toggle column does.

alter table public.app_settings
  add column if not exists slack_alert_customer_inquiry boolean not null default true;

comment on column public.app_settings.slack_alert_customer_inquiry is
  'Slack alert toggle for the customer_inquiry category (new contact/callback inquiry). Default true; gated by slack_alerts_enabled + bot token/channel like the other categories.';
