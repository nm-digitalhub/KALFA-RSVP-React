-- =====================================================================
-- Consult-before-transfer: separate "dialing the consult target" from
-- "the private operator<->target bridge is actually live".
--
-- The honesty bug this closes (found in the consult/conference audit,
-- 13.8): console_calls.consult_agent_id is written on `consult_started`
-- — the instant the scenario BEGINS dialing — and call-bar.tsx gates
-- BOTH the "ביטול התייעצות" (cancel) button AND the "השלמת העברה"
-- (complete transfer) button on that one field. So "Complete transfer"
-- renders enabled up to TRANSFER_TIMEOUT_MS (20s) before the target may
-- ever answer. Clicking it in that window delivers consult_complete,
-- which the scenario's completeConsult() guards on state.consultActive
-- and silently no-ops — the operator gets a 202 and then nothing. That
-- is the save_rsvp 'queued' false-promise pattern again: claiming a
-- state before it is true.
--
-- Why a second column instead of moving the consult_agent_id write to
-- consult_connected (the fix the audit proposed): moving it makes the
-- CANCEL button disappear during the dial window too, since both read
-- the same field — the operator loses the ability to abort a consult
-- that is still ringing. Splitting the signal keeps cancel available
-- from the first moment AND makes complete honest. It also needs NO
-- scenario edit: both scenarios already send `consult_connected`
-- (ConsoleDial:574, ConsoleInbound:561) and the /event route resolves
-- the row from the already-linked session, so no `target` field has to
-- be added to that report — meaning zero new deploy drift against the
-- three scenarios currently live and byte-verified.
--
-- Nullable, no default, no backfill: NULL means "not connected (yet)",
-- which is the correct reading for every historical row as well as for
-- a consult still ringing. Cleared wherever consult_agent_id is cleared
-- (consult_cancelled / consult_failed / consult_complete) so a later
-- consult on the same call starts honest again.
-- =====================================================================

alter table public.console_calls
  add column consult_connected_at timestamptz;

comment on column public.console_calls.consult_connected_at is
  'When the private operator<->consult-target bridge actually went live (the consult_connected scenario event). NULL while the consult target is still ringing, and after any consult ends. Distinct from consult_agent_id, which is set optimistically at consult_started — the UI must gate "complete transfer" on THIS column, and may gate "cancel consult" on consult_agent_id.';
