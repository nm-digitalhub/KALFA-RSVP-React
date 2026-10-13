-- personal-coupons-admin-panel stage ג (AD6): exact-email account lookup for the staff
-- assign flow — ONE indexed query against auth.users (joined to the profile name),
-- replacing the capped 1,000-user page scan that could answer "not found" for a real
-- account. Exact, case-insensitive match only; never a substring search. service_role
-- only: the browser never calls this, and the server returns the minimum it needs.
--
-- ROLLBACK: drop function public.admin_lookup_account_by_email(text);

create or replace function public.admin_lookup_account_by_email(_email text)
returns table (id uuid, email text, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, p.full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(_email))
  limit 1
$$;

revoke all on function public.admin_lookup_account_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_lookup_account_by_email(text) to service_role;
