-- console_event_guests: a guest-level list for the agent console's manual-dial UI.
--
-- Additive, read-only. Mirrors the existing console-view pattern exactly: the view
-- runs with owner privileges and is gated by is_console_agent() (now staff-gated);
-- the phone value is additionally gated by has_platform_permission('view_customer_data').
--
-- Why this view is needed:
--   The manual-dial route (POST /api/events/{eventId}/outreach-call) resolves its
--   target by guests.id, but NO existing console view exposes a guest_id:
--   console_campaign_targets is derived from outreach_state and carries only
--   contact_id, so an event that has an active campaign but no armed outreach rows
--   shows the console zero dialable guests. This view lets the console list the
--   event's actual guests, hand the route a real guest_id, and surface a dial
--   affordance ONLY when the event has an active campaign (matching the route's own
--   409 gate) and the guest has a dialable phone.
--
-- Reversible: drop view public.console_event_guests;

create or replace view public.console_event_guests as
  select
    g.id                                   as guest_id,
    g.event_id,
    g.full_name                            as guest_name,
    (
      c.normalized_phone is not null
      and c.removal_requested = false
    )                                    as dialable,
    case
      when public.has_platform_permission('view_customer_data') then c.normalized_phone
      else null::text
    end                                    as phone,
    (g.status)::text                       as rsvp_status,
    exists (
      select 1
      from public.campaigns cp
      where cp.event_id = g.event_id
        and cp.status = 'active'
    )                                      as has_active_campaign
  from public.guests g
  left join public.contacts c on c.id = g.contact_id
  where public.is_console_agent();

-- Grants. `revoke ... from authenticated` FIRST is load-bearing, not decorative:
-- the schema's default privileges hand `authenticated` the full arwdDxtm set on
-- every newly created relation, and a later `grant select` does NOT remove what
-- the defaults already gave. Revoking only from anon and then granting select —
-- which is what this file did on its first pass — leaves INSERT/UPDATE/DELETE/
-- TRUNCATE in place. That is the exact hole migration 20260720193844 was written
-- to close on the other six console views; verified live here, where this view
-- came up as the only console view with ins/upd/del = true for `authenticated`.
--
-- The LEFT JOIN happens to make the view non-auto-updatable ("Views that do not
-- select from a single table or view are not automatically updatable"), so the
-- write privileges were not reachable in practice. That is an accident of the
-- view's SHAPE, not a permission boundary: collapse the join, or add an
-- INSTEAD OF trigger, and the writes open up silently. Revoke explicitly.
revoke all on public.console_event_guests from authenticated;
revoke all on public.console_event_guests from anon;
grant select on public.console_event_guests to authenticated;
