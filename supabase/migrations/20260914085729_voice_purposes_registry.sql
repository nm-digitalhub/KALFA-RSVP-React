-- A voice purpose is a row, not a code stack.
--
-- WHAT A NEW PURPOSE COSTS TODAY, measured on 2026-09-14 before this migration:
-- two dedicated columns in `app_settings` (already 102 wide), a dedicated
-- attempt table, a ~370-line dispatcher, a pg-boss queue and worker handler, a
-- ctx/cb route pair, an admin form section, and a routing rule. Nine pieces, of
-- which exactly one — the rule id — was data. That is why KALFA has three voice
-- agents and not four.
--
-- ⚠️ WHAT IS GENUINELY SHARED, AND HOW WE KNOW. `callback_request_attempts` and
-- `sales_call_attempts` were compared column by column: TWELVE are identical
-- (id, callback_request_id, access_token, token_expires_at,
-- scheduled_at_snapshot, dispatch_status, vox_call_session_history_id,
-- finish_reason, call_duration_sec, el_conversation_id, created_at,
-- updated_at). Everything else is about what happens AFTER the call —
-- `confirmation_call_status` on one, eight WhatsApp-follow-up columns on the
-- other. The act of DIALLING is already generic; only the aftermath is not, and
-- a new purpose may have none.
--
-- ⚠️ WHAT IS NOT MOVED HERE, ON PURPOSE. The three built-in purposes (RSVP,
-- meeting-confirm, sales) keep their own tables, dispatchers and columns
-- untouched. They dial real people today; a refactor that consolidated them
-- would put every existing call behind new code to gain nothing a new row
-- needs. This is additive: the registry describes them so the admin and the
-- workflow editor can SEE them, and carries the dispatch settings only for
-- purposes that are new.
--
-- ⚠️ AND WHAT STAYS OUTSIDE KALFA ENTIRELY. The ElevenLabs agent and the
-- Voximplant scenario are built on those platforms — that is correct and not a
-- gap. KALFA never calls the ElevenLabs API on this path: it starts a Voximplant
-- rule, and the scenario bridges. That boundary is what keeps every dial behind
-- the live-calls switch, the dialling hours, the Shabbat block, DNC and consent.
-- A purpose row records WHICH rule to start; it grants no new reach.

-- ── the registry ─────────────────────────────────────────────────────────────

