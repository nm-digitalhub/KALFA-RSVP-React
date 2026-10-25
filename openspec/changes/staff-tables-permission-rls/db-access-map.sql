select json_build_object(
 'tables', (select json_agg(x order by x->>'t') from (
   select json_build_object('t', c.relname, 'kind', c.relkind::text, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity,
     'opts', coalesce(array_to_string(c.reloptions, ','), ''),
     'anon', (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee='anon'),
     'auth', (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee='authenticated'),
     'colgrants', (select string_agg(distinct grantee||':'||privilege_type, ',') from information_schema.column_privileges cp where cp.table_schema='public' and cp.table_name=c.relname and cp.grantee in ('anon','authenticated') and not exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee=cp.grantee and g.privilege_type=cp.privilege_type)),
     'policies', (select json_agg(json_build_object('n', p.policyname, 'cmd', p.cmd, 'perm', p.permissive, 'roles', p.roles::text, 'using', regexp_replace(coalesce(p.qual,''), '\s+', ' ', 'g'), 'check', regexp_replace(coalesce(p.with_check,''), '\s+', ' ', 'g')) order by p.policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
     'viewdef', case when c.relkind='v' then regexp_replace(pg_get_viewdef(c.oid), '\s+', ' ', 'g') end
   ) x from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m')) s),
 'helpers', (select json_agg(json_build_object('f', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'secdef', p.prosecdef, 'path', p.proconfig, 'src', regexp_replace(p.prosrc, '\s+', ' ', 'g')) order by p.proname)
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('can_access_event','is_event_owner','is_org_member','is_org_owner','has_org_permission','is_console_agent','is_platform_staff','is_platform_owner','has_platform_permission','owns_event','event_org_id','user_org_ids','can_manage_event'))
) probe;
