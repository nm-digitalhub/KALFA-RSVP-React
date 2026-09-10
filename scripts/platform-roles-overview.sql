-- Platform roles × their permissions × the people holding them. Read-only.
--   npx supabase db query --linked -f scripts/platform-roles-overview.sql
--
-- ⚠️ READ THIS FOR SHAPE, NEVER TO NARROW A GATE. The roster is pre-launch and
-- temporary — three of the five roles have zero people today. "Nobody is locked out
-- by this permission" is a fact about this week, not about the resource, and a gate
-- justified that way fails on the day someone is hired, which is exactly when nobody
-- is looking for it. Gate on what the resource IS.
--
-- ⚠️ WHY THERE IS NO `DISTINCT` HERE, THOUGH THE OBVIOUS VERSION HAS ONE.
-- Joining permissions AND staff in one query multiplies rows — a role with 5
-- permissions and 2 people yields 10. `jsonb_agg(DISTINCT …)` hides that, and then
-- Postgres refuses the ordering:
--     42P10: in an aggregate with DISTINCT, ORDER BY expressions must appear in
--            argument list
-- because the ORDER BY keys (p.category, p.sort_order) are not the aggregated
-- expression. Two LATERAL subqueries remove the cross product at the source instead
-- of masking it: no DISTINCT, no GROUP BY, ordering works, and the counts are real
-- rather than deduplicated.
--
-- auth.users is joined LEFT: a staff row whose auth user was deleted still shows,
-- with a null email, rather than vanishing from the count.

SELECT
  r.name  AS role_name,
  r.label AS role_label,
  r.is_owner_role,
  r.rank,
  perms.n AS permission_count,
  staff.n AS staff_count,
  perms.list AS permissions,
  staff.list AS staff_members
FROM public.platform_roles AS r
LEFT JOIN LATERAL (
  SELECT count(*) AS n,
         coalesce(jsonb_agg(jsonb_build_object(
           'key', p.key, 'label', p.label, 'category', p.category
         ) ORDER BY p.category, p.sort_order, p.key), '[]'::jsonb) AS list
    FROM public.platform_role_permissions rp
    JOIN public.platform_permission_definitions p ON p.id = rp.permission_id
   WHERE rp.role_id = r.id
) AS perms ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS n,
         coalesce(jsonb_agg(jsonb_build_object(
           'email', u.email, 'since', s.created_at::date
         ) ORDER BY s.created_at), '[]'::jsonb) AS list
    FROM public.platform_staff s
    LEFT JOIN auth.users u ON u.id = s.user_id
   WHERE s.role_id = r.id
) AS staff ON true
ORDER BY r.is_owner_role DESC, r.rank DESC, r.sort_order, r.name;
