-- Over-invited flagging (BUSINESS state, explicitly NOT an error): the owner's
-- initial estimate (expected_count) differing from the guest's real answer is
-- legitimate — we surface it, never block it.
--
-- Single source of truth: guest_effective_attending(row) is THE "effective
-- attending people" rule. guest_totals, the over_invited computed field, the
-- list badge, the filter and the stats strip all derive from it — web,
-- WhatsApp and import can never drift apart.

-- Effective attending people for one guest row. Same documented precedence as
-- before (valid WhatsApp headcount 1-10 -> web adults+kids -> expected -> 1),
-- now expressed ONCE.
create or replace function public.guest_effective_attending(g public.guests)
returns integer
language sql
stable
set search_path = public
as $$
  select case when g.status = 'attending' then
    case
      when coalesce(g.confirmed_headcount, 0) between 1 and 10
        then g.confirmed_headcount
      when greatest(coalesce(g.confirmed_adults, 0), 0)
         + greatest(coalesce(g.confirmed_kids, 0), 0) > 0
        then greatest(coalesce(g.confirmed_adults, 0), 0)
           + greatest(coalesce(g.confirmed_kids, 0), 0)
      when coalesce(g.expected_count, 0) > 0
        then g.expected_count
      else 1
    end
  else 0 end;
$$;

-- PostgREST computed field for guests: true ONLY when ALL hold —
--   status = attending, an original invited size exists, a REAL answer exists
--   (WhatsApp headcount or web counts — never the fallback branches), and the
--   effective count exceeds the invited size.
create or replace function public.over_invited(g public.guests)
returns boolean
language sql
stable
set search_path = public
as $$
  select g.status = 'attending'
     and g.expected_count is not null
     and (coalesce(g.confirmed_headcount, 0) between 1 and 10
          or greatest(coalesce(g.confirmed_adults, 0), 0)
           + greatest(coalesce(g.confirmed_kids, 0), 0) > 0)
     and public.guest_effective_attending(g) > g.expected_count;
$$;

-- guest_totals v3: same contract as v2 plus the two derived overage fields,
-- and the per-row people expression now delegates to the shared function.
create or replace function public.guest_totals(_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rows',             count(*),
    'invited_people',   coalesce(sum(greatest(coalesce(g.expected_count, 1), 1)), 0),
    'attending_rows',   count(*) filter (where g.status = 'attending'),
    'attending_people', coalesce(sum(public.guest_effective_attending(g)), 0),
    'declined_rows',    count(*) filter (where g.status = 'declined'),
    'maybe_rows',       count(*) filter (where g.status = 'maybe'),
    'pending_rows',     count(*) filter (where g.status = 'pending'),
    'over_invited_rows',   count(*) filter (where public.over_invited(g)),
    'over_invited_people', coalesce(sum(
        case when public.over_invited(g)
             then public.guest_effective_attending(g) - g.expected_count
             else 0 end), 0)
  )
  from public.guests g
  where g.event_id = _event_id;
$$;

comment on function public.guest_totals(uuid) is
  'People-level guest totals for one event. Counts PEOPLE, not rows; party size includes the guest. attending_people per row = guest_effective_attending (valid WhatsApp headcount 1-10 -> web adults+kids -> expected_count -> 1). over_invited_* are the BUSINESS overage: attending rows whose real answer exceeds expected_count, and the surplus people. Always exactly one row. SECURITY INVOKER - RLS scopes access.';

revoke all on function public.guest_effective_attending(public.guests) from public, anon;
revoke all on function public.over_invited(public.guests) from public, anon;
grant execute on function public.guest_effective_attending(public.guests) to authenticated, service_role;
grant execute on function public.over_invited(public.guests) to authenticated, service_role;
