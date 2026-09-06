-- view_events — "staff may see WHICH event this is".
--
-- The gap: /app/events/{id} authorizes on OWNERSHIP alone (events_org_select =
-- owner_id = auth.uid() OR has_org_permission(...)). Platform staff appear in
-- neither branch, so the platform owner holding all eleven permissions still
-- gets a 404 on a customer's event — including from the business mailbox's own
-- calendar entry, whose body links straight there. There was no keyhole for
-- staff in that door at all.
--
-- Why a NEW key rather than reusing one that exists:
--   * view_customer_data is BREAK-GLASS (access-log.ts BREAK_GLASS_PERMISSIONS):
--     recordStaffAccess rejects it without a typed reason of >= 10 chars. Making
--     staff justify themselves in prose to find out WHEN an event is would
--     manufacture exactly the reason-fatigue that module warns about, and would
--     devalue the reasons written for real break-glass reads of guest data.
--   * view_billing is not break-glass but is a MONEY key; using it to guard a
--     name and a date is the same category confusion this change exists to undo.
--     (Owner decision, 2026-09-07: "אתה חייב להפריד בין ההרשאות".)
--
-- What it authorizes, exactly: the event's own identifying fields — name, type,
-- date, rsvp deadline, status, venue, celebrants — plus the owner's ID and the
-- campaign's ID as opaque identifiers used to build links. It does NOT authorize
-- the owner's name/phone/email, the guest list, or any billing figure; each of
-- those keeps its existing separate key and its existing separate surface.
--
-- Placed in 'support' at sort_order 5: it sorts FIRST in that category because
-- it is the weakest key there — view_customer_data (10) and view_recordings (15)
-- are both strictly more than this.
--
-- No owner grant row is written here: the platform_permission_grant_owner
-- trigger (migration 20260719215138) inserts one automatically on INSERT, and
-- has_platform_permission() returns true for an owner role regardless.
insert into public.platform_permission_definitions (key, label, category, sort_order)
values ('view_events', 'צפייה בפרטי אירוע', 'support', 5)
on conflict (key) do nothing;

-- Grant it to the three non-owner roles that already have a job requiring them
-- to open ONE identified event:
--
--   ops_engineer  — /admin/voice/events/{id} is gated on manage_voice but reads
--                   the event through getEventForAdminView, which demands
--                   manage_billing and redirects. Today that page is REACHABLE
--                   AND BROKEN for this role; this grant plus the reader swap in
--                   the same change set is what makes it work.
--   billing_clerk — cannot bill an event it is not allowed to identify.
--   support_agent — cannot support one either.
--
-- auditor is deliberately omitted: oversight reads aggregates, not one named
-- customer's event. If that turns out wrong it is a tick-box in /admin/roles,
-- not another migration.
insert into public.platform_role_permissions (role_id, permission_id)
select r.id, p.id
from public.platform_roles r
join public.platform_permission_definitions p on p.key = 'view_events'
where r.name in ('ops_engineer', 'billing_clerk', 'support_agent')
on conflict (role_id, permission_id) do nothing;
