-- Gives callback_requests the time axis it never had.
--
-- Until now the table recorded WHO asked to be called back and WHY, but nothing
-- about WHEN: a request landed with status='new' and waited for a human to
-- notice it in a list. These columns turn a request into something that can be
-- placed in the owner's Exchange calendar and tracked through to a real call.
--
-- Nothing here is customer-facing. callback_requests is written by the public
-- form through the service-role DAL (src/lib/data/inquiries.ts) and read only
-- in the admin area; the columns below are set by the scheduler and by the
-- admin screen, never by the public form.

-- The time the caller themself asked for ("call me tomorrow evening").
-- NULL is the normal case and means "no preference" — the scheduler then picks
-- the next free business slot. timestamptz, not date: the point is an instant,
-- and every display path already renders Israel time from timestamptz
-- (src/lib/date.ts).
alter table public.callback_requests
  add column if not exists requested_at timestamptz;

-- The Exchange ItemId of the appointment created for this request.
-- Without it the admin screen cannot call updateAppointment, so it could never
-- recolour the item after the call, move it for a second attempt, or remove it.
-- Text, not uuid: an EWS ItemId is an opaque base64-ish string.
alter table public.callback_requests
  add column if not exists calendar_item_id text;

-- Which connection the appointment lives in. The mailbox is selectable from the
-- admin panel (app_settings.exchange_connection_mode), so an item written today
-- may belong to a connection that is later replaced; without this the id above
-- would be unresolvable. ON DELETE SET NULL rather than CASCADE: losing the
-- connection must not delete the customer's callback request.
alter table public.callback_requests
  add column if not exists exchange_connection_id uuid
    references public.exchange_connections(id) on delete set null;

-- When the appointment was created, and how many times we have tried to reach
-- this person. The counter drives the "[ניסיון 2]" subject rewrite and gives
-- the daily-cap check something to count.
alter table public.callback_requests
  add column if not exists scheduled_at timestamptz;

alter table public.callback_requests
  add column if not exists attempt_count smallint not null default 0;

-- One appointment per request, enforced by the database rather than by the
-- scheduler's own bookkeeping: a retried job, a double click in the admin
-- screen, or two workers racing must not produce two calendar items for the
-- same caller. Partial, so the many rows with no appointment yet do not
-- collide with each other on NULL.
create unique index if not exists callback_requests_calendar_item_uniq
  on public.callback_requests (calendar_item_id)
  where calendar_item_id is not null;

-- The scheduler's work queue: "requests that still need an appointment".
-- Partial index over exactly that predicate, so the sweep stays cheap as the
-- table grows and never scans handled rows.
create index if not exists callback_requests_unscheduled_idx
  on public.callback_requests (created_at)
  where calendar_item_id is null and status = 'new';

-- attempt_count is a counter, not a free-form number.
alter table public.callback_requests
  drop constraint if exists callback_requests_attempt_count_check;
alter table public.callback_requests
  add constraint callback_requests_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= 20);

comment on column public.callback_requests.requested_at is
  'Time the caller asked to be called back; NULL = no preference, scheduler picks the next free business slot.';
comment on column public.callback_requests.calendar_item_id is
  'Exchange ItemId of the appointment created for this request. Required to update or remove it later.';
comment on column public.callback_requests.exchange_connection_id is
  'Which exchange_connections row the appointment lives in; SET NULL if that connection is removed.';
comment on column public.callback_requests.scheduled_at is
  'When the calendar appointment was created for this request.';
comment on column public.callback_requests.attempt_count is
  'Completed call attempts; drives the "[ניסיון N]" subject and the daily cap.';
