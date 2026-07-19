-- =====================================================================
-- call_attempts.el_correlation_nonce — non-authorizing correlation token so
-- ElevenLabs post-call analysis (public.call_analysis) can be linked back to
-- the originating KALFA call attempt WITHOUT round-tripping a live bearer.
--
-- Unlike call_attempts.access_token (a capability token that authorizes ctx
-- reads / media access), this nonce grants NO capability: it is a random,
-- single-purpose, opaque value the bridge stamps onto an ElevenLabs-bridged
-- call and echoes back on the webhook, purely so the linker can resolve
-- conversation -> attempt -> event_id (which then scopes call_analysis owner
-- RLS). Leaking it exposes nothing.
--
-- Additive + idempotent. Nullable, so historical rows and non-EL attempts stay
-- NULL. A PARTIAL unique index enforces one-nonce-one-attempt while permitting
-- unlimited NULLs and keeping the index tight to the EL-bridged subset.
--
-- No RLS change: call_attempts policies stand (admin SELECT via has_role;
-- writes are service-role). No GRANT needed: table-level grants already cover
-- new columns for authenticated/anon/service_role (verified live).
--
-- Rollback:
--   drop index if exists public.call_attempts_el_correlation_nonce_key;
--   alter table public.call_attempts drop column if exists el_correlation_nonce;
-- =====================================================================

alter table public.call_attempts
  add column if not exists el_correlation_nonce text;

create unique index if not exists call_attempts_el_correlation_nonce_key
  on public.call_attempts (el_correlation_nonce)
  where el_correlation_nonce is not null;

comment on column public.call_attempts.el_correlation_nonce is
  'Non-authorizing correlation nonce (random, single-purpose, opaque) stamped on ElevenLabs-bridged calls so the linker can map an EL conversation back to this attempt (and thus its event_id) without exposing access_token. Grants no capability. Nullable; partial-unique where not null.';
