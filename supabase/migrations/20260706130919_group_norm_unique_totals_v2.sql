-- Hardening pass on the "real data, correct counting" work:
--
-- 1) Group-name uniqueness on the NORMALIZED name — btrim + inner-whitespace
--    collapse + lower — so names that LOOK identical to a human ("משפחה  קרובה",
--    " משפחה קרובה ") cannot coexist as distinct DB rows. The application
--    stores the same normal form (normalizeGroupName), so the index expression
--    and the app agree.
drop index if exists public.guest_groups_event_name_key;
create unique index guest_groups_event_name_key
  on public.guest_groups (event_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- 2) guest_totals v2 — explicit, documented counting rules:
--    * Counts PEOPLE, not rows. All quantities are clamped non-negative
--      (only confirmed_headcount carries a DB CHECK; adults/kids/expected
--      rely on write-path clamps, so the aggregate defends itself too).
--    * Party size INCLUDES the guest (submit_rsvp enforces attending
--      1 <= adults+kids <= expected_count — the RSVP owner is adult #1).
--    * attending_people precedence per row:
--        valid WhatsApp headcount (1..10, the column's CHECK range)
--        → web answer adults+kids (> 0)
--        → original invited size expected_count (> 0)
--        → default 1 (an attending row is never fewer than one person).
--    * Aggregate with no GROUP BY → ALWAYS exactly one row (zeros when the
--      event has no guests).
create or replace function public.guest_totals(_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rows',             count(*),
    'invited_people',   coalesce(sum(greatest(coalesce(expected_count, 1), 1)), 0),
    'attending_rows',   count(*) filter (where status = 'attending'),
    'attending_people', coalesce(sum(
        case when status = 'attending' then
          case
            when coalesce(confirmed_headcount, 0) between 1 and 10
              then confirmed_headcount
            when greatest(coalesce(confirmed_adults, 0), 0)
               + greatest(coalesce(confirmed_kids, 0), 0) > 0
              then greatest(coalesce(confirmed_adults, 0), 0)
                 + greatest(coalesce(confirmed_kids, 0), 0)
            when coalesce(expected_count, 0) > 0
              then expected_count
            else 1
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
