-- DB-level enforcement of an invariant that was previously ONLY app-layer
-- (createCampaign's "create-or-continue: never a second campaign for the same
-- event" + getCampaignForEvent's .neq('status','cancelled')). A PLAIN
-- unique(event_id) would be wrong: the real rule is "at most one NON-CANCELLED
-- campaign per event" — a cancelled campaign deliberately does NOT block a
-- fresh one (the cancel-and-recreate case billing.ts's credit-total comment
-- already anticipates). Verified against live data 2026-08-30: zero events
-- currently have more than one non-cancelled campaign, so this applies clean.
create unique index campaigns_one_active_per_event
  on public.campaigns (event_id)
  where status <> 'cancelled';
