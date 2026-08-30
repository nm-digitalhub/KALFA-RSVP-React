-- Close the vocabulary on contact_messages.status for the first time — it has
-- been free text since 20260723180000_contact_messages_inquiry_workflow.sql,
-- enforced only in application code (validation/admin.ts CONTACT_STATUSES,
-- Zod-validated at the Server Action boundary). Same gap this project already
-- closed for callback_requests.status in
-- 20260819212112_callback_status_outcome_split.sql (callback_requests_status_
-- valid); this migration does the same for contact_messages. Owner-approved
-- 2026-08-25 (this specific item, from a reported audit finding).
--
-- Verified live before writing this constraint (not inferred):
--   * Data: `select distinct status, count(*) from contact_messages group by
--     status` returns only 'new' (3), 'done' (4), 'cancelled' (1) — a strict
--     subset of the 5 values below. No unexpected value found; nothing to
--     widen or drop.
--   * Every write path in src/ that sets this column, confirmed exhaustive by
--     both a full-tree grep and a pg_catalog sweep for any SECDEF function or
--     trigger body mentioning contact_messages (both empty — no DB-side writer
--     exists beyond PostgREST/the service-role client):
--       - insertContactMessage (inquiry-intake.ts) and the mail-intake insert
--         (inquiry-mail-intake.ts) write no explicit status — both rely on the
--         column DEFAULT, confirmed live as 'new'::text.
--       - updateContactStatus (admin/contacts.ts) writes the Zod-validated
--         ContactStatus param — validation/admin.ts CONTACT_STATUSES = ['new',
--         'in_progress', 'done', 'cancelled'].
--       - sendInquiryReply (admin/contacts.ts) writes the literal 'in_progress'.
--       - runInquiryFollowupSweep (inquiry-followup.ts) writes the literal
--         'done' on auto-close.
--       - attachReplyToInquiry (inquiry-mail-intake.ts) writes the literal
--         'reopened' — the one system-only value, never offered as an admin
--         picklist option (see labels.ts CONTACT_ONLY_STATUS_LABELS).
--     No write path outside this list, and no value outside the 5 below. The
--     constraint is therefore unreachable from current code: every existing
--     writer already produces a conforming value, so this adds no new
--     user-visible 23514 error surface — it only forecloses a future
--     hand-typed value bypassing the app layer.
--   * 8 live rows total, all already conforming — a plain (non-NOT VALID)
--     ADD CONSTRAINT validates instantly; no backfill, no `not valid` +
--     `validate constraint` staging needed.
--
-- Style mirrors callback_requests_status_valid exactly (`= any (array[...])`,
-- lowercase; pg_get_constraintdef normalizes a plain `check (status in (...))`
-- to this same form, so this is not a stylistic deviation from the
-- constraint's stored definition, only from how it is typed here). The ADD
-- CONSTRAINT is wrapped in the same idempotency guard as this table's own
-- most recent migration (20260825124143_contact_messages_rating_schema.sql),
-- not the bare form in 20260819212112 — ALTER TABLE ADD CONSTRAINT has no
-- IF NOT EXISTS, and a re-run after a `db push` that already applied but
-- reported a false failure (see memory: parallel-sessions-one-live-db) must
-- not abort on 42710.
--
-- The column comment is also corrected in place: it previously read "Free
-- text by design, like callback_requests.status" (now false — this migration
-- is exactly what makes it false), named the wrong Zod export
-- (CALLBACK_STATUSES instead of CONTACT_STATUSES), and omitted 'reopened'
-- entirely.
--
-- No RLS, GRANT, or index change — this table carries no admin-facing RLS
-- policy by design (20260720030121_strip_staff_axis_from_customer_tables.sql;
-- access is service-role + requirePlatformPermission), and
-- contact_messages_status_idx already exists (from
-- 20260723180000_contact_messages_inquiry_workflow.sql) and needs no rebuild
-- — a CHECK constraint does not change what the index scans.
--
-- Rollback:
--   alter table public.contact_messages
--     drop constraint if exists contact_messages_status_valid;
--   comment on column public.contact_messages.status is
--     'App-level vocabulary (validation/admin.ts CALLBACK_STATUSES): new / in_progress / done / cancelled. Free text by design, like callback_requests.status.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contact_messages_status_valid'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_status_valid
        check (status = any (array['new', 'in_progress', 'done', 'cancelled', 'reopened']));
  end if;
end $$;

comment on column public.contact_messages.status is
  'App-level vocabulary (validation/admin.ts CONTACT_STATUSES): new / in_progress / done / cancelled. ''reopened'' is a fifth value, set only by attachReplyToInquiry (inquiry-mail-intake.ts) when a customer replies on an already-answered thread — never a pickable admin option. Enforced at the DB level by contact_messages_status_valid (added 20260825133136).';
