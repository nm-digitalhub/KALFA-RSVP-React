-- Owner WhatsApp agent: manual approval on the allow-list
-- (plans/owner-agent-allowlist-override-plan.md, owner decision 2026-09-27).
--
-- Until now an allow-list row could only belong to platform staff whose row
-- phone equals their SMS-verified phone. The owner may now approve, by hand
-- and with a written reason:
--   * staff_unverified_override — a staff member whose phone is not verified;
--   * external_override         — a person who is not platform staff at all.
-- The row the owner approved becomes the identity of whoever talks to the
-- agent, so intake and audit rows now point at it (allowlist_entry_id).
--
-- Additive except for two relaxed NOT NULLs (allow-list and intake
-- staff_user_id), which a non-staff row needs. Every existing row keeps
-- behaving exactly as before: its approval_kind defaults to verified_staff.

-- --- 1. Allow-list: approval kind + who approved, when and why -------------

alter table public.owner_agent_allowlist
  alter column staff_user_id drop not null,
  add column if not exists approval_kind text not null default 'verified_staff',
  add column if not exists approved_by   uuid references auth.users (id),
  add column if not exists approved_at   timestamptz,
  add column if not exists approval_note text;

alter table public.owner_agent_allowlist
  -- A closed list on purpose: each value selects a different gate.
  add constraint owner_agent_allowlist_approval_kind_chk
    check (approval_kind in ('verified_staff', 'staff_unverified_override', 'external_override')),
  -- Staff rows carry a staff member; an external row never does.
  add constraint owner_agent_allowlist_kind_staff_chk
    check ((approval_kind = 'external_override') = (staff_user_id is null)),
  -- A manual approval always records who, when and why.
  add constraint owner_agent_allowlist_manual_fields_chk
    check (approval_kind = 'verified_staff'
           or (approved_by is not null and approved_at is not null and approval_note is not null)),
  add constraint owner_agent_allowlist_approval_note_len
    check (approval_note is null or char_length(btrim(approval_note)) between 1 and 500),
  -- An external person has no staff profile; the label is their name on screen.
  add constraint owner_agent_allowlist_external_label_chk
    check (approval_kind <> 'external_override' or (label is not null and char_length(btrim(label)) > 0));

create index if not exists owner_agent_allowlist_approved_by_idx
  on public.owner_agent_allowlist (approved_by) where approved_by is not null;

comment on column public.owner_agent_allowlist.approval_kind is
  'verified_staff: staff + row phone = verified phone (the original gate). '
  'staff_unverified_override: staff, phone not verified, approved by the owner. '
  'external_override: not staff, approved by the owner.';


-- --- 2. Intake: the allow-list row the message came through ----------------

alter table public.owner_agent_intake
  alter column staff_user_id drop not null,
  add column if not exists allowlist_entry_id uuid
    references public.owner_agent_allowlist (id) on delete cascade;

-- Backfill: every existing intake row belongs to a staff member with exactly
-- one allow-list row (measured 2026-09-27: 18/18 rows mappable, 2 rows for 2
-- staff members).
update public.owner_agent_intake i
   set allowlist_entry_id = a.id
  from public.owner_agent_allowlist a
 where i.allowlist_entry_id is null
   and a.staff_user_id = i.staff_user_id;

-- Deliberately left NULLABLE: this migration is applied before the code that
-- writes the column is deployed, and the live route must keep inserting in
-- that window. The new code always sets it, and the consumer refuses a row
-- without it (not_allowlisted). A later migration may add NOT NULL.

create index if not exists owner_agent_intake_entry_received_idx
  on public.owner_agent_intake (allowlist_entry_id, received_at desc);

-- Column-level grant (section 5 of 20260924034054): the new id is visible to
-- the owner's session, the question text still is not.
grant select (allowlist_entry_id) on table public.owner_agent_intake to authenticated;


-- --- 3. Audit: which allow-list row a decision was about -------------------

alter table public.owner_agent_audit
  add column if not exists allowlist_entry_id uuid
    references public.owner_agent_allowlist (id) on delete set null;

create index if not exists owner_agent_audit_entry_occurred_idx
  on public.owner_agent_audit (allowlist_entry_id, occurred_at desc)
  where allowlist_entry_id is not null;


-- --- Dry run (run by hand in a transaction that ROLLBACKs; not executed here) ---
-- begin;
--   <this file>
--   -- a) no anon/PUBLIC access, authenticated read-only, RLS still on
--   select has_table_privilege('anon', 'public.owner_agent_allowlist', 'select'),        -- f
--          has_table_privilege('public', 'public.owner_agent_allowlist', 'select'),      -- f
--          has_table_privilege('authenticated', 'public.owner_agent_allowlist', 'insert'), -- f
--          (select relrowsecurity from pg_class where oid = 'public.owner_agent_allowlist'::regclass); -- t
--   -- b) intake: new id readable, text still not
--   select has_column_privilege('authenticated', 'public.owner_agent_intake', 'allowlist_entry_id', 'select'), -- t
--          has_column_privilege('authenticated', 'public.owner_agent_intake', 'message_text', 'select'),       -- f
--          has_column_privilege('anon', 'public.owner_agent_intake', 'allowlist_entry_id', 'select');          -- f
--   -- c) every existing row stayed verified_staff and mapped (measured 2026-09-27 via a
--   --    rolled-back DO block through `supabase db query`: all as expected, 18 rows mapped)
--   select count(*) filter (where approval_kind <> 'verified_staff') from public.owner_agent_allowlist; -- 0
--   select count(*) filter (where allowlist_entry_id is null) from public.owner_agent_intake;           -- 0
-- rollback;
