-- =====================================================================
-- Owner WhatsApp business-data agent: the SUM half of two read tools.
--
-- Plan: plans/owner-whatsapp-agent-plan.md §5, stage 5 — tool 3
-- (billing_summary) and tool 6 (rsvp_totals). Their COUNT half is in
-- src/lib/owner-agent/cores/billing.ts and cores/rsvp.ts as PostgREST head
-- counts and needs nothing here. What cannot be a head count is a SUM:
-- PostgREST aggregate functions are disabled on this project (measured
-- 2026-09-24, read-only: pg_roles.rolconfig of `authenticator` carries no
-- pgrst.db_aggregates_enabled), so without these functions the only way to
-- sum a money or headcount column through the Data API would be to load every
-- row into the process. The plan forbids that (§5: aggregation in the DB, no
-- full lists, no per-campaign getCampaignBillingSummary loop).
--
-- STATUS: file created with `supabase migration new`, NOT applied. Applying it
-- (dry-run, db push, gen types, types:check) needs the owner's approval, like
-- every migration. Until the generated types carry these two functions the
-- cores do not call them and do not return the sum fields.
--
-- Both functions:
--   * return numbers only — no id, no name, no token or card column is read
--     into the result;
--   * STABLE, SECURITY INVOKER: they run with the caller's rights. The only
--     caller is service_role (the owner-agent process and the admin client),
--     which already reads these tables; nothing is widened;
--   * search_path = '' with schema-qualified names (the pattern of the
--     20 live SECDEF functions and of 20260924034054_owner_agent_whatsapp.sql);
--   * EXECUTE: service_role only. PUBLIC receives EXECUTE on CREATE and
--     anon/authenticated receive it through the schema-public default
--     privileges, so all three are revoked before the one grant.
--
-- Definitions are REUSED, not invented, so the agent and the existing screens
-- cannot disagree:
--   * charged revenue = charge_status = 'charged', dated by charged_at — the
--     definition of src/lib/data/tax-ceiling.ts (the only rows that count as
--     turnover);
--   * invited people = greatest(coalesce(expected_count, 1), 1) and attending
--     people = public.guest_effective_attending(g) — exactly public.guest_totals
--     (20260907141542_restore_guest_totals_migration_contract.sql), summed over
--     guests of ACTIVE events instead of one event. guest_effective_attending
--     is executable by service_role (measured 2026-09-24).
-- =====================================================================


-- --- 1. billing_summary sums --------------------------------------------
-- _since is the start of the requested range ('today' = Israel midnight,
-- '7d'/'30d' = rolling windows; computed in src/lib/owner-agent/range.ts).
create or replace function public.owner_agent_billing_sums(_since timestamptz)
returns table (
  charged_amount numeric,         -- final charges captured in range
  credit_applied_amount numeric,  -- credit consumed by close-charges in range
  unvoided_credit_amount numeric, -- all credit granted and not voided (current)
  credit_granted_amount numeric   -- credit granted in range and not voided
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce((
      select sum(c.final_charge_amount)
      from public.campaigns c
      where c.charge_status = 'charged'
        and c.charged_at >= _since
    ), 0),
    coalesce((
      select sum(c.credit_applied)
      from public.campaigns c
      where c.charge_status in ('charged', 'nothing_to_charge')
        and c.charged_at >= _since
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
    ), 0),
    coalesce((
      select sum(b.amount)
      from public.billing_credits b
      where b.voided_at is null
        and b.created_at >= _since
    ), 0);
$$;

comment on function public.owner_agent_billing_sums(timestamptz) is
  'Owner-agent billing_summary: money sums only (charged, credit applied, '
  'credit granted). No row data. EXECUTE: service_role only.';

revoke all on function public.owner_agent_billing_sums(timestamptz)
  from public, anon, authenticated;
grant execute on function public.owner_agent_billing_sums(timestamptz) to service_role;


-- --- 2. rsvp_totals people sums -----------------------------------------
create or replace function public.owner_agent_rsvp_people_totals()
returns table (
  invited_people bigint,   -- guest_totals.invited_people, over active events
  attending_people bigint  -- guest_totals.attending_people, over active events
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(greatest(coalesce(g.expected_count, 1), 1)), 0)::bigint,
    coalesce(sum(public.guest_effective_attending(g)), 0)::bigint
  from public.guests g
  join public.events e on e.id = g.event_id
  where e.status = 'active';
$$;

comment on function public.owner_agent_rsvp_people_totals() is
  'Owner-agent rsvp_totals: invited/attending PEOPLE across active events, '
  'with the guest_totals definitions. No row data. EXECUTE: service_role only.';

revoke all on function public.owner_agent_rsvp_people_totals()
  from public, anon, authenticated;
grant execute on function public.owner_agent_rsvp_people_totals() to service_role;


-- --- Post-apply checks (read-only; run after db push, before gen types) ---
-- a. EXECUTE: expect service_role = true; anon, authenticated, public = false.
--    select r, has_function_privilege(r, 'public.owner_agent_billing_sums(timestamptz)', 'execute')
--    from unnest(array['service_role','anon','authenticated']) r;
--    select count(*) from pg_proc p, aclexplode(p.proacl) a
--    where p.proname like 'owner_agent_%' and a.grantee = 0;   -- expect 0
-- b. Shape: proconfig = {search_path=""}, prosecdef = false, provolatile = 's'.
-- c. Parity: for one active event E,
--    guest_totals(E)->>'invited_people' summed over active events equals
--    owner_agent_rsvp_people_totals().invited_people (same for attending).
