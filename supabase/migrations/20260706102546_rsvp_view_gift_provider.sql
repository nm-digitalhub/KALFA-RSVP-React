-- Add event.gift_provider to get_rsvp_by_token (icon selection for the gift
-- CTA). Derived verbatim from migration 20260706101209; only the event object
-- changes.
--
-- Original header:
-- Extend get_rsvp_by_token's event object for the type-aware public RSVP page:
--   celebrants        — per-type heading/line rendering (couple/single/parents/free)
--   invite_image_path — the uploaded invitation image (page signs a short-lived URL)
--   gift_link_token   — gift CTA token, returned ONLY when a payment link is
--                       configured (fail-closed, mirrors buildGiftParams)
-- Everything else is preserved verbatim from the live definition (introspected
-- 2026-07-06); this is the ONLY public read path for guest/event RSVP data.

create or replace function public.get_rsvp_by_token(_token text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'guest', jsonb_build_object(
      'id',               g.id,
      'full_name',        g.full_name,
      'expected_count',   g.expected_count,
      'status',           g.status,
      'event_id',         g.event_id,
      'confirmed_adults', g.confirmed_adults,
      'confirmed_kids',   g.confirmed_kids,
      'meal_pref',        g.meal_pref,
      'note',             g.note,
      -- prior custom answers, filtered to the currently-enabled questions.
      'answers', coalesce((
        select jsonb_object_agg(kv.key, kv.value)
          from public.rsvp_responses rr
          cross join lateral jsonb_each(rr.extras) kv
         where rr.guest_id = g.id
           and rr.created_at = (
             select max(rr2.created_at)
               from public.rsvp_responses rr2
              where rr2.guest_id = g.id
           )
           and kv.key in (
             select q.q_key
               from public.event_questions q
              where q.event_id = g.event_id and q.enabled = true
           )
      ), '{}'::jsonb)
    ),
    'event', jsonb_build_object(
      'id',            e.id,
      'name',          e.name,
      'event_type',    e.event_type,
      'event_date',    e.event_date,
      'venue_name',    e.venue_name,
      'venue_address', e.venue_address,
      'celebrants',    e.celebrants,
      'invite_image_path', e.invite_image_path,
      'gift_link_token', case when e.gift_payment_url is not null
                              then e.gift_link_token end,
      -- Coarse provider tag for the gift CTA icon (bit / paybox / other) —
      -- derived from the host, the URL itself is never exposed publicly.
      'gift_provider', case
        when e.gift_payment_url is null then null
        when e.gift_payment_url ilike '%bitpay.co.il%'
          or e.gift_payment_url ilike '%//bit.%' then 'bit'
        when e.gift_payment_url ilike '%paybox%' then 'paybox'
        else 'other'
      end
    ),
    -- the enabled questions the form must render (this function is the ONLY
    -- public path to them; eq_public_read was dropped above).
    'questions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'q_key',    q.q_key,
                 'label',    q.label,
                 'q_type',   q.q_type,
                 'required', q.required,
                 'options',  q.options
               ) order by q.sort_order, q.q_key
             )
        from public.event_questions q
       where q.event_id = g.event_id and q.enabled = true
    ), '[]'::jsonb),
    -- L2: gate the FORM on BOTH the event day (Asia/Jerusalem calendar) AND the
    -- deadline. A NULL event_date does not gate (matches the DB NULL semantics).
    -- The DB session is UTC, so the deadline (a date) is compared in Israel time.
    'can_respond', (
      (e.event_date is null
       or (now() at time zone 'Asia/Jerusalem')::date
            <= (e.event_date at time zone 'Asia/Jerusalem')::date)
      and (e.rsvp_deadline is null
       or (now() at time zone 'Asia/Jerusalem')::date <= e.rsvp_deadline)
    )
  )
  from public.guests g
  join public.events e on e.id = g.event_id
  where g.rsvp_token = _token
    and g.rsvp_token_revoked_at is null
    and e.status = 'active';
$function$;
