-- =====================================================================
-- Separate "stale but self-healing" from "stuck, needs a person".
--
-- The first draft of this table treated a connection with no refresh token as
-- `expired` the moment renewal became impossible. That conflates two
-- independent facts:
--
--   can we still authorize a request?   ← the access token's own expiry
--   can we renew without a human?       ← the grant type, plus whether a
--                                         refresh token was ever issued
--
-- An authorization-code connection that never received a refresh token is a
-- LEGITIMATE state, not a fault: RFC 6749 makes issuing one optional, and RFC
-- 9700 treats its absence as a normal case to be handled by obtaining a new
-- access token through an appropriate grant. Its current access token can still
-- be perfectly valid. Marking it `expired` while it is still working would be
-- wrong in both directions — it under-reports usability and over-reports
-- urgency.
--
-- So the status set now distinguishes:
--
--   pending                    created, authorization not finished
--   active                     has a usable credential
--   expired                    access token past expiry, renewal will be
--                              attempted automatically — the kind supplies a
--                              mechanism and the material exists
--   requires_reauthorization   renewal is impossible without a person. The
--                              access token MAY still be valid; this is a
--                              statement about authorization, not about expiry
--   revoked                    deliberately disconnected
--   failed                     renewal or use failed, with the reason in
--                              last_error
--
-- ROLLBACK:
--   update public.integration_connections
--      set status = 'failed' where status = 'requires_reauthorization';
--   alter table public.integration_connections
--     drop constraint integration_connections_status_check,
--     add constraint integration_connections_status_check
--       check (status in ('pending','active','expired','revoked','failed'));
-- =====================================================================

alter table public.integration_connections
  drop constraint if exists integration_connections_status_check;

alter table public.integration_connections
  add constraint integration_connections_status_check
  check (status in (
    'pending',
    'active',
    'expired',
    'requires_reauthorization',
    'revoked',
    'failed'
  ));

comment on column public.integration_connections.status is
  'pending | active | expired (self-healing: renewal will be retried) | requires_reauthorization (needs a person; the access token may still be valid) | revoked | failed';
