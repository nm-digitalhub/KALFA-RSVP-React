-- Ledger: record the terminal of every payment, and keep payments on a no-money terminal out of revenue.
-- Plan: docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md, section 5 (migration A).
--
-- WHAT IT DOES
--   1. public.payment_operations gets three columns:
--        provider_terminal       the terminal the payment session was ASKED to open on; written when the row is born (the
--                                application sends it from the same configuration object that builds the CardCom request);
--        provider_terminal_echo  the terminal CardCom REPORTS in its own answer (top level of GetLpResult); written once, on
--                                completion; NULL = not reported;
--        is_test                 set ONCE by the insert trigger from the terminal and frozen afterwards; the application never
--                                writes it.
--   2. public.payment_is_test_terminal(integer) is the ONE definition of a no-money terminal (1000, CardCom's demo terminal).
--      A row's class is decided when the row is written and is never recomputed: editing the function changes only rows
--      written afterwards (it is a plain column, not a generated one, because PostgreSQL computes a generated column only on
--      write, so a function edit would split the history by completion date and a restore would reclassify it).
--      Unknown (NULL terminal: SUMIT, every row written before this file) is REAL and counts as revenue.
--   3. A child row (refund, release) takes provider, terminal and class from its parent, whatever the caller sends, and a
--      refund or a release without a parent is refused (every writer in the application already passes one).
--   4. owner_agent_billing_sums (revenue, the osek-patur ceiling check, the owner's reports) skips is_test rows.
--   5. campaign_has_payment_activity ignores SUCCEEDED test rows, so a campaign paid with test money alone can be cancelled and
--      paid again. Pending and review rows of any class still block, and so does any real succeeded row.
--   6. payment_operations_guard_update also freezes provider, provider_terminal and is_test, and makes the echo write-once.
--
-- WHAT IT DOES NOT DO
--   - It classifies no existing row (owner decision, 8.10.2026: the four pilot rows stay as they are, so the 200.00 of 7.10 stays
--     in revenue and event 5aaf0363 stays welded; the first re-test runs on a fresh event).
--   - It adds no table, deletes nothing and edits no row.
--   - It decides nothing from CardCom's echo: that comparison lives in the application (settle), so that nothing in the
--     database can stop a confirmed payment from being recorded.
--
-- create or replace does NOT keep settings that are not restated. The four functions below were generated from
-- pg_get_functiondef of the linked project on 2026-10-08 and differ from the live text ONLY by the lines marked "[stamp]".
--
-- house assumption (same as 20261006040156): `supabase db push` applies a migration file as ONE transaction, so the
-- verification block at the end rolls the whole file back if any check fails.
--
-- reviewed against the supabase-postgres-best-practices rules (schema-constraints, lock-short-transactions,
-- lock-deadlock-prevention, schema-data-types, security-privileges, security-rls-basics, query indexes, lowercase identifiers).
--
-- DRY RUN (owner, one request; nothing is kept): see the dry-run script delivered with this file. It applies this file's
-- statements, switches to service_role (the role that really writes the ledger) and checks:
--   a) payment_is_test_terminal(1000 / 1001 / null) = true / false / false
--   b) no existing row is classified; the revenue function returns the same figure as before
--   c) a pending package_purchase on ('cardcom', 1000) reads is_test = true, on ('cardcom', 1001) false;
--      ('cardcom', NULL) and ('sumit', 1000) are refused with 23514
--   d) completion to succeeded with the echo works; changing provider, provider_terminal, is_test, or the echo afterwards is
--      refused; succeeded -> failed is refused; the late card_brand fill still works
--   e) a refund sent as ('sumit', 5) reads ('cardcom', 1000, true); a refund without a parent is refused
--   f) campaign_has_payment_activity: false with a succeeded test row alone, true once a pending row exists, true with a real one
--   g) owner_agent_billing_sums: only the real row is added to revenue; the test purchase and the test refund add nothing
--   h) after create or replace payment_is_test_terminal (1001 now a test terminal), a row already written stays as it was
--
-- ROLLBACK (manual): restore the four functions from the pre-change text at the bottom of this file, then
--   alter table public.payment_operations drop constraint payment_operations_provider_stamp_coherent;
--   alter table public.payment_operations drop constraint payment_operations_provider_terminal_positive;
--   alter table public.payment_operations drop column is_test;
--   alter table public.payment_operations drop column provider_terminal_echo;
--   alter table public.payment_operations drop column provider_terminal;
--   drop function public.payment_is_test_terminal(integer);
--   (columns may be dropped only while no row carries a stamp; old application code keeps working without any of this.)

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── 1. the ONE definition of "no-money terminal" ──
create function public.payment_is_test_terminal(p_terminal integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(p_terminal = 1000, false) $$;

revoke execute on function public.payment_is_test_terminal(integer) from public, anon, authenticated;
grant execute on function public.payment_is_test_terminal(integer) to service_role;

comment on function public.payment_is_test_terminal(integer) is
  'The ONE definition of a no-money CardCom terminal (1000, CardCom''s demo terminal). Evaluated once, when a payment row is born, by payment_operations_before_insert; it never reclassifies a row that already exists. Adding a terminal = a reviewed migration that edits this function and says what happens to old rows. service_role EXECUTE is load-bearing: every ledger INSERT calls it.';

-- ── 2. columns and constraints (separate statements, explicit names) ──
alter table public.payment_operations add column provider_terminal integer;
alter table public.payment_operations add column provider_terminal_echo integer;
alter table public.payment_operations add column is_test boolean not null default false;

alter table public.payment_operations
  add constraint payment_operations_provider_terminal_positive
  check (provider_terminal is null or provider_terminal > 0);
alter table public.payment_operations
  add constraint payment_operations_provider_stamp_coherent
  check ((provider = 'cardcom') = (provider_terminal is not null));

comment on column public.payment_operations.provider_terminal is
  'The CardCom terminal the payment session was asked to open on; written at INSERT; NULL for every other provider and for every row written before this column. Also set on a row whose session never opened.';
comment on column public.payment_operations.provider_terminal_echo is
  'The TerminalNumber CardCom reported in its own answer (top level of GetLpResult); written once, on completion; NULL = not reported.';
comment on column public.payment_operations.is_test is
  'Set once by payment_operations_before_insert from provider_terminal (a child: from its parent) and frozen; true = a no-money terminal, not revenue. Never written by the application.';

-- ── 3. the replaced functions (live text + the lines marked [stamp]) ──

CREATE OR REPLACE FUNCTION public.payment_operations_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_status text; v_event uuid; v_effect text; v_once boolean; v_parent_once boolean; v_parent_campaign uuid; v_parent_outcome public.payment_operation_outcome;
        v_parent_provider text; v_parent_terminal integer; v_parent_test boolean; -- [stamp]
begin
  -- Lock the campaign row FIRST, then read its status under the lock: a cancel that committed a moment ago is
  -- seen here (cancel-first scenario. Money may not be committed or collected for a
  -- cancelled campaign; a release/refund (void/return) on one is still allowed — that is how it gets its money back.
  select c.status::text, c.event_id into v_status, v_event from public.campaigns c where c.id = new.campaign_id for update;
  if v_status is null then
    raise exception 'campaign % not found', new.campaign_id using errcode = 'foreign_key_violation';
  end if;
  select k.effect, k.once_per_campaign, k.once_per_parent into v_effect, v_once, v_parent_once
    from public.payment_operation_kinds k where k.kind = new.kind;
  -- [stamp] A refund or a release is always the child of the operation it reverses.
  if v_effect in ('return', 'void') and new.parent_operation_id is null then
    raise exception 'operation kind % needs a parent operation', new.kind using errcode = 'check_violation';
  end if;
  if v_status = 'cancelled' and v_effect in ('commit', 'collect') then
    raise exception 'campaign % is cancelled: no % allowed', new.campaign_id, new.kind using errcode = 'check_violation';
  end if;
  -- coalesce: an unknown kind then fails on the FK (23503, clear) rather than on NOT NULL (23502)
  -- Integrity: event_id is DERIVED from the locked campaign, never trusted from the caller.
  new.event_id := v_event;
  -- A parent must belong to the same campaign and must have succeeded (releasing a failed hold or refunding a
  -- failed charge is meaningless and would corrupt the derived state).
  if new.parent_operation_id is not null then
    select p.campaign_id, p.outcome, p.provider, p.provider_terminal, p.is_test -- [stamp]
      into v_parent_campaign, v_parent_outcome, v_parent_provider, v_parent_terminal, v_parent_test
      from public.payment_operations p where p.id = new.parent_operation_id;
    if v_parent_campaign is distinct from new.campaign_id then
      raise exception 'parent operation % belongs to another campaign', new.parent_operation_id using errcode = 'check_violation';
    end if;
    if v_parent_outcome <> 'succeeded' then
      raise exception 'parent operation % did not succeed (%)', new.parent_operation_id, v_parent_outcome using errcode = 'check_violation';
    end if;
  end if;
  -- [stamp] The class of the row is decided HERE, once, and never recomputed. A child takes its parent's provider, terminal and
  -- class whatever the caller sent; any other row is classified from the terminal it was asked to open on.
  if new.parent_operation_id is not null then
    new.provider := v_parent_provider;
    new.provider_terminal := v_parent_terminal;
    new.is_test := v_parent_test;
    new.provider_terminal_echo := null;
  else
    new.is_test := public.payment_is_test_terminal(new.provider_terminal);
  end if;
  new.once_slot   := coalesce(v_once, false);
  new.parent_slot := coalesce(v_parent_once, false) and new.parent_operation_id is not null;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.payment_operations_guard_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.outcome = 'succeeded' and new.outcome = 'succeeded' and old.card_token_ref is not null
     and old.card_brand is null and old.card_issuer is null
     and (new.card_brand is not null or new.card_issuer is not null)
     and (to_jsonb(new) - 'card_brand' - 'card_issuer') = (to_jsonb(old) - 'card_brand' - 'card_issuer') then
    return new;
  end if;
  if not (
       (old.outcome = 'pending' and new.outcome in ('succeeded', 'failed', 'review'))
    or (old.outcome = 'review'  and new.outcome in ('succeeded', 'failed'))
  ) then
    raise exception 'payment_operations: % → % is not an allowed transition (row %)', old.outcome, new.outcome, old.id
      using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.campaign_id <> old.campaign_id or new.event_id <> old.event_id or new.kind <> old.kind
     or new.parent_operation_id is distinct from old.parent_operation_id
     or new.recorded_at <> old.recorded_at or new.source <> old.source
     or new.once_slot is distinct from old.once_slot or new.parent_slot is distinct from old.parent_slot
     or new.provider is distinct from old.provider -- [stamp]
     or new.provider_terminal is distinct from old.provider_terminal
     or new.is_test is distinct from old.is_test
     or (old.provider_terminal_echo is not null and new.provider_terminal_echo is distinct from old.provider_terminal_echo) then
    raise exception 'only outcome, amounts, provider refs, occurred_at, note and meta may change on completion' using errcode = 'check_violation';
  -- Note: an UPDATE that does not change outcome (e.g. note only on a review row) is rejected by the transition check
  -- above. Interim admin notes go to activity_log, not to the row.
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.owner_agent_billing_sums(_since timestamp with time zone, _until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(charged_amount numeric, credit_applied_amount numeric, unvoided_credit_amount numeric, credit_granted_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    -- charged: campaigns with no ledger row (the old columns) + the ledger, net of returns
    coalesce((
      select sum(c.final_charge_amount)
      from public.campaigns c
      where c.charge_status = 'charged'
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
        and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
    ), 0)
    + coalesce((
      select sum(case k.effect when 'collect' then o.amount else -o.amount end)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
        and not o.is_test -- [stamp]
        and k.effect in ('collect', 'return')
        and o.occurred_at >= _since
        and (_until is null or o.occurred_at < _until)
    ), 0),
    -- credit applied: the same split
    coalesce((
      select sum(c.credit_applied)
      from public.campaigns c
      where c.charge_status in ('charged', 'nothing_to_charge')
        and c.charged_at >= _since
        and (_until is null or c.charged_at < _until)
        and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
    ), 0)
    + coalesce((
      select sum(o.credit_applied)
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
      where o.outcome = 'succeeded'
        and not o.is_test -- [stamp]
        and k.effect = 'collect'
        and o.occurred_at >= _since
        and (_until is null or o.occurred_at < _until)
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
        and (_until is null or b.created_at < _until)
    ), 0);
$function$;

CREATE OR REPLACE FUNCTION public.campaign_has_payment_activity(p_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.payment_operations o
      join public.payment_operation_kinds k on k.kind = o.kind
     where o.campaign_id = p_campaign
       and k.effect <> 'none'
       and o.outcome in ('succeeded', 'pending', 'review')
       and not (o.is_test and o.outcome = 'succeeded') -- [stamp] only SETTLED test money stops counting
  )
$function$;

-- ── 4. verification: aborts, and rolls back whole, when any of these fails ──
do $$
declare
  v_bad      integer;
  v_expected numeric;
  v_actual   numeric;
begin
  -- the grant every ledger INSERT now depends on, and nobody else
  if not has_function_privilege('service_role', 'public.payment_is_test_terminal(integer)', 'execute') then
    raise exception 'ledger_money_source_stamp: service_role cannot execute payment_is_test_terminal';
  end if;
  if has_function_privilege('anon', 'public.payment_is_test_terminal(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.payment_is_test_terminal(integer)', 'execute') then
    raise exception 'ledger_money_source_stamp: payment_is_test_terminal is executable by a browser role';
  end if;

  -- the functions kept their settings (create or replace does not keep what is not restated)
  select count(*) into v_bad
    from pg_proc p
   where p.oid in ('public.payment_is_test_terminal(integer)'::regprocedure,
                   'public.payment_operations_before_insert()'::regprocedure,
                   'public.payment_operations_guard_update()'::regprocedure,
                   'public.owner_agent_billing_sums(timestamptz,timestamptz)'::regprocedure,
                   'public.campaign_has_payment_activity(uuid)'::regprocedure)
     and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_bad > 0 then
    raise exception 'ledger_money_source_stamp: % function(s) lost search_path or became security definer', v_bad;
  end if;

  -- the four ledger triggers are still attached and enabled
  select count(*) into v_bad
    from pg_trigger t
   where t.tgrelid = 'public.payment_operations'::regclass and not t.tgisinternal and t.tgenabled = 'O'
     and t.tgname in ('payment_operations_before_insert', 'payment_operations_check_refund_cap',
                      'payment_operations_check_lines', 'payment_operations_guard_update');
  if v_bad <> 4 then
    raise exception 'ledger_money_source_stamp: expected 4 enabled ledger triggers, found %', v_bad;
  end if;

  -- this file classifies nothing: every row that existed before it is unstamped, unclassified and unreported
  if exists (select 1 from public.payment_operations where is_test or provider_terminal is not null or provider_terminal_echo is not null) then
    raise exception 'ledger_money_source_stamp: a row was classified or stamped by this migration';
  end if;
  if exists (select 1 from public.payment_operations where is_test is distinct from public.payment_is_test_terminal(provider_terminal)) then
    raise exception 'ledger_money_source_stamp: a stored class differs from the definition';
  end if;

  -- revenue did not move: recompute it with the OLD formula (no is_test) and compare with the replaced function
  select coalesce((select sum(c.final_charge_amount) from public.campaigns c
                    where c.charge_status = 'charged' and c.charged_at >= timestamptz '2026-01-01T00:00:00Z'
                      and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)), 0)
       + coalesce((select sum(case k.effect when 'collect' then o.amount else -o.amount end)
                     from public.payment_operations o join public.payment_operation_kinds k on k.kind = o.kind
                    where o.outcome = 'succeeded' and k.effect in ('collect', 'return')
                      and o.occurred_at >= timestamptz '2026-01-01T00:00:00Z'), 0)
    into v_expected;
  select s.charged_amount into v_actual from public.owner_agent_billing_sums(timestamptz '2026-01-01T00:00:00Z') s;
  if v_actual is distinct from v_expected then
    raise exception 'ledger_money_source_stamp: revenue changed (% -> %)', v_expected, v_actual;
  end if;
end $$;

-- ═══ ROLLBACK REFERENCE ═══
-- ── payment_operations_before_insert (pre-change text, verbatim) ──
-- CREATE OR REPLACE FUNCTION public.payment_operations_before_insert()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SET search_path TO ''
-- AS $function$
-- declare v_status text; v_event uuid; v_effect text; v_once boolean; v_parent_once boolean; v_parent_campaign uuid; v_parent_outcome public.payment_operation_outcome;
-- begin
--   -- Lock the campaign row FIRST, then read its status under the lock: a cancel that committed a moment ago is
--   -- seen here (cancel-first scenario. Money may not be committed or collected for a
--   -- cancelled campaign; a release/refund (void/return) on one is still allowed — that is how it gets its money back.
--   select c.status::text, c.event_id into v_status, v_event from public.campaigns c where c.id = new.campaign_id for update;
--   if v_status is null then
--     raise exception 'campaign % not found', new.campaign_id using errcode = 'foreign_key_violation';
--   end if;
--   select k.effect, k.once_per_campaign, k.once_per_parent into v_effect, v_once, v_parent_once
--     from public.payment_operation_kinds k where k.kind = new.kind;
--   if v_status = 'cancelled' and v_effect in ('commit', 'collect') then
--     raise exception 'campaign % is cancelled: no % allowed', new.campaign_id, new.kind using errcode = 'check_violation';
--   end if;
--   -- coalesce: an unknown kind then fails on the FK (23503, clear) rather than on NOT NULL (23502)
--   -- Integrity: event_id is DERIVED from the locked campaign, never trusted from the caller.
--   new.event_id := v_event;
--   -- A parent must belong to the same campaign and must have succeeded (releasing a failed hold or refunding a
--   -- failed charge is meaningless and would corrupt the derived state).
--   if new.parent_operation_id is not null then
--     select p.campaign_id, p.outcome into v_parent_campaign, v_parent_outcome
--       from public.payment_operations p where p.id = new.parent_operation_id;
--     if v_parent_campaign is distinct from new.campaign_id then
--       raise exception 'parent operation % belongs to another campaign', new.parent_operation_id using errcode = 'check_violation';
--     end if;
--     if v_parent_outcome <> 'succeeded' then
--       raise exception 'parent operation % did not succeed (%)', new.parent_operation_id, v_parent_outcome using errcode = 'check_violation';
--     end if;
--   end if;
--   new.once_slot   := coalesce(v_once, false);
--   new.parent_slot := coalesce(v_parent_once, false) and new.parent_operation_id is not null;
--   return new;
-- end $function$
-- ;

-- ── payment_operations_guard_update (pre-change text, verbatim) ──
-- CREATE OR REPLACE FUNCTION public.payment_operations_guard_update()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SET search_path TO ''
-- AS $function$
-- begin
--   if old.outcome = 'succeeded' and new.outcome = 'succeeded' and old.card_token_ref is not null
--      and old.card_brand is null and old.card_issuer is null
--      and (new.card_brand is not null or new.card_issuer is not null)
--      and (to_jsonb(new) - 'card_brand' - 'card_issuer') = (to_jsonb(old) - 'card_brand' - 'card_issuer') then
--     return new;
--   end if;
--   if not (
--        (old.outcome = 'pending' and new.outcome in ('succeeded', 'failed', 'review'))
--     or (old.outcome = 'review'  and new.outcome in ('succeeded', 'failed'))
--   ) then
--     raise exception 'payment_operations: % → % is not an allowed transition (row %)', old.outcome, new.outcome, old.id
--       using errcode = 'check_violation';
--   end if;
--   if new.id <> old.id or new.campaign_id <> old.campaign_id or new.event_id <> old.event_id or new.kind <> old.kind
--      or new.parent_operation_id is distinct from old.parent_operation_id
--      or new.recorded_at <> old.recorded_at or new.source <> old.source
--      or new.once_slot is distinct from old.once_slot or new.parent_slot is distinct from old.parent_slot then
--     raise exception 'only outcome, amounts, provider refs, occurred_at, note and meta may change on completion' using errcode = 'check_violation';
--   -- Note: an UPDATE that does not change outcome (e.g. note only on a review row) is rejected by the transition check
--   -- above. Interim admin notes go to activity_log, not to the row.
--   end if;
--   return new;
-- end $function$
-- ;

-- ── owner_agent_billing_sums (pre-change text, verbatim) ──
-- CREATE OR REPLACE FUNCTION public.owner_agent_billing_sums(_since timestamp with time zone, _until timestamp with time zone DEFAULT NULL::timestamp with time zone)
--  RETURNS TABLE(charged_amount numeric, credit_applied_amount numeric, unvoided_credit_amount numeric, credit_granted_amount numeric)
--  LANGUAGE sql
--  STABLE
--  SET search_path TO ''
-- AS $function$
--   select
--     -- charged: campaigns with no ledger row (the old columns) + the ledger, net of returns
--     coalesce((
--       select sum(c.final_charge_amount)
--       from public.campaigns c
--       where c.charge_status = 'charged'
--         and c.charged_at >= _since
--         and (_until is null or c.charged_at < _until)
--         and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
--     ), 0)
--     + coalesce((
--       select sum(case k.effect when 'collect' then o.amount else -o.amount end)
--       from public.payment_operations o
--       join public.payment_operation_kinds k on k.kind = o.kind
--       where o.outcome = 'succeeded'
--         and k.effect in ('collect', 'return')
--         and o.occurred_at >= _since
--         and (_until is null or o.occurred_at < _until)
--     ), 0),
--     -- credit applied: the same split
--     coalesce((
--       select sum(c.credit_applied)
--       from public.campaigns c
--       where c.charge_status in ('charged', 'nothing_to_charge')
--         and c.charged_at >= _since
--         and (_until is null or c.charged_at < _until)
--         and not exists (select 1 from public.payment_operations o where o.campaign_id = c.id)
--     ), 0)
--     + coalesce((
--       select sum(o.credit_applied)
--       from public.payment_operations o
--       join public.payment_operation_kinds k on k.kind = o.kind
--       where o.outcome = 'succeeded'
--         and k.effect = 'collect'
--         and o.occurred_at >= _since
--         and (_until is null or o.occurred_at < _until)
--     ), 0),
--     coalesce((
--       select sum(b.amount)
--       from public.billing_credits b
--       where b.voided_at is null
--     ), 0),
--     coalesce((
--       select sum(b.amount)
--       from public.billing_credits b
--       where b.voided_at is null
--         and b.created_at >= _since
--         and (_until is null or b.created_at < _until)
--     ), 0);
-- $function$
-- ;

-- ── campaign_has_payment_activity (pre-change text, verbatim) ──
-- CREATE OR REPLACE FUNCTION public.campaign_has_payment_activity(p_campaign uuid)
--  RETURNS boolean
--  LANGUAGE sql
--  STABLE
--  SET search_path TO ''
-- AS $function$
--   select exists (
--     select 1
--       from public.payment_operations o
--       join public.payment_operation_kinds k on k.kind = o.kind
--      where o.campaign_id = p_campaign
--        and k.effect <> 'none'
--        and o.outcome in ('succeeded', 'pending', 'review')
--   )
-- $function$
-- ;
