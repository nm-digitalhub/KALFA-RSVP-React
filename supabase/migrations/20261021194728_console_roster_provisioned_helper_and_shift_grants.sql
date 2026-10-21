-- harden-console-agent-permissions, stage S1 (design D4, D5): the roster's `provisioned` flag comes from a definer helper,
-- console_agent_secrets closes to every client, and console_agent_shift keeps only what its upsert needs.
--
-- WHY.
--   - console_agent_secrets granted authenticated SELECT (user_id) and had the policy is_console_agent(), so every active agent
--     listed every agent that has a secret. The grant existed for one reader: the security-invoker view console_agents_roster,
--     which computed provisioned = (vox_username IS NOT NULL AND cas.user_id IS NOT NULL) through a LEFT JOIN
--     (20260827123914_harden_console_agents_roster_view.sql). The softphone gates dial, transfer, consult and conference
--     targets on that flag (softphone-panel.tsx:312, roster-dial-button.tsx:60, call-bar.tsx:230). Narrowing the policy to the
--     caller's own row made every colleague provisioned=false; revoking the grant made the roster fail with 42501 (both executed
--     in a rolled-back simulation, 21.10.2026). The helper below keeps the flag identical and removes the direct read.
--   - console_agent_shift held every table privilege for authenticated (arwdDxtm: TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
--     included) through the default ACL, and its update policy checked ownership only, so an inactive agent could update its
--     own row with an UPDATE without WHERE in raw SQL (not through PostgREST, which always sends WHERE + RETURNING).
--
-- WHO READS WHAT (live, 21.10.2026; production and local identical):
--   - console_agent_secrets: vox_password only through the service role (console-sdk-auth.ts:77-90, returns a hash);
--     user_id only through console_agents_roster. No view other than the roster depends on the table.
--   - console_agents_roster: authenticated SELECT; owner postgres; no comment; no dependent view.
--   - console_agent_shift: the Bearer client upserts (agent_id, active, updated_at) with onConflict agent_id
--     (api/agents/shift/route.ts:76-81); PostgREST sets agent_id = excluded.agent_id, so agent_id needs UPDATE too.
--
-- ROLLBACK (live definitions read 21.10.2026):
--   create or replace view public.console_agents_roster with (security_invoker = on) as
--     select ca.user_id, ca.display_name, coalesce(ast.status, 'not_ready'::text) as status, ast.updated_at as status_updated_at,
--            ((ca.vox_username is not null) and (cas.user_id is not null)) as provisioned,
--            cp.busy_until as calendar_busy_until, cp.show_as as calendar_show_as
--       from public.console_agents ca
--       left join public.agent_status ast on ast.agent_id = ca.user_id
--       left join public.console_agent_secrets cas on cas.user_id = ca.user_id
--       left join public.console_agent_calendar_presence cp on cp.agent_id = ca.user_id
--      where public.is_console_agent();
--   grant select (user_id) on public.console_agent_secrets to authenticated;
--   create policy console_agent_secrets_select on public.console_agent_secrets for select to authenticated
--     using (public.is_console_agent());
--   drop function public.console_agent_provisioned(uuid);
--   grant select, insert, update, delete, truncate, references, trigger, maintain on public.console_agent_shift to authenticated;
--   alter policy console_agent_shift_update_own on public.console_agent_shift
--     using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()));

-- D4: provisioned without a client read of the secrets table. Gated on is_console_agent() so a non-agent learns nothing.
create function public.console_agent_provisioned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_console_agent())
     and exists (select 1 from public.console_agent_secrets s where s.user_id = p_user_id);
$$;

comment on function public.console_agent_provisioned(uuid) is
  'True when the agent has a stored telephony secret; false for non-agent callers. Used by console_agents_roster.provisioned '
  'so that no client needs to read console_agent_secrets (harden-console-agent-permissions D4).';

revoke all on function public.console_agent_provisioned(uuid) from public, anon;
grant execute on function public.console_agent_provisioned(uuid) to authenticated, service_role;

-- Same columns, order and types as before; only the secrets join is replaced by the helper. Grants on the view are kept.
create or replace view public.console_agents_roster with (security_invoker = on) as
  select ca.user_id,
         ca.display_name,
         coalesce(ast.status, 'not_ready'::text) as status,
         ast.updated_at as status_updated_at,
         ((ca.vox_username is not null) and public.console_agent_provisioned(ca.user_id)) as provisioned,
         cp.busy_until as calendar_busy_until,
         cp.show_as as calendar_show_as
    from public.console_agents ca
    left join public.agent_status ast on ast.agent_id = ca.user_id
    left join public.console_agent_calendar_presence cp on cp.agent_id = ca.user_id
   where public.is_console_agent();

-- The secrets table: server only.
drop policy console_agent_secrets_select on public.console_agent_secrets;
revoke all on public.console_agent_secrets from anon, authenticated;

-- D5: console_agent_shift keeps SELECT and the upsert's columns; the update policy also requires an active agent.
revoke all on public.console_agent_shift from anon, authenticated;
grant select on public.console_agent_shift to authenticated;
grant insert (agent_id, active, updated_at), update (agent_id, active, updated_at) on public.console_agent_shift to authenticated;

alter policy console_agent_shift_update_own on public.console_agent_shift
  using (agent_id = (select auth.uid()) and (select public.is_console_agent()))
  with check (agent_id = (select auth.uid()) and (select public.is_console_agent()));
