-- The dial parameters a workflow node chose for one call.
--
-- WHY THE ATTEMPT ROW AND NOT THE WORKFLOW DEFINITION. The definition says what
-- the node is set to NOW; this says what the call actually used. A node edited
-- after a bad call would otherwise erase the only record of what produced it,
-- and "which agent answered this conversation" is the first question asked when
-- a transcript looks wrong.
--
-- ⚠️ THREE COLUMNS, AND THE DIALLED NUMBER IS DELIBERATELY NOT ONE OF THEM.
-- The rule, the caller id and the agent are account-owned identifiers — nothing
-- about a person. The destination is the guest's phone: it already lives on
-- `contacts`, reachable through `contact_id`, and copying it here would spread
-- personal data into a second table for a debugging convenience. The override,
-- when one is used, is visible in the workflow definition that set it.
--
-- All three are nullable and all three stay NULL for every row written before
-- this shipped, and for every call that takes the defaults. NULL reads as "the
-- purpose's rule / the account's number / the scenario's agent" — which is what
-- those calls in fact used.

alter table public.voice_purpose_attempts
  add column if not exists rule_id text,
  add column if not exists caller_id text,
  add column if not exists agent_id text;

comment on column public.voice_purpose_attempts.rule_id is
  'The Voximplant routing rule this call was started with. NULL = the rule configured on voice_purposes for this purpose.';
comment on column public.voice_purpose_attempts.caller_id is
  'The E.164 number this call was placed FROM. NULL = the account''s configured caller id.';
comment on column public.voice_purpose_attempts.agent_id is
  'The ElevenLabs agent the server named for this call. NULL = whichever agent the deployed scenario hardcodes.';

-- No index. These are read one row at a time, by id, while debugging a single
-- call — never filtered across the table — and an index nothing queries is
-- write cost for nothing.
