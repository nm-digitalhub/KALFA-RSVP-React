-- personal-coupons-admin-panel stage א (AD3): the staff list moves to ONE SQL round-trip —
-- filtering (incl. the display buckets that need the void event's recorded reason), stable
-- sorting, pagination and the filtered total (count(*) over()) all server-side, replacing
-- the limit(200) + in-memory filter. service_role-only: the browser never calls this.
--
-- The display bucket mirrors src/lib/offers/assignment-display-status.ts (spec §5):
-- consumed wins over expiry; פגה is derived from expires_at or the recorded 'expired'
-- void reason; a cancellation bucket only for the reasons the writers actually record;
-- anything else is 'ended'. _guard_only serves the "דורש בדיקה" entry: assignments whose
-- pricing round carries a SUCCEEDED package payment while the assignment is not consumed
-- (attribution via pricing_round_id only — never campaign-level ranking).
--
-- ROLLBACK: drop function public.admin_list_coupon_assignments(uuid, text, text, text, uuid, text, integer, integer);

create or replace function public.admin_list_coupon_assignments(
  _user_id uuid default null,
  _phone text default null,
  _status text default null,
  _source text default null,
  _offer_id uuid default null,
  _sort text default 'newest',
  _page integer default 1,
  _page_size integer default 25
)
returns table (
  id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  state text,
  end_reason text,
  offer_title text,
  user_id uuid,
  phone_e164 text,
  source_kind text,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with enriched as (
    select
      a.id, a.created_at, a.expires_at, a.state::text as state,
      ve.reason as end_reason,
      o.title as offer_title,
      a.user_id, a.phone_e164,
      case when a.sales_call_attempt_id is not null then 'agent' else 'staff' end as source_kind,
      case
        when a.state = 'consumed' then 'consumed'
        when a.state in ('assigned','bound') and a.expires_at <= now() then 'expired'
        when a.state = 'assigned' then 'waiting'
        when a.state = 'bound' then 'bound'
        when a.state = 'void' and ve.reason = 'expired' then 'expired'
        when a.state = 'void' and ve.reason in ('staff_void','voided_by_staff','duplicate','escalation_replaced') then 'cancelled'
        else 'ended'
      end as bucket,
      exists (
        select 1
        from public.campaign_pricing p
        join public.payment_operations po on po.pricing_round_id = p.id
        where p.coupon_assignment_id = a.id
          and po.kind = 'package_purchase'
          and po.outcome = 'succeeded'
          and a.state <> 'consumed'
      ) as guard
    from public.coupon_assignments a
    left join public.offers o on o.id = a.offer_id
    left join lateral (
      select e.reason
      from public.coupon_assignment_events e
      where e.assignment_id = a.id and e.action = 'voided'
      order by e.at desc, e.id desc
      limit 1
    ) ve on true
  )
  select
    e.id, e.created_at, e.expires_at, e.state, e.end_reason, e.offer_title,
    e.user_id, e.phone_e164, e.source_kind,
    count(*) over () as total_count
  from enriched e
  where (_user_id is null or e.user_id = _user_id)
    and (_phone is null or e.phone_e164 = _phone)
    and (_offer_id is null or exists (
          select 1 from public.coupon_assignments a2
          where a2.id = e.id and a2.offer_id = _offer_id))
    and (_source is null or e.source_kind = _source)
    and (case
          when _status is null then true
          when _status = 'guard' then e.guard
          else e.bucket = _status
        end)
  order by
    case when _sort = 'oldest' then e.created_at end asc,
    case when _sort = 'expiry' then e.expires_at end asc,
    case when _sort not in ('oldest','expiry') then e.created_at end desc,
    e.id desc
  limit greatest(_page_size, 1)
  offset (greatest(_page, 1) - 1) * greatest(_page_size, 1)
$$;

revoke all on function public.admin_list_coupon_assignments(uuid, text, text, text, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_coupon_assignments(uuid, text, text, text, uuid, text, integer, integer)
  to service_role;
