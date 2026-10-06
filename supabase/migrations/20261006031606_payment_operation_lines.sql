-- payment_operation_lines: HOW the money of one ledger operation is composed, as signed lines.
-- (docs/superpowers/plans/2026-10-06-payment-operation-lines.md; owner, 6.10.2026: a generic, simple schema.)
--
-- Why: a collect today stores two numbers (amount = what reached the card, credit_applied = what the customer's credit
-- paid), so every new way to pay (a gift card, a coupon) would be a new column and a new status rule. SUMIT itself
-- models a charge as lines with a signed price, and the code already sends the credit to SUMIT as a negative line
-- named 'קרדיט' (src/lib/data/close-charge.ts). The same shape here makes a new way to pay one more line, not a
-- schema change. Measured on SUMIT 6.10.2026: payments/charge accepts a negative UnitPrice and charges the sum of the
-- lines.
--
-- Shape: one row per line. line_total = round(quantity * unit_price, 2), computed by the database. A negative line is
-- a deduction (credit, coupon). For a succeeded operation that HAS lines:
--     sum(line_total)                      = payment_operations.amount          (what reached the card)
--     -sum(line_total) where line_total<0  = payment_operations.credit_applied  (what was settled another way)
-- Operations with no lines (everything written before this migration, and any operation a caller chooses not to
-- itemise) keep working exactly as before: the two columns stay the source for them. This is the EXPAND step only:
-- nothing is dropped, no existing reader or writer changes meaning.
--
-- Append-only, server-only, like payment_operations: RLS on, no policies, no grants to anon/authenticated.
--
-- Rollback (data and structure; nothing else depends on the table yet):
--   drop trigger payment_operations_check_lines on public.payment_operations;
--   drop function public.payment_operations_check_lines();
--   drop table public.payment_operation_lines;                 -- also drops its two triggers
--   drop function public.payment_operation_lines_before_insert();
--   drop function public.payment_operation_lines_guard();

create table public.payment_operation_lines (
  id           uuid primary key default extensions.uuid_generate_v7(),
  -- RESTRICT, like the ledger itself: a line never vanishes because its operation was deleted.
  operation_id uuid not null references public.payment_operations (id) on delete restrict,
  line_no      smallint not null check (line_no > 0),
  description  text not null check (btrim(description) <> ''),
  quantity     numeric(12,3) not null default 1 check (quantity > 0),
  -- Signed: negative = a deduction (credit, coupon, gift card).
  unit_price   numeric(12,2) not null,
  line_total   numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  recorded_at  timestamptz not null default now(),
  -- Also the index of the operation_id foreign key (schema-foreign-key-indexes).
  constraint payment_operation_lines_op_line_uq unique (operation_id, line_no)
);
comment on table public.payment_operation_lines is 'Signed lines that compose one ledger operation (a charge, a refund). Append-only. For a succeeded operation with lines: sum(line_total) = amount and the negative lines = credit_applied. Server-only.';

-- A line may be written only while the operation is still open (pending/review) and only for an operation that moves
-- money (collect/return). FOR SHARE locks the operation row, so a completion running at the same moment either waits
-- for this insert or is seen by it — never both pass.
create or replace function public.payment_operation_lines_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_effect text; v_outcome public.payment_operation_outcome;
begin
  select k.effect, o.outcome into v_effect, v_outcome
    from public.payment_operations o
    join public.payment_operation_kinds k on k.kind = o.kind
   where o.id = new.operation_id
     for share of o;
  if not found then
    raise exception 'payment operation % not found', new.operation_id using errcode = 'foreign_key_violation';
  end if;
  if v_effect not in ('collect', 'return') then
    raise exception 'payment_operation_lines: operation % has effect %, only collect and return carry lines', new.operation_id, v_effect
      using errcode = 'check_violation';
  end if;
  if v_outcome not in ('pending', 'review') then
    raise exception 'payment_operation_lines: operation % is %, lines can only be added while it is pending or in review', new.operation_id, v_outcome
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payment_operation_lines_before_insert before insert on public.payment_operation_lines
  for each row execute function public.payment_operation_lines_before_insert();

-- Append-only: a line is never changed and never deleted.
create or replace function public.payment_operation_lines_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'payment_operation_lines: a line is never changed or deleted (line %)', old.id using errcode = 'check_violation';
end $$;
create trigger payment_operation_lines_guard before update or delete on public.payment_operation_lines
  for each row execute function public.payment_operation_lines_guard();

-- The moment an operation becomes succeeded, its lines (when it has any) must add up to what the row says. The check
-- runs only on that one transition; the late card_brand/card_issuer fill of an already succeeded row is not touched.
-- Alphabetically before payment_operations_guard_update, so a mismatch is reported as a lines problem.
create or replace function public.payment_operations_check_lines()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_lines integer; v_total numeric; v_credit numeric;
begin
  if new.outcome <> 'succeeded' or old.outcome = 'succeeded' then
    return new;
  end if;
  select count(*), coalesce(sum(l.line_total), 0), coalesce(-sum(l.line_total) filter (where l.line_total < 0), 0)
    into v_lines, v_total, v_credit
    from public.payment_operation_lines l
   where l.operation_id = new.id;
  if v_lines = 0 then
    return new;
  end if;
  if v_total <> new.amount or v_credit <> new.credit_applied then
    raise exception 'payment_operations: the lines of operation % add up to % (credit %), the operation says % (credit %)',
      new.id, v_total, v_credit, new.amount, new.credit_applied using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payment_operations_check_lines before update on public.payment_operations
  for each row execute function public.payment_operations_check_lines();

