-- call_analysis: per-role turn counters from the ElevenLabs post-call webhook.
--
-- WHY: "the agent connected" and "a human actually engaged" are different facts,
-- and today only the first one is recorded. The bridge marks a call `completed`
-- (which bills a reached contact) as soon as the WebSocket opens and media
-- starts — regardless of whether anyone ever spoke. A voicemail that the AMD
-- gate misses (there is no Israel/Hebrew AMD model; EU_GENERAL is unvalidated
-- for +972 and fails open by design) therefore looks identical to a real
-- conversation in the data.
--
-- user_turns is the discriminator, verified against real conversations on this
-- account: a completed RSVP call has {agent: 16, user: 7}; a call the guest
-- never engaged with has {}. ElevenLabs exposes message_count only on the LIST
-- endpoint, not in the webhook payload — but the payload does carry the
-- transcript, so the normalizer counts the turns and then drops the transcript.
--
-- PII: these are integers derived from PII and stored INSTEAD of it. No text, no
-- roles' content, nothing that can name a guest — consistent with this table's
-- metadata-only contract (no transcript, no summary, no guest variables).
--
-- Nullable on purpose: rows written before this migration have no counts, and
-- `0` would be a lie (it would read as "nobody spoke" rather than "not
-- measured"). Consumers must treat NULL as unknown, not as zero.

alter table public.call_analysis
  add column if not exists agent_turns integer,
  add column if not exists user_turns  integer;

comment on column public.call_analysis.agent_turns is
  'Agent turns counted from the post-call transcript before it was discarded. NULL = not measured (pre-migration row), not zero.';
comment on column public.call_analysis.user_turns is
  'Guest turns counted from the post-call transcript before it was discarded. 0 with agent_turns > 0 is the voicemail / no-engagement signature. NULL = not measured.';

-- Partial index for the operational question this exists to answer: which
-- completed calls had no guest engagement (candidate voicemails / mis-bills).
create index if not exists call_analysis_no_engagement_idx
  on public.call_analysis (event_id, analysis_at)
  where user_turns = 0;

-- Grants unchanged and deliberately restated: this table already carries
-- `authenticated=r` (read-only) — it did NOT inherit the write privileges that
-- the console views did, and the additive columns must not change that.
revoke all on public.call_analysis from anon;
grant select on public.call_analysis to authenticated;
