-- el_conversation_id on callback_request_attempts.
--
-- Why: found by token-routes-review 2026-08-22 -- callback_request_attempts
-- was missing this column, which sales_call_attempts already has (added
-- 20260822104725_sales_call_attempts_token_surface.sql, for ElevenLabs
-- post-call webhook correlation). The meeting-booking agent is an
-- ElevenLabs Conversational agent, same as RSVPAgent and the sales-closing
-- agent -- it needs the same correlation mechanism to link its post-call
-- webhook back to the attempt row.
--
-- Same shape as its two siblings: call_attempts.el_conversation_id
-- (20260719170227_el_call_analysis_qa_columns.sql, the original precedent)
-- and sales_call_attempts.el_conversation_id (20260822104725) -- nullable
-- text, unique only when set (`unique index ... where el_conversation_id is
-- not null`), non-authorizing (identity for ctx/cb remains the access_token,
-- never this field).
--
-- No RLS/GRANT changes: posture set in the parent migration, unaffected by
-- adding a column.
--
-- Validated: run inside an explicit BEGIN/ROLLBACK against the linked
-- project (2026-08-22), confirming the ALTER and unique index apply cleanly
-- against the live table, then rolled back. NOT applied outside that
-- transaction -- staged pending explicit go, same process as the rest of
-- this series.
--
-- Rollback: drop index callback_request_attempts_el_conversation_id_key;
-- alter table public.callback_request_attempts drop column
-- el_conversation_id.

alter table public.callback_request_attempts
  add column el_conversation_id text;

create unique index callback_request_attempts_el_conversation_id_key
  on public.callback_request_attempts (el_conversation_id)
  where el_conversation_id is not null;

comment on column public.callback_request_attempts.el_conversation_id is
  'ElevenLabs conversation id, unique when set -- same shape as call_attempts.el_conversation_id and sales_call_attempts.el_conversation_id. Non-authorizing correlation only; identity for the ctx/cb routes remains access_token.';
