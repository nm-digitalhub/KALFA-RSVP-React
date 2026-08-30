-- Silence-based follow-up cascade for the admin contact-inquiry inbox:
-- after an admin reply, a background sweep sends a reminder, then a final
-- closing-warning, then auto-closes the inquiry if the customer stays
-- silent. This migration adds tracking columns + a kill-switch only — no
-- RLS change (contact_messages has no admin-facing SELECT/UPDATE policy by
-- design; access is service-role + requirePlatformPermission, per
-- 20260720030121_strip_staff_axis_from_customer_tables.sql), no new index
-- (8 rows live; reads join through the existing status_idx on
-- status='in_progress'), no GRANT (table-level grants already cover
-- authenticated/service_role and extend automatically to new columns).
--
-- Rollback:
--   alter table public.contact_messages
--     drop column if exists reminder_sent_at,
--     drop column if exists closing_warning_sent_at,
--     drop column if exists auto_closed_at;
--   alter table public.app_settings
--     drop column if exists inquiry_followup_enabled;

alter table public.contact_messages
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists closing_warning_sent_at timestamptz,
  add column if not exists auto_closed_at timestamptz;

comment on column public.contact_messages.reminder_sent_at is
  'When the sweep sent the first "still need help?" reminder email after an admin reply went unanswered. Null until sent.';
comment on column public.contact_messages.closing_warning_sent_at is
  'When the sweep sent the final "closing soon" warning email, after the reminder also went unanswered. Null until sent.';
comment on column public.contact_messages.auto_closed_at is
  'When the sweep auto-closed the inquiry (status -> done) due to sustained silence, as distinct from an admin manually setting done. Null for manual closes; admin UI should surface this distinction.';

-- Kill-switch for the sweep, deliberately independent of email_enabled
-- (unrelated transactional mail: agreements/inquiry replies) and
-- outreach_enabled (unrelated guest-campaign sending). Defaults off so the
-- sweep is inert until an admin explicitly arms it.
alter table public.app_settings
  add column if not exists inquiry_followup_enabled boolean not null default false;

comment on column public.app_settings.inquiry_followup_enabled is
  'Kill-switch for the contact_messages silence-based follow-up sweep (reminder -> closing warning -> auto-close). Default false: sweep is inert until an admin arms it. Independent of email_enabled and outreach_enabled.';
