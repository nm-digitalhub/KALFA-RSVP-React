-- Move three link invariants out of TypeScript and into the database.
--
-- Each was enforced only by application code — one by a ternary, one by a
-- convention, one by luck — and tonight's investigation found that the data
-- already disagrees with two of them. PostgreSQL's own documentation is the
-- basis here, not any Supabase-specific rule: CHECK constraints may reference
-- other columns of the same row, and "a check constraint is satisfied if the
-- check expression evaluates to true OR THE NULL VALUE" — which is why every
-- predicate below is written to return a definite boolean.
--
-- ─── 1. `voice_purpose_attempts` had no uniqueness on el_conversation_id ───
--
-- The other four attempt tables all carry a PARTIAL unique index on that
-- column; the newest one — the table the generic voice primitive is built on —
-- does not. `resolveAttempt` reads it with `.maybeSingle()`, so two rows
-- claiming one conversation would raise at read time rather than at write.
-- The table is empty today, so this is free to add now and expensive later.
--
-- ─── 2. `call_attempt_id` could point at a row it does not describe ───
--
-- It is a FOREIGN KEY to `call_attempts`, and four of the five attempt tables
-- can never fill it. The code keeps it null for the other four via a ternary,
-- and a unit test guards that — but nothing stopped a writer from setting
-- `call_attempt_id` alongside `attempt_table = 'sales_call_attempts'`.
--
-- ⚠️ `attempt_table = 'call_attempts'` is NOT good enough: with attempt_table
-- NULL that yields NULL, and a NULL check PASSES. `IS NOT DISTINCT FROM` is
-- documented to "act as though null were a normal data value" and never
-- returns null, so the predicate stays a real boolean in every case.
-- VERIFIED before writing: 0 of 42 rows violate this.
--
-- ─── 3. `linked_at` did not mean "linked" ───
--
-- MEASURED: 4 rows carry a linked_at with attempt_table/attempt_id NULL — all
-- from 21.07, predating the polymorphic pair. So the column could not be used
-- to answer "is this analysis linked?", and the honest answer was to read the
-- pair instead. This makes the column trustworthy rather than avoided: clear
-- the four stale stamps (they were never linked to anything), then couple it to
-- the pair the same way `call_analysis_attempt_pair_complete` couples the pair
-- to itself. `(x IS NULL) = (y IS NULL)` compares two real booleans, so it
-- never evaluates to null.

begin;

-- 1
create unique index if not exists voice_purpose_attempts_el_conversation_id_key
  on public.voice_purpose_attempts (el_conversation_id)
  where el_conversation_id is not null;

-- 2
alter table public.call_analysis
  add constraint call_analysis_fk_only_for_call_attempts
  check (
    call_attempt_id is null
    or attempt_table is not distinct from 'call_attempts'
  );

-- 3
update public.call_analysis
set    linked_at = null
where  linked_at is not null
  and  attempt_id is null;

alter table public.call_analysis
  add constraint call_analysis_linked_at_follows_pair
  check ((linked_at is null) = (attempt_id is null));

commit;
