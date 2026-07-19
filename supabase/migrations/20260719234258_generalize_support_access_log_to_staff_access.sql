-- Generalize support_access_log into a staff DATA-ACCESS audit log.
--
-- WHY: Step 2 routes staff cross-tenant reads through service_role (which bypasses
-- RLS). That is only an improvement over the dropped has_role policies if the reads
-- are OBSERVABLE — otherwise staff access goes from ungated to unaudited. The table
-- already records the support surface's event views, but it is event-shaped
-- (event_id NOT NULL) and break-glass-shaped (reason NOT NULL), so it cannot
-- record a targeted read whose subject is a USER (getUserDetail) or an operational
-- read that carries no break-glass reason (a manage_voice/manage_billing reader
-- doing its defined job on one event).
--
-- Generalize in place — do NOT rename (the existing writer, RLS policy and the
-- owner-facing "who viewed my account" query all key on this table). Only 1 row
-- exists live, so relaxing columns is free now and painful later.

-- Under what AUTHORITY the read happened (the permission key), so the trail says
-- not just "who + what" but "acting as which capability".
alter table public.support_access_log
  add column if not exists permission text;

-- Generic subject: 'event' | 'user' | 'guest_list' | 'call_attempts' | ...
-- event_id is kept (backward compatible, still populated for event subjects) but
-- relaxed to NULL-able so a user-subject read is representable.
alter table public.support_access_log
  add column if not exists subject_type text,
  add column if not exists subject_id uuid;

alter table public.support_access_log
  alter column event_id drop not null;

-- reason stays a column but becomes optional at the DB layer. Break-glass surfaces
-- (view_customer_data support, manage_staff user detail) still REQUIRE a reason —
-- that is enforced in the recordStaffAccess() helper, not the column, so routine
-- operational targeted reads are not forced into reason-fatigue.
alter table public.support_access_log
  alter column reason drop not null;

-- owner_id is the join key for "was MY account accessed" — the helper always
-- populates it; the column stays NULL-able only for the one legacy row.
comment on table public.support_access_log is
  'Staff data-access audit: one row per TARGETED staff read of an identified '
  'customer subject. staff_id + permission (authority) + subject_type/subject_id '
  '+ owner_id (join key) + accessed_at, and reason where break-glass. Never '
  'stores the accessed PII itself. Written only via createAdminClient; anon/'
  'authenticated hold no DML (20260719231423). Owner reads own rows via '
  'support_access_log_owner_select.';

-- Index the owner join for the subject-access query, and the subject lookup.
create index if not exists support_access_log_owner_idx
  on public.support_access_log (owner_id, accessed_at desc);
create index if not exists support_access_log_subject_idx
  on public.support_access_log (subject_type, subject_id);
