-- inquiry_messages.message_id: plain (non-partial) UNIQUE constraint. Prevents a
-- webhook_inbox retry-after-partial-failure (attachReplyToInquiry re-running after its
-- inquiry_messages.insert() already succeeded but a later step failed) from writing a
-- duplicate thread row for the same inbound Graph message.
--
-- Why a plain constraint, not a partial one — verified against both official sources:
-- NULL is always distinct from NULL under a standard PostgreSQL UNIQUE constraint, so the
-- many rows with message_id = NULL (every web-form-originated inquiry -- confirmed live
-- 2026-08-25: 8 of the 9 existing inquiry_messages rows with direction = 'inbound' already
-- have message_id = NULL, and zero duplicate non-null values exist today, so this needs no
-- backfill and is safe to add now) are entirely unaffected -- no `where message_id is not
-- null` predicate is needed at all. A partial index was considered first and rejected:
-- PostgreSQL's own docs state `ON CONFLICT (message_id)` infers a partial index only when
-- the same WHERE predicate is repeated in the ON CONFLICT clause itself, and Supabase-js's
-- .upsert() onConflict option is a bare column-name string with no way to express that
-- predicate -- pairing a partial index with the .upsert({onConflict:'message_id',
-- ignoreDuplicates:true}) call in attachReplyToInquiry would fail at runtime with "no
-- unique or exclusion constraint matching the ON CONFLICT specification." A plain
-- constraint sidesteps the mismatch entirely.
--
-- Kept in its own migration (not folded into contact_messages_ref_code) -- touches a
-- different table with its own change history.
--
-- Rollback: alter table public.inquiry_messages drop constraint if exists
--   inquiry_messages_message_id_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inquiry_messages_message_id_key'
      and conrelid = 'public.inquiry_messages'::regclass
  ) then
    alter table public.inquiry_messages
      add constraint inquiry_messages_message_id_key unique (message_id);
  end if;
end $$;

comment on constraint inquiry_messages_message_id_key on public.inquiry_messages is
  'Prevents a webhook_inbox retry-after-partial-failure from writing a duplicate thread
   row for the same inbound Graph message. NULL (web-form-originated rows) is exempt by
   standard Postgres UNIQUE semantics — no partial-index predicate needed or used, since
   Supabase-js upsert() cannot express one. See docs/inquiry-email-threading-fix-plan-
   2026-08-25.md §2.7.';
