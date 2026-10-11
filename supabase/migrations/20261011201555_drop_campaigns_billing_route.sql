-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: campaigns.billing_route (Open Question 1, dropped with the SUMIT groups as recommended) and its enum type
-- public.billing_route ('saved_token', 'hold_j5'), which no other column or function uses.
--
-- HISTORY: empty on every campaign (comparison-5-1.md); the check below re-measures it.
--
-- ROLLBACK: create type public.billing_route as enum ('saved_token', 'hold_j5'); alter table public.campaigns add
-- column billing_route public.billing_route; (no value to restore).

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(billing_route)\M';
  if v_readers <> 0 then
    raise exception 'billing_route: % function(s) still read a column', v_readers;
  end if;
end $$;

do $$
declare v_values integer;
begin
  select count(*) into v_values from public.campaigns where billing_route is not null;
  if v_values <> 0 then
    raise exception 'billing_route: % campaign(s) hold a value', v_values;
  end if;
end $$;

alter table public.campaigns drop column billing_route;

drop type public.billing_route;
