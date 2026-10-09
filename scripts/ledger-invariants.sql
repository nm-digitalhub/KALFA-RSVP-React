-- Ledger invariants. READ-ONLY: one SELECT, it changes nothing.
--
--   npx supabase db query --linked -f scripts/ledger-invariants.sql
--
-- Run it after every `db push` that touches the payment ledger, after every real or test payment run on a new terminal, and at the
-- go-live acceptance. Every row with kind = 'invariant' must say status = 'OK' (value 0). A 'CHECK' row lists up to five ids
-- (the first eight characters of each) to look at. 'info' rows are figures, not verdicts.
-- Plan: docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md, sections 5 and 8.
--
-- What each invariant protects:
--   1. A test payment that came back from CardCom naming another terminal, or none, was parked for a person (settle never counts it).
--      A succeeded TEST row without an echo equal to its stamp is therefore either a payment that bypassed that check or one a person
--      approved by hand after looking in CardCom: both deserve a second look.
--   2. A CardCom payment written after the stamp migration with no terminal was written by code that predates the stamp (the
--      "bridge"): it would count as revenue whatever terminal it really went through.
--   3. A refund or release takes provider, terminal and class from the payment it reverses (the database trigger does it). A child that
--      differs means that trigger did not run, or a row was edited.
--   4. Revenue (owner_agent_billing_sums: the owner's reports and the osek-patur ceiling check) must equal an independent sum of the
--      succeeded REAL collects minus returns, plus the pre-ledger campaigns. A difference means the function drifted from the rule.

with
  ledger as (
    select o.*, k.effect
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
  ),
  independent_revenue as (
    select coalesce((select sum(c.final_charge_amount)
                       from public.campaigns c
                      where c.charge_status = 'charged'
                        and c.charged_at >= timestamptz '2026-01-01T00:00:00Z'
                        and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)), 0)
         + coalesce((select sum(case l.effect when 'collect' then l.amount else -l.amount end)
                       from ledger l
                      where l.outcome = 'succeeded'
                        and not l.is_test
                        and l.effect in ('collect', 'return')
                        and l.occurred_at >= timestamptz '2026-01-01T00:00:00Z'), 0) as total
  ),
  function_revenue as (
    select s.charged_amount as total
      from public.owner_agent_billing_sums(timestamptz '2026-01-01T00:00:00Z') s
  ),
  checks(name, violations, examples) as (
    select 'a succeeded TEST payment whose reported terminal is not the one it was opened on (or CardCom reported none)',
           count(*)::numeric,
           coalesce(string_agg(left(l.id::text, 8), ', ' order by l.recorded_at), '')
      from ledger l
     where l.is_test
       and l.outcome = 'succeeded'
       and l.parent_operation_id is null
       and l.provider_terminal_echo is distinct from l.provider_terminal
    union all
    select 'a CardCom payment written after the stamp migration (8.10.2026) that has no terminal',
           count(*)::numeric,
           coalesce(string_agg(left(l.id::text, 8), ', ' order by l.recorded_at), '')
      from ledger l
     where l.meta ->> 'provider' = 'cardcom'
       and l.provider_terminal is null
       and l.recorded_at >= timestamptz '2026-10-08T00:00:00+03:00'
    union all
    select 'a refund or release whose provider, terminal or class differs from the payment it reverses',
           count(*)::numeric,
           coalesce(string_agg(left(c.id::text, 8), ', ' order by c.recorded_at), '')
      from ledger c
      join ledger p on p.id = c.parent_operation_id
     where (c.provider, c.provider_terminal, c.is_test) is distinct from (p.provider, p.provider_terminal, p.is_test)
    union all
    select 'revenue: owner_agent_billing_sums differs from the independent sum of real money',
           case when abs((select total from function_revenue) - (select total from independent_revenue)) > 0.005 then 1 else 0 end::numeric,
           'function ' || (select total from function_revenue)::text || ' / independent ' || (select total from independent_revenue)::text
  )
select 'invariant' as kind, c.name, c.violations as value, case when c.violations = 0 then 'OK' else 'CHECK' end as status, c.examples
  from checks c
union all
select 'info', 'ledger rows (all)', count(*)::numeric, '', ''
  from public.payment_operations
union all
select 'info', 'rows opened on a test terminal (is_test)', count(*)::numeric, '', coalesce(string_agg(distinct o.provider_terminal::text, ', '), '')
  from public.payment_operations o
 where o.is_test
union all
select 'info', 'revenue since 2026-01-01 (real money only)', (select total from function_revenue), '', ''
union all
select 'info', 'CardCom payments by terminal (rows)', count(*)::numeric, '',
       coalesce((select string_agg(coalesce(t.provider_terminal::text, 'none') || ': ' || t.n, ', ' order by t.provider_terminal nulls first)
                   from (select o2.provider_terminal, count(*) as n
                           from public.payment_operations o2
                          where o2.provider = 'cardcom' or o2.meta ->> 'provider' = 'cardcom'
                          group by o2.provider_terminal) t), '')
  from public.payment_operations o3
 where o3.provider = 'cardcom' or o3.meta ->> 'provider' = 'cardcom'
order by 1, 2;
