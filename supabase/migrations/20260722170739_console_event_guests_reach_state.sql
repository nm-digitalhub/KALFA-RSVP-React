-- already_reached end-to-end, part 1 of 2: per-guest reach/callback state in the
-- console's authorized guest projection.
--
-- The manual-dial route answers 202 before any worker gate runs, so the app
-- renders an active dial button for a contact the worker is certain to refuse
-- (skipped/already_reached). This migration lets the app know BEFORE the tap:
-- four columns APPENDED to console_event_guests (create or replace view may
-- only append; the existing seven keep name/type/position):
--
--   reached_at              billed_results.reached_at for (event_id, contact_id);
--                           NULL = not reached. locked_price is NEVER selected,
--                           nor is billed_results itself exposed — only this
--                           scalar. <=1 row guaranteed by
--                           billed_results_event_contact_unique, which also
--                           serves the lookup.
--   callback_scheduled_at   MIN(callback_iso) over PENDING guest-requested
--                           callbacks (iso set, not yet dispatched) — the exact
--                           predicate the callback sweep dials. Text-only
--                           callbacks (callback_when_text without an iso) do
--                           NOT block manual dial on purpose: they are never
--                           auto-dialed (listUnschedulableCallbacks), so
--                           blocking would strand them unreachable forever.
--   can_start_outreach_call NOT reached AND no pending callback. Deliberately
--                           orthogonal to dialable / has_active_campaign — this
--                           column is computed by (event_id, contact_id) only;
--                           the app enables the dial affordance on
--                           dialable AND has_active_campaign AND
--                           can_start_outreach_call (contract doc §2).
--   call_block_reason       'already_reached' (wins) | 'callback_scheduled' |
--                           NULL. Strings match the worker's CallDispatchResult
--                           reasons verbatim — one vocabulary end to end.
--
-- Both reached_at and callback_scheduled_at can be non-null at once: a pending
-- callback for a since-billed contact still dials via the sweep (isCallback is
-- the sole already-reached exemption, owner decision 2026-07-21). The single-
-- valued reason gives already_reached precedence; the two fact columns stay
-- independent.
--
-- Guests with contact_id IS NULL: both laterals yield NULL -> can_start = true,
-- reason NULL — harmless, dialable is already false for them.
--
-- Grants: create or replace view PRESERVES existing grants (verified live),
-- but the revoke-first block is REPEATED at the end of this file anyway
-- (user decision): every (re)definition of a console view re-asserts its
-- privilege boundary explicitly, so no future reshaping of the view can ride
-- on grants it silently inherited.
--
-- Rollback:
--   drop index if exists public.call_attempts_callback_pending_target_idx;
--   -- view columns cannot be dropped via create-or-replace:
--   drop view public.console_event_guests;  -- then re-run 20260721133850
--   -- (incl. its revoke-first grants — a fresh CREATE reintroduces defaults).

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
    )                                      as has_active_campaign,
    br.reached_at,
    cb.callback_scheduled_at,
    (br.reached_at is null and cb.callback_scheduled_at is null)
                                           as can_start_outreach_call,
    case
      when br.reached_at is not null then 'already_reached'
      when cb.callback_scheduled_at is not null then 'callback_scheduled'
    end                                    as call_block_reason
  from public.guests g
  left join public.contacts c on c.id = g.contact_id
  -- one probe each per row (lateral, not repeated scalar subqueries — the
  -- boolean + reason would otherwise re-run the same probe up to three times).
  left join lateral (
    select b.reached_at
    from public.billed_results b
    where b.event_id = g.event_id
      and b.contact_id = g.contact_id       -- <=1 row: UNIQUE(event_id, contact_id)
  ) br on true
  left join lateral (
    select min(ca.callback_iso) as callback_scheduled_at
    from public.call_attempts ca
    where ca.event_id = g.event_id
      and ca.contact_id = g.contact_id
      and ca.callback_iso is not null
      and ca.callback_dispatched_at is null
  ) cb on true
  where public.is_console_agent();

-- The reach probe rides billed_results' unique index. The callback probe gets
-- its own partial index: the existing callback index is keyed on callback_iso
-- alone (the sweep's due-scan), not this per-row (event_id, contact_id) probe.
-- Pending callbacks are rare, so the partial index stays tiny.
create index if not exists call_attempts_callback_pending_target_idx
  on public.call_attempts (event_id, contact_id)
  where callback_iso is not null and callback_dispatched_at is null;

-- Re-assert the privilege boundary on every (re)definition (see header note).
-- `revoke ... from authenticated` FIRST is load-bearing, not decorative: the
-- schema's default privileges hand `authenticated` the full arwdDxtm set on
-- newly created relations, and a later `grant select` does NOT remove what the
-- defaults already gave (the exact hole 20260720193844 closed on the other
-- console views).
revoke all on public.console_event_guests from authenticated;
revoke all on public.console_event_guests from anon;
grant select on public.console_event_guests to authenticated;
