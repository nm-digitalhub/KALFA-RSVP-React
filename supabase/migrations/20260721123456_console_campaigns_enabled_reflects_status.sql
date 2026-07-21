-- console_campaigns.enabled: serve the campaign's REAL running state.
--
-- The view (20260720025656) passed `campaigns.enabled` straight through. That
-- column is vestigial: it defaults to false, is written nowhere in the app, and
-- is read nowhere in the outreach engine — `listActiveCampaigns` selects on
-- `status = 'active'` and nothing else. Every campaign in the database carries
-- enabled = false, including the brit campaign that sent to 38 contacts and
-- closed successfully.
--
-- The native console app trusted that field and rendered an ACTIVE campaign as
-- "מושהה" with an "activate" button, while the web UI (reading `status`) showed
-- "פעיל" for the same row. Same data, two answers, one of them wrong.
--
-- Fix by DERIVING the exposed flag from the operative column rather than
-- dropping it: removing a field the deployed app already deserializes would
-- trade a wrong value for a missing one, and the app cannot be redeployed from
-- this repo. `status` stays exposed alongside, so a client that wants the full
-- lifecycle (draft / pending_approval / approved / scheduled / paused / closed /
-- billed / paid / cancelled) still has it.
--
-- The underlying campaigns.enabled column is left in place and untouched;
-- retiring it is a separate, destructive decision.
create or replace view public.console_campaigns as
  select c.id, c.event_id, c.status,
         (c.status = 'active') as enabled,
         c.start_at, c.close_at,
         c.max_contacts, c.created_at, c.updated_at
  from public.campaigns c
  where public.is_console_agent();

comment on view public.console_campaigns is
  'Console-agent read surface over campaigns. `enabled` is DERIVED (status = active), not the vestigial campaigns.enabled column — see migration 20260721123456.';

-- create or replace view preserves grants, but re-assert the intended posture
-- (read-only for the console role, never anon) so this migration is complete on
-- its own if the view is ever rebuilt from scratch.
revoke all on public.console_campaigns from anon;
grant select on public.console_campaigns to authenticated;
