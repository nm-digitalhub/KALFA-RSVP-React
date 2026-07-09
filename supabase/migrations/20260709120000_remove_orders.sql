-- Remove the legacy orders table after verifying it is empty.
-- Fail fast if any row still exists so the drop cannot silently discard data.

do $$
begin
  if to_regclass('public.orders') is not null then
    if exists (select 1 from public.orders limit 1) then
      raise exception 'Refusing to drop public.orders because it still contains rows';
    end if;

    execute 'drop policy if exists orders_owner_select on public.orders';
    execute 'drop policy if exists orders_owner on public.orders';
    execute 'drop policy if exists orders_admin_all on public.orders';

    execute 'alter table public.orders drop constraint if exists orders_event_id_fkey';
    execute 'alter table public.orders drop constraint if exists orders_package_id_fkey';
    execute 'alter table public.orders drop constraint if exists orders_user_id_fkey';
    execute 'alter table public.orders drop constraint if exists orders_pkey';

    execute 'drop index if exists public.orders_payment_attempt_ref_unique';
    execute 'drop index if exists public.orders_sumit_document_id_unique';
    execute 'drop index if exists public.orders_user_id_idx';

    execute 'drop table public.orders';
  end if;
end $$;

drop type if exists public.order_status;
