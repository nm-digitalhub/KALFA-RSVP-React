-- campaigns.runstate — staff authority to PAUSE and REVIVE a campaign.
--
-- The agent console needs to stop and restart a running campaign. The obvious
-- key to reuse was `manage_voice`, and it is the wrong one: its documented
-- meaning is "ניהול מוקד שיחות AI", while pausing a campaign also stops its
-- WhatsApp sends. Granting campaign run-state under a key that says "AI call
-- centre" would make the catalogue lie about what it hands out — and the
-- catalogue is precisely what a future hire reads when deciding who gets what.
--
-- `manage_billing` was considered and rejected for the opposite reason: it would
-- split pause from revive (only בעל מערכת holds both), leaving an operator able
-- to STOP a campaign at 22:00 the night before an event but not restart it. A
-- stop button must never be easier to reach than the start button that undoes it.
-- The risk that split would guard against is bounded anyway: revival is
-- restricted to `paused → active`, and `paused` is reachable only from `active`,
-- so a revived campaign is one the OWNER already activated, inside a ceiling the
-- owner already approved, against a J5 hold that already exists. Staff resume a
-- commitment; they can never create one.
--
-- The key is deliberately narrower than "manage campaigns": this grants run-state
-- only — not creation, approval, pricing or charging. Dotted naming follows the
-- existing `roles.manage` convention.
--
-- Blast radius on day one is ZERO: it is granted to exactly the roles that hold
-- manage_voice today (בעל מערכת, תפעול טכני), so nobody gains or loses access.
-- What changes is that the authority now has an honest name, and can be moved
-- independently of the call-floor permission once the ops role is staffed.

insert into public.platform_permission_definitions (key, label, category, sort_order)
values ('campaigns.runstate', 'השהיה והחייה של קמפיינים', 'ops', 75)
on conflict (key) do nothing;

-- Same holders as manage_voice, resolved by KEY/LABEL rather than hard-coded ids
-- so this is reproducible on a rebuilt database.
insert into public.platform_role_permissions (role_id, permission_id)
select r.id, d.id
from public.platform_roles r
cross join public.platform_permission_definitions d
where d.key = 'campaigns.runstate'
  and r.id in (
    select rp.role_id
    from public.platform_role_permissions rp
    join public.platform_permission_definitions pd on pd.id = rp.permission_id
    where pd.key = 'manage_voice'
  )
on conflict do nothing;
