-- =====================================================================
-- ElevenLabs call-analysis: QA columns + a SECOND conversation link vector.
--
-- Two additive, nullable-only changes. No RLS/policy/GRANT changes: both
-- tables already have RLS enabled and table-level grants that cover new
-- columns (call_attempts: full grants to authenticated/anon/service_role;
-- call_analysis: SELECT to authenticated, service_role full — VERIFIED-LIVE).
--
-- 1) public.call_attempts.el_conversation_id (text, nullable)
--    Link vector #2. The Voximplant<->ElevenLabs bridge scenario reports the
--    ElevenLabs conversation_id back via the KALFA cb endpoint; the webhook
--    linker can then resolve call_analysis.conversation_id ->
--    call_attempts.el_conversation_id -> event_id (which scopes call_analysis
--    owner RLS). This complements el_correlation_nonce (vector #1): the nonce
--    is stamped outbound and echoed back; el_conversation_id is the provider's
--    own conversation id observed on the bridge. It is a provider identifier,
--    NOT a capability token — leaking it grants nothing. PARTIAL unique index
--    (where not null) enforces one-conversation-one-attempt while permitting
--    unlimited NULLs and keeping the index tight to the EL-bridged subset —
--    same shape as call_attempts_el_correlation_nonce_key.
--
-- 2) public.call_analysis QA columns — all nullable, populated only when the
--    ElevenLabs agent has evaluation / data-collection enabled. This table is
--    a METADATA-ONLY sink (no guest PII); these columns keep that contract:
--    PII-SAFE STRUCTURED data only, no free-text rationale, no guest names.
--      * el_call_score numeric  -- ElevenLabs call_success_score.
--      * el_eval       jsonb    -- flat {criterion_name: 'success'|'failure'}
--                                  pass/fail per evaluation criterion; NO
--                                  rationale text.
--      * el_data       jsonb    -- small structured RSVP extraction
--                                  {status, adults, children} — the agent's own
--                                  read, for cross-checking save_rsvp; NO
--                                  names/notes.
--    Owner (can_access_event) + admin (has_role) SELECT policies and the
--    service-role write path are unchanged; new columns inherit the existing
--    table-level SELECT grant to authenticated. No new index needed.
--
-- Conventions verified against the live schema:
--   * 20260719162804_call_attempts_el_correlation_nonce.sql — nullable text +
--     partial-unique-where-not-null link column; no RLS/GRANT change.
--   * 20260719154428_call_analysis.sql — metadata-only sink; owner/admin
--     SELECT via can_access_event/has_role; service-role writes.
--
-- Rollback:
--   drop index if exists public.call_attempts_el_conversation_id_key;
--   alter table public.call_attempts  drop column if exists el_conversation_id;
--   alter table public.call_analysis  drop column if exists el_call_score;
--   alter table public.call_analysis  drop column if exists el_eval;
--   alter table public.call_analysis  drop column if exists el_data;
-- =====================================================================

-- 1) Second link vector on call_attempts -----------------------------------
alter table public.call_attempts
  add column if not exists el_conversation_id text;

create unique index if not exists call_attempts_el_conversation_id_key
  on public.call_attempts (el_conversation_id)
  where el_conversation_id is not null;

comment on column public.call_attempts.el_conversation_id is
  'ElevenLabs conversation id observed on the Voximplant<->ElevenLabs bridge and reported back via cb. Link vector #2 (complements el_correlation_nonce): lets the webhook linker map call_analysis.conversation_id back to this attempt and its event_id. Provider identifier, not a capability token. Nullable; partial-unique where not null.';

-- 2) PII-safe structured QA columns on call_analysis -----------------------
alter table public.call_analysis
  add column if not exists el_call_score numeric,
  add column if not exists el_eval jsonb,
  add column if not exists el_data jsonb;

comment on column public.call_analysis.el_call_score is
  'ElevenLabs call_success_score (numeric). Nullable; present only when the agent has evaluation enabled.';
comment on column public.call_analysis.el_eval is
  'Flat evaluation map {criterion_name: ''success''|''failure''} — pass/fail per ElevenLabs evaluation criterion. PII-safe: structured verdicts only, NO rationale text. Nullable.';
comment on column public.call_analysis.el_data is
  'Small structured RSVP extraction {status, adults, children} — the agent''s own read, for cross-checking save_rsvp. PII-safe: NO names/notes/free text. Nullable.';
