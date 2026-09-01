-- Fields ElevenLabs already sends in every post_call_transcription payload and
-- this table had nowhere to put — MEASURED 2026-09-01 against the real payload
-- for conv_8901m1cyjc04e5rr99qjf832yj1f (the first sales call), which carried
-- all six and was discarded because the webhook was rejecting on a wrong
-- secret. Nothing here needs a new provider call: it arrives with the analysis
-- we already store, on the same delivery.
--
-- Every column is nullable and none is backfilled. Rows written before this
-- migration keep NULL, and ElevenLabs itself omits some of these per call
-- (sentiment_analysis is null on short calls; voicemail detection reports
-- nothing when the feature is off on the agent). A reader must treat NULL as
-- "not reported", never as a value.
--
-- Shared table: it holds the RSVP, meeting-confirm AND sales personas. These
-- are conversation-level fields that apply to all three, not a sales-only
-- extension.

alter table public.call_analysis
  -- ElevenLabs' own Hebrew narrative of what happened on the call, and its
  -- short title. NOT a transcript: no turns, no quoted speech — a description
  -- written after the fact. It is the single most useful thing on the CRM
  -- screen, which until now could show a score but never what was said.
  --
  -- It does describe the person it is about (their name, their event, the
  -- details they volunteered for a quote). Those same facts already live in
  -- callback_requests and in this table's own el_data, so this introduces no
  -- new category of data — but the "metadata-only" wording on
  -- /admin/callbacks/[id] stops being accurate and is updated with it.
  add column transcript_summary text,
  add column summary_title text,

  -- The AUTHORITATIVE voicemail answer, from ElevenLabs' own detector.
  -- Replaces likelyVoicemail() in data/admin/callbacks.ts, which infers it from
  -- turn counts (userTurns === 0 && agentTurns > 0) — a guess that is right on
  -- an obvious answering machine and wrong on a person who says nothing.
  -- NULL when the detector did not run, which is NOT the same as "no
  -- voicemail"; the inference stays as the fallback for exactly that case.
  add column voicemail_detected boolean,

  -- sentiment_analysis.overall_label / overall_frustration_score. A frustrated
  -- prospect is a reason to call back differently, which is why the frustration
  -- score is worth its own column rather than living inside a jsonb blob.
  -- overall_sentiment_score is deliberately NOT stored: the label carries the
  -- same signal for a human reading the screen.
  add column sentiment_label text,
  add column frustration_score numeric,

  -- metadata.cost_fiat — the actual money the call cost, beside the existing
  -- cost_credits. Credits are ElevenLabs' internal unit; this is what shows up
  -- on the invoice.
  add column cost_fiat numeric;

-- Closed vocabularies, same "text + CHECK" shape every status column on this
-- schema uses. Both allow NULL (not reported) and reject anything else, so an
-- unexpected provider value fails loudly at write time instead of reaching the
-- screen as a raw English token.
alter table public.call_analysis
  add constraint call_analysis_sentiment_label_valid
    check (sentiment_label is null or sentiment_label in ('positive', 'neutral', 'negative')),
  add constraint call_analysis_frustration_score_range
    check (frustration_score is null or (frustration_score >= 0 and frustration_score <= 1)),
  add constraint call_analysis_cost_fiat_nonneg
    check (cost_fiat is null or cost_fiat >= 0);

comment on column public.call_analysis.transcript_summary is
  'ElevenLabs transcript_summary — a written description of the call, not a transcript. Contains details the caller volunteered.';
comment on column public.call_analysis.voicemail_detected is
  'ElevenLabs voicemail detector. NULL = detector did not run, which is not the same as false.';
