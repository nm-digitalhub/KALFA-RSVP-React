-- An ElevenLabs post-call analysis can belong to any of the five attempt tables.
--
-- ⚠️ THE MEASUREMENT THAT FORCED THIS. On 2026-09-14 `call_analysis` held 39
-- rows and only 20 were linked — and the split was not random:
--
--   agent_9701kxj3…  KALFA-RSVP            24 rows, 20 linked
--   agent_3601m0mt…  Meeting-Confirm        7 rows,  0 linked
--   agent_4101m0my…  Sales-Close            6 rows,  0 linked
--   agent_8801m0d6…  RSVP customer service  2 rows,  0 linked
--
-- Three agents have NEVER linked a single call. `storeCallAnalysis` resolves the
-- owning attempt by looking up `el_correlation_nonce` / `el_conversation_id` in
-- `call_attempts` — and only there. The other three agents write their attempts
-- to `callback_request_attempts`, `sales_call_attempts` and
-- `inbound_agent_attempts`, which carry the same `el_conversation_id` column and
-- were never consulted.
--
-- ⚠️ AND WHY A NEW PAIR RATHER THAN A WIDER LOOKUP. `call_attempt_id` is a
-- FOREIGN KEY to `call_attempts(id)`. Writing a `sales_call_attempts` id into it
-- is not merely wrong, it is a constraint violation — the webhook store would
-- have started failing on exactly the calls it was meant to start recording.
-- The column cannot represent those rows, so the fix cannot be a lookup change
-- alone.
--
-- Postgres has no foreign key to "one of five tables", so the new pair carries
-- none. That is the honest trade: `call_attempt_id` keeps its integrity for the
-- RSVP path it already serves, and the pair reaches the rest. A CHECK keeps the
-- table name inside the known set, which is the part that would actually rot.

alter table public.call_analysis
  add column if not exists attempt_table text,
  add column if not exists attempt_id uuid;

comment on column public.call_analysis.attempt_table is
  'Which attempt table `attempt_id` points at. No FK is possible across five tables; the CHECK below is what keeps it honest.';
comment on column public.call_analysis.attempt_id is
  'The owning attempt row in `attempt_table`. For the RSVP path `call_attempt_id` carries the same id WITH a real foreign key — this pair exists for the four tables that cannot have one.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.call_analysis'::regclass
      and conname = 'call_analysis_attempt_table_known'
  ) then
    alter table public.call_analysis
      add constraint call_analysis_attempt_table_known check (
        attempt_table is null or attempt_table in (
          'call_attempts',
          'callback_request_attempts',
          'sales_call_attempts',
          'inbound_agent_attempts',
          'voice_purpose_attempts'
        )
      );
  end if;

  -- Both or neither. A table name with no id says nothing, and an id with no
  -- table cannot be resolved — either alone is a row that looks linked and is not.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.call_analysis'::regclass
      and conname = 'call_analysis_attempt_pair_complete'
  ) then
    alter table public.call_analysis
      add constraint call_analysis_attempt_pair_complete check (
        (attempt_table is null) = (attempt_id is null)
      );
  end if;
end $$;

-- Reading "every analysis for this attempt" is the query the admin voice pages
-- make; without this it is a sequential scan that grows with every call.
create index if not exists call_analysis_attempt_idx
  on public.call_analysis (attempt_table, attempt_id)
  where attempt_id is not null;

-- ── backfill the 20 rows that ARE linked ─────────────────────────────────────
--
-- Purely derived: every one of these already carries `call_attempt_id`, so the
-- pair is written from a value the row already holds. Nothing is guessed, and a
-- row with no existing link stays unlinked — those need the webhook's own
-- correlation id and are the linker's job, not a migration's.

update public.call_analysis
set attempt_table = 'call_attempts',
    attempt_id = call_attempt_id
where call_attempt_id is not null
  and attempt_id is null;
