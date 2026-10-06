-- Take EXECUTE back from PUBLIC on the two auth predicates added 2026-09-10.
--
-- Both were written with `revoke execute … from anon`, which is not enough: Postgres
-- grants EXECUTE to PUBLIC when a function is created, and `anon` INHERITS from
-- PUBLIC. Revoking the named role while leaving PUBLIC in place removes nothing.
--
-- MEASURED before this migration — the two functions written today, and only them:
--   is_platform_staff              {=X/postgres, postgres=…, authenticated=…, service_role=…}
--   integrations_configured_flags  {=X/postgres, postgres=…, authenticated=…, service_role=…}
-- while every sibling predicate is clean:
--   has_platform_permission        {postgres=…, authenticated=…, service_role=…}
--   is_platform_owner              {postgres=…, authenticated=…, service_role=…}
-- (the leading `=X` is PUBLIC.)
--
-- NOTHING LEAKED. Both resolve auth.uid(), which is null for an anonymous caller, so
-- is_platform_staff() returns false and integrations_configured_flags() returns zero
-- rows. This restores defence in depth rather than closing an exposure: an
-- authorization predicate should not be callable by everyone, because the next person
-- to change its body should not have to know that PUBLIC could reach it.
--
-- The same mistake was caught in the dry run of 20260910123341 the same afternoon and
-- fixed there before it shipped (`revoke … from public, anon`). This brings the two
-- that went out earlier into line with it and with their siblings.
--
-- ROLLBACK: grant execute on function <name> to public;  (do not — see above)

revoke execute on function public.is_platform_staff() from public;
revoke execute on function public.integrations_configured_flags() from public;

-- Re-assert the intended grants. Revoking from PUBLIC does not touch named roles, but
-- stating them keeps the end state readable without cross-referencing two migrations.
grant execute on function public.is_platform_staff() to authenticated, service_role;
grant execute on function public.integrations_configured_flags() to authenticated, service_role;
