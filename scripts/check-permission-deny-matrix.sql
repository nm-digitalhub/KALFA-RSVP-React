begin;

-- Deny matrix: proves each non-owner platform role is REFUSED the sensitive
-- actions — by calling the REAL `has_platform_permission()` under an
-- impersonated session, not by re-implementing its rule here.
--
--   npm run check:permissions
--
-- It RAISES on a violation, so the command exits non-zero. Everything runs
-- inside BEGIN … ROLLBACK: the role reassignment used for impersonation is
-- undone whether the script passes, fails, or aborts.
--
-- WHY IT IMPERSONATES INSTEAD OF READING THE GRANT TABLES. A first version
-- reproduced the function's two-branch rule (owner holds everything; otherwise
-- the key must be granted) in SQL here. That tests our READING of the rule, not
-- the rule — a bug inside `has_platform_permission` would pass. So instead: move
-- one real staff member through every role in turn, set `request.jwt.claims` to
-- that user, and ask the function itself.
--
-- WHY IT DOES NOT DEPEND ON WHO IS STAFF TODAY. All three current staff hold
-- `owner`, so production data alone cannot exercise support_agent, auditor,
-- billing_clerk or ops_engineer. Those ROLES exist with their grants regardless
-- of who holds them, and the loop walks every row in `platform_roles`.
--
-- WHY THIS EXISTS AND WHY IT IS NOT A VITEST TEST. `admin-data-layer-coverage.test.ts`
-- proves the CODE names a permission for every module. It cannot prove the
-- permission is actually withheld from a role, because the grants live in
-- platform_role_permissions and the vitest suite is hermetic — it never opens a
-- database. This is the other half: the code says "this action needs
-- manage_voice", and this says "auditor does not have manage_voice". Neither
-- alone is the guarantee.
--
-- The expectations below were set 2026-09-10, after the audit that moved
-- workflows.ts, close-charge.ts and five more off the coarse requireAdmin() gate.
-- If a row here starts failing, someone widened a role — decide whether that was
-- intended before editing this file.

do $$
declare
  victim   uuid;
  original uuid;
  target   record;
  k        text;
  charge boolean; arm boolean; names boolean; voice boolean;
  got boolean; expected boolean;
  drift  text[] := array[]::text[];
  denied text[] := array[]::text[];
begin
  -- A REAL staff member: platform_staff.user_id has a foreign key to auth.users,
  -- so a synthetic uuid cannot be inserted. With three owners, moving one off the
  -- owner role still leaves two, so the last-owner trigger does not fire.
  select user_id, role_id into victim, original from public.platform_staff limit 1;
  if victim is null then
    raise exception 'no platform_staff row to impersonate with';
  end if;

  for target in select id, label, is_owner_role from public.platform_roles order by rank loop
    update public.platform_staff set role_id = target.id where user_id = victim;
    perform set_config('request.jwt.claims', json_build_object('sub', victim)::text, true);

    -- 1. The function agrees with the grants. A disagreement means the FUNCTION
    --    is wrong, which no amount of role-tuning would fix.
    foreach k in array array['manage_billing','manage_settings','manage_voice','view_customer_data'] loop
      select public.has_platform_permission(k) into got;
      select target.is_owner_role or exists (
        select 1 from public.platform_role_permissions rp
          join public.platform_permission_definitions pd on pd.id = rp.permission_id
         where rp.role_id = target.id and pd.key = k
      ) into expected;
      if got is distinct from expected then
        drift := drift || format('%s / %s → function said %s, grants say %s',
                                 target.label, k, got, expected);
      end if;
    end loop;

    -- 2. The deny rules, evaluated on what the FUNCTION returned.
    select public.has_platform_permission('manage_billing')     into charge;
    select public.has_platform_permission('manage_settings')    into arm;
    select public.has_platform_permission('view_customer_data') into names;
    select public.has_platform_permission('manage_voice')       into voice;

    -- Placing a call needs manage_voice AND view_customer_data. The two role
    -- axes — system vs. customer — do not overlap by design, so only an owner
    -- clears both. The strictest gate in the product.
    if (voice and names) and not target.is_owner_role then
      denied := denied || format('%s can DIAL A GUEST', target.label);
    end if;
    if charge and not target.is_owner_role and target.label <> 'חיוב וגבייה' then
      denied := denied || format('%s can CHARGE A CARD', target.label);
    end if;
    if arm and not target.is_owner_role and target.label <> 'תפעול טכני' then
      denied := denied || format('%s can ARM A WORKFLOW', target.label);
    end if;
    if names and not target.is_owner_role
       and target.label not in ('נציג תמיכה', 'חיוב וגבייה') then
      denied := denied || format('%s can READ GUEST NAMES', target.label);
    end if;
  end loop;

  update public.platform_staff set role_id = original where user_id = victim;

  if array_length(drift, 1) is not null then
    raise exception E'has_platform_permission disagrees with the grant tables:\n  - %',
      array_to_string(drift, E'\n  - ');
  end if;
  if array_length(denied, 1) is not null then
    raise exception E'permission deny matrix violated:\n  - %',
      array_to_string(denied, E'\n  - ');
  end if;

  raise notice 'deny matrix OK — every role answered by has_platform_permission itself';
end $$;

-- The matrix itself, printed for the reader.
with roles as (select id, label, is_owner_role, rank from public.platform_roles),
holds as (
  select r.id as role_id, pd.key
    from roles r
    join public.platform_role_permissions prp on prp.role_id = r.id
    join public.platform_permission_definitions pd on pd.id = prp.permission_id
),
can as (
  select r.label, r.rank, k.key,
         r.is_owner_role or exists (
           select 1 from holds h where h.role_id = r.id and h.key = k.key
         ) as allowed
    from roles r
    cross join (values
      ('manage_billing'), ('manage_settings'), ('manage_voice'), ('view_customer_data')
    ) as k(key)
)
select
  label                                                                    as role,
  bool_and(case when key = 'manage_billing'     then allowed end)          as charge_card,
  bool_and(case when key = 'manage_settings'    then allowed end)          as arm_workflow,
  bool_and(case when key = 'view_customer_data' then allowed end)          as read_guest_names,
  (bool_and(case when key = 'manage_voice'       then allowed end)
   and bool_and(case when key = 'view_customer_data' then allowed end))    as dial_a_guest
from can
group by label, rank
order by rank;

rollback;
