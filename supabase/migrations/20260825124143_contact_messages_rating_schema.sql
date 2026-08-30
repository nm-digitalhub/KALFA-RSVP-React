-- CSAT/rating step for the inquiry silence-followup cascade (second half;
-- first half in 20260825115024_contact_messages_followup_cascade.sql, which
-- added reminder_sent_at/closing_warning_sent_at/auto_closed_at +
-- inquiry_followup_enabled). When the sweep auto-closes an inquiry, a
-- rating-request email carries a public token link (/rate/[token]) where the
-- customer picks a 1-3 score (unhappy/neutral/happy) and may leave a
-- comment. Columns only — no RLS change (contact_messages has no
-- admin-facing SELECT/UPDATE policy by design, confirmed live: only
-- cm_insert_authenticated exists; access is service-role +
-- requirePlatformPermission, per
-- 20260720030121_strip_staff_axis_from_customer_tables.sql). The new public
-- /rate/[token] page looks up by
-- rating_token via the service-role client (WHERE rating_token = $1), same
-- pattern as other public token surfaces (guests.rsvp_token) -- no anon RLS
-- policy needed. No new index beyond the UNIQUE constraint on rating_token
-- (auto-indexed; table was 8 rows as of the last migration). No CHECK
-- constraint on rating_score -- enforced in application code, matching this
-- table's established convention (status and the first cascade migration's
-- columns are also unconstrained at the DB level). No GRANT (table-level
-- grants already cover authenticated/service_role and extend automatically
-- to new columns, confirmed live).
--
-- Rollback:
--   alter table public.contact_messages
--     drop column if exists rating_token,
--     drop column if exists rating_requested_at,
--     drop column if exists rating_score,
--     drop column if exists rating_comment,
--     drop column if exists rating_at;

alter table public.contact_messages
  add column if not exists rating_token text,
  add column if not exists rating_requested_at timestamptz,
  add column if not exists rating_score smallint,
  add column if not exists rating_comment text,
  add column if not exists rating_at timestamptz;

-- Guarded for idempotency (ALTER TABLE ... ADD CONSTRAINT has no
-- IF NOT EXISTS, unlike the column adds above) -- same pattern as
-- 20260719112811_voice_ops_hardening.sql. A real UNIQUE constraint, not a
-- bare unique index, matching this table's existing convention
-- (contact_messages_source_message_key, contype='u', verified live via
-- pg_constraint).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contact_messages_rating_token_key'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_rating_token_key unique (rating_token);
  end if;
end $$;

comment on column public.contact_messages.rating_token is
  'Opaque public bearer token (randomBytes(16).toString(''hex''), same 128-bit strength as guests.rsvp_token) for the /rate/[token] CSAT page. Generated in application code when the rating-request email is sent. Null for rows never sent a rating request; unique so the public page can look up a row by token alone.';
comment on column public.contact_messages.rating_requested_at is
  'When the rating-request email was sent, following an auto-close by the followup sweep. Both the "was it sent" fact and the idempotency guard for that email (same role thankyou_sent_at plays for campaigns). Null until sent.';
comment on column public.contact_messages.rating_score is
  '1 (unhappy) / 2 (neutral) / 3 (happy), set by the customer via /rate/[token]. Null until rated. Not DB-constrained to {1,2,3} -- enforced in application code, matching this table''s existing convention (status and the followup-cascade columns).';
comment on column public.contact_messages.rating_comment is
  'Optional free-text comment the customer may leave alongside rating_score via /rate/[token]. Null if none given.';
comment on column public.contact_messages.rating_at is
  'When the customer most recently submitted a rating (distinct from rating_requested_at, which is when we asked). Re-submittable: a later submission overwrites rating_score/rating_comment/rating_at in place -- this is "most recent submission time", not a one-time-lock flag.';
