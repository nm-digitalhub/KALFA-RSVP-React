-- call_attempts.media_session_access_secure_url — the HTTPS control handle.
--
-- StartScenarios returns BOTH media_session_access_url and
-- media_session_access_secure_url. Only the first was persisted, and it is plain
-- HTTP to a media server by raw IP on a non-standard port:
--   http://<media-ip>:<port>/request/<session>/<access-token>
--
-- That URL is a CAPABILITY, not an identifier — whoever holds it can command the
-- running call, up to terminating it. Sending agent commands (contextual_update,
-- clear_buffer, close_agent) over unencrypted HTTP means the control channel for a
-- live guest conversation crosses the open internet in cleartext, with the access
-- token in the path where any transparent proxy or egress log can capture it.
--
-- Both columns are kept rather than swapping: the plain URL is already written by
-- the deployed dispatcher, and changing which handle an existing writer stores is
-- a separate decision from making the safe one available. Consumers should prefer
-- the secure URL and fall back to the plain one only when the provider did not
-- return it.
--
-- SERVER-ONLY, like its sibling. It must never reach the console app or any
-- client: the app posts to /api/calls/{id}/agent-command with its own JWT and the
-- server resolves the handle. A leaked handle lets its holder hang up on guests.
--
-- Nullable and additive: existing rows keep NULL, and a call whose provider
-- response omitted the field stores NULL rather than a broken value.
--
-- ROLLBACK:
--   alter table public.call_attempts drop column media_session_access_secure_url;

alter table public.call_attempts
  add column if not exists media_session_access_secure_url text;

comment on column public.call_attempts.media_session_access_secure_url is
  'HTTPS control handle for the live VoxEngine session (StartScenarios). Capability, not an identifier — server-only, never exposed to a client. Prefer this over media_session_access_url. NULL when the provider did not return it.';
