-- personal-coupons task 3.2 — D10: consumption happens in the payment's own transaction.
--
-- The moment a package payment's ledger row moves to `succeeded`, the benefit bound to that campaign becomes
-- `consumed` — in the SAME transaction as the settlement write, so nothing is ever left half done and no repair can
-- charge again. The anchor is the row's pricing_round_id (written at open, D22): round → its bound assignment.
--
-- The trigger only READS the ledger row (never changes it), touches only coupon_assignments + the insert-only
-- events table, and ignores expires_at on purpose (D20: validity was proven when the session opened).
-- pending / review / failed outcomes change nothing. SECURITY DEFINER like its siblings: the firing statement's
-- role needs no grants on the coupon tables.
--
-- ROLLBACK: drop trigger payment_operations_consume_benefit on public.payment_operations;
--           drop function public.payment_operations_consume_benefit();

set local lock_timeout = '5s';

create or replace function public.payment_operations_consume_benefit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment uuid;
begin
  if new.pricing_round_id is null then return new; end if;

  select coupon_assignment_id into v_assignment
    from public.campaign_pricing
   where id = new.pricing_round_id;
  if v_assignment is null then return new; end if;

  update public.coupon_assignments
     set state = 'consumed'
   where id = v_assignment
     and state = 'bound'
     and bound_campaign_id = new.campaign_id;
  if found then
    insert into public.coupon_assignment_events (assignment_id, action, reason, meta)
    values (v_assignment, 'consumed', 'package payment succeeded',
            jsonb_build_object('payment_operation_id', new.id));
  end if;
  return new;
end $$;

drop trigger if exists payment_operations_consume_benefit on public.payment_operations;
create trigger payment_operations_consume_benefit
  after update of outcome on public.payment_operations
  for each row
  when (new.outcome = 'succeeded' and old.outcome is distinct from new.outcome)
  execute function public.payment_operations_consume_benefit();

revoke all on function public.payment_operations_consume_benefit() from public, anon, authenticated;