create table if not exists public.voice_purposes (
  key text primary key,
  display_name text not null,
  description text,

  -- The Voximplant rule to start. NULL means "declared but not wired" — the
  -- dispatcher refuses it by name rather than dialling something else.
  rule_id text,

  -- The per-purpose kill switch, independent of the account-wide
  -- `voximplant_live_calls`. Both must be on; neither implies the other.
  enabled boolean not null default false,

  -- TRUE for the three that predate this table. Their dialling lives in their
  -- own modules and their rule ids stay in `app_settings`; the row exists so
  -- they are visible and selectable, never to re-route them.
  is_builtin boolean not null default false,

  -- How long before a scheduled moment to dial. 24h for meeting-confirm, 0 for
  -- a purpose that dials when asked.
  lead_ms bigint not null default 0,
  -- Never dial sooner than this from the moment of request.
  min_delay_ms bigint not null default 60000,
  -- Access-token lifetime. Two hours, the value both existing dispatchers use.
  token_ttl_sec integer not null default 7200,

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint voice_purposes_key_shape check (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  constraint voice_purposes_lead_ms_sane check (lead_ms >= 0 and lead_ms <= 2592000000),
  constraint voice_purposes_min_delay_sane check (min_delay_ms >= 0 and min_delay_ms <= 86400000),
  constraint voice_purposes_ttl_sane check (token_ttl_sec between 60 and 86400)
);

comment on table public.voice_purposes is
  'What each configured voice agent is for, and which Voximplant rule starts it. is_builtin rows describe the three pre-existing dispatchers and are NOT dialled from here.';

-- ── dispatch attempts for NON-builtin purposes ───────────────────────────────
--
-- The twelve shared columns, plus who was called and which workflow step asked.
-- Deliberately NOT a copy of `call_attempts`: that table carries campaign,
-- touchpoint, rsvp digit, billing outcome and recording columns that belong to
-- the RSVP campaign engine and would be permanently null here.

create table if not exists public.voice_purpose_attempts (
  id uuid primary key default gen_random_uuid(),
  purpose_key text not null references public.voice_purposes(key) on delete restrict,

  event_id uuid references public.events(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,

  -- WHICH STEP ASKED. The pair is the idempotency key: a workflow step that is
  -- replayed — which the step lease can cause — must not place a second call.
  run_id uuid,
  node_id text,

  -- The bearer the scenario presents to the ctx route. Single-use by TTL, the
  -- same discipline the other dispatchers use.
  access_token text not null unique,
  token_expires_at timestamptz not null,

  dispatch_status text not null default 'pending'
    check (dispatch_status in ('pending','confirmed','failed','unknown')),
  vox_call_session_history_id bigint,
  finish_reason text,
  call_duration_sec integer,
  -- Correlation only, never authorization — the post-call webhook maps an
  -- ElevenLabs conversation back to this row.
  el_conversation_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.voice_purpose_attempts is
  'One dial attempt for a non-builtin voice purpose. (run_id, node_id, contact_id) is unique so a replayed workflow step cannot place a second call.';

-- ⚠️ THE GUARD THAT MATTERS. Without it a re-delivered pg-boss job or a replayed
-- step telephones the same person twice. Partial, because a dispatch that did
-- not come from a workflow has no pair to be unique on.
create unique index if not exists voice_purpose_attempts_step_uidx
  on public.voice_purpose_attempts (run_id, node_id, contact_id)
  where run_id is not null and node_id is not null;

create index if not exists voice_purpose_attempts_contact_idx
  on public.voice_purpose_attempts (contact_id, created_at desc);

-- ── RLS: the same shape app_settings and channels already use ────────────────

alter table public.voice_purposes enable row level security;
alter table public.voice_purpose_attempts enable row level security;

revoke all on public.voice_purposes from anon, authenticated;
revoke all on public.voice_purpose_attempts from anon, authenticated;
grant select, insert, update, delete on public.voice_purposes to authenticated;
grant select on public.voice_purpose_attempts to authenticated;

-- Admins manage the registry. The initplan wrapper on has_role is the pattern
-- admin-rls-policies already establishes — without it the function is
-- re-evaluated per row.
create policy voice_purposes_admin_all on public.voice_purposes
  for all to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)));

-- Attempts are readable by admins and written only by the worker, which uses
-- the service role and bypasses RLS. No insert/update policy exists on purpose:
-- nothing that authenticates as a user may create a dial attempt.
create policy voice_purpose_attempts_admin_read on public.voice_purpose_attempts
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)));

create trigger voice_purposes_set_updated_at
  before update on public.voice_purposes
  for each row execute function public.set_updated_at();

create trigger voice_purpose_attempts_set_updated_at
  before update on public.voice_purpose_attempts
  for each row execute function public.set_updated_at();

-- ── the three that already exist, described rather than moved ────────────────

insert into public.voice_purposes (key, display_name, description, is_builtin, enabled, lead_ms, sort_order)
values
  ('rsvp', 'אישור הגעה — "מאושר"', 'מתקשר לאורח לאשר הגעה לאירוע. מופעל ממנוע הקמפיין.', true, true, 0, 10),
  ('meeting_confirm', 'אישור שיחה חוזרת', 'מאשר מול הפונה שהשיחה שנקבעה לו עדיין מתאימה. מחייג כ-24 שעות לפני המועד.', true, true, 86400000, 20),
  ('sales', 'סגירת מכירה — "עומר"', 'מחזיר שיחה למי שביקש לשמוע על רכישת השירות.', true, true, 0, 30)
on conflict (key) do nothing;