-- ACL: server-only, the same as payment_operations.
alter table public.payment_operation_lines enable row level security;
revoke all on table public.payment_operation_lines from public, anon, authenticated;
-- No policies on purpose: RLS with none denies every non-bypass role; service_role bypasses RLS.

-- ── Backfill: the succeeded collects written by the legacy backfill, which have no lines yet ──
-- Measured 6.10.2026: six ledger rows; the only credit is on the two 'charge' rows (84 and 200), both amount 0.
-- Each gets the gross price as line 1 and the credit as a negative line 2 (the same name the application sends to
-- SUMIT), so sum(lines) = amount and the negative lines = credit_applied. A row with nothing to itemise
-- (amount + credit = 0) gets none. The insert trigger refuses lines on a succeeded operation, so it is switched off
-- for exactly this statement and switched on again straight after; this migration is one transaction, so a failure
-- anywhere restores the trigger with everything else.
alter table public.payment_operation_lines disable trigger payment_operation_lines_before_insert;

insert into public.payment_operation_lines (operation_id, line_no, description, unit_price)
select o.id, v.line_no, v.description, v.unit_price
  from public.payment_operations o
  join public.payment_operation_kinds k on k.kind = o.kind
  cross join lateral (values
    (1::smallint, k.label_he, o.amount + o.credit_applied),
    (2::smallint, 'קרדיט'::text, -o.credit_applied)
  ) as v(line_no, description, unit_price)
 where o.meta ? 'backfill_key'
   and o.outcome = 'succeeded'
   and k.effect = 'collect'
   and o.amount + o.credit_applied > 0
   and (v.line_no = 1 or o.credit_applied > 0)
   and not exists (select 1 from public.payment_operation_lines l where l.operation_id = o.id);

alter table public.payment_operation_lines enable trigger payment_operation_lines_before_insert;

-- Verification: aborts, and rolls back whole, when any of these fails.
do $$
declare v_bad integer; v_off integer;
begin
  -- every operation that has lines is consistent with its own row
  select count(*) into v_bad
    from public.payment_operations o
    join lateral (
      select sum(l.line_total) as total, coalesce(-sum(l.line_total) filter (where l.line_total < 0), 0) as credit
        from public.payment_operation_lines l where l.operation_id = o.id
      having count(*) > 0
    ) s on true
   where o.outcome = 'succeeded' and (s.total <> o.amount or s.credit <> o.credit_applied);
  if v_bad > 0 then
    raise exception 'payment_operation_lines: % operation(s) disagree with their lines', v_bad;
  end if;

  -- every backfilled collect that had something to itemise now has its lines
  select count(*) into v_bad
    from public.payment_operations o
    join public.payment_operation_kinds k on k.kind = o.kind
   where o.meta ? 'backfill_key' and o.outcome = 'succeeded' and k.effect = 'collect' and o.amount + o.credit_applied > 0
     and not exists (select 1 from public.payment_operation_lines l where l.operation_id = o.id);
  if v_bad > 0 then
    raise exception 'payment_operation_lines: % backfilled collect(s) have no lines', v_bad;
  end if;

  -- no lines on an operation that cannot carry any
  select count(*) into v_bad
    from public.payment_operation_lines l
    join public.payment_operations o on o.id = l.operation_id
    join public.payment_operation_kinds k on k.kind = o.kind
   where k.effect not in ('collect', 'return');
  if v_bad > 0 then
    raise exception 'payment_operation_lines: % line(s) sit on an operation without a money effect', v_bad;
  end if;

  -- all three new triggers are enabled (origin mode 'O'), and so are the two older ones
  select count(*) into v_off
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('payment_operation_lines_before_insert', 'payment_operation_lines_guard', 'payment_operations_check_lines',
                      'payment_operations_before_insert', 'payment_operations_guard_update')
     and t.tgenabled <> 'O';
  if v_off > 0 then
    raise exception 'payment_operation_lines: % trigger(s) are not enabled', v_off;
  end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal
        and t.tgname in ('payment_operation_lines_before_insert', 'payment_operation_lines_guard', 'payment_operations_check_lines')) <> 3 then
    raise exception 'payment_operation_lines: a trigger is missing';
  end if;

  -- the table is not reachable by the browser roles
  if has_table_privilege('anon', 'public.payment_operation_lines', 'select')
     or has_table_privilege('authenticated', 'public.payment_operation_lines', 'select') then
    raise exception 'payment_operation_lines: anon or authenticated can read the table';
  end if;
end $$;
