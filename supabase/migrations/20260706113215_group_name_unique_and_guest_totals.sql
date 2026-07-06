-- 1) Two nuclear families named identically ("משפחת קלפה" twice) must stay two
--    distinct GUEST rows (phone is the identity) — but two GROUPS with the
--    same name are indistinguishable in every picker, and the CSV import
--    resolves groups BY NAME (case-insensitive), silently merging separate
--    households. Enforce per-event name uniqueness (preflighted live
--    2026-07-06: zero existing duplicates).
create unique index guest_groups_event_name_key
  on public.guest_groups (event_id, lower(name));

-- 2) People-level totals for an event's guest list — counts PEOPLE, not rows
--    (a household row invited as 4 is one row). Attending people prefer the
--    WhatsApp-confirmed headcount when answered (>0), else adults+kids, never
--    less than 1 per attending row. SECURITY INVOKER — RLS on guests scopes
--    access (owner / org member with guests access only).
create or replace function public.guest_totals(_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rows',             count(*),
    'invited_people',   coalesce(sum(coalesce(expected_count, 1)), 0),
    'attending_rows',   count(*) filter (where status = 'attending'),
    'attending_people', coalesce(sum(
        case when status = 'attending' then
          case when coalesce(confirmed_headcount, 0) > 0
               then confirmed_headcount
               else greatest(coalesce(confirmed_adults, 0) + coalesce(confirmed_kids, 0), 1)
          end
        else 0 end), 0),
    'declined_rows',    count(*) filter (where status = 'declined'),
    'maybe_rows',       count(*) filter (where status = 'maybe'),
    'pending_rows',     count(*) filter (where status = 'pending')
  )
  from public.guests
  where event_id = _event_id;
$$;

revoke all on function public.guest_totals(uuid) from public, anon;
grant execute on function public.guest_totals(uuid) to authenticated, service_role;
