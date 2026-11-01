-- Remove the admin workflow (automation builder) system — owner decision, 01.11.2026.
--
-- DEPLOY ORDER: deploy the web app (kalfa-beta) AND the worker (kalfa-worker) first (`npm run deploy`). The code
-- that read and wrote these objects is removed in the same change; a worker still running the old build would
-- keep querying workflow_runs every minute. Then `supabase db push --linked`, then `npm run gen:types` and
-- `npm run types:check`. The two pg-boss queues (workflow-run, workflow-schedule-sweep) are dropped by the new
-- worker itself on start (RETIRED_QUEUES in src/lib/queue/queues.ts), not here.
--
-- KEPT ON PURPOSE: integration_connections and its credential functions (write / read / replace / rename /
-- disconnect / delete). WhatsApp Embedded Signup stores its token there through integrations_write_credential
-- (src/lib/data/admin/integrations/whatsapp-es.ts). Only the OAuth-client half that served workflow node
-- connections goes: integration_provider_configs, integration_oauth_states and the four functions that read or
-- refresh through them.
--
-- ROLLBACK: none in place. The removed objects can be recreated from the migrations that created them; the data
-- (21 workflow definitions, their run history, 4 voice purposes, OAuth state rows) is not restored.

-- ── The workflow engine ─────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.wake_parked_workflow_run(uuid, text, text);
drop table if exists public.workflow_run_events;
drop table if exists public.workflow_run_steps;
drop table if exists public.workflow_runs;
drop table if exists public.workflows;

-- ── Voice purposes (calls started only by a workflow node) ──────────────────────────────────────────────────────
drop table if exists public.voice_purpose_attempts;
drop table if exists public.voice_purposes;

-- call_analysis links a call to its attempt row; voice_purpose_attempts is no longer one of the attempt tables.
-- No row names it (measured on the live database before this migration: 0).
alter table public.call_analysis drop constraint call_analysis_attempt_table_known;
alter table public.call_analysis
  add constraint call_analysis_attempt_table_known check (
    attempt_table is null
    or attempt_table = any (
      array['call_attempts', 'callback_request_attempts', 'sales_call_attempts', 'inbound_agent_attempts']::text[]
    )
  );

-- ── The OAuth client registration for workflow node connections ─────────────────────────────────────────────────
-- A provider config keeps its client secret in Vault; remove the secrets with the rows that point at them.
delete from vault.secrets
where id in (
  select vault_secret_id from public.integration_provider_configs where vault_secret_id is not null
);
drop function if exists public.integrations_read_provider_secret(text);
drop function if exists public.integrations_upsert_provider_config(text, text, jsonb, text, boolean, uuid);
drop function if exists public.integrations_claim_credential_refresh(uuid, text, text, integer);
drop function if exists public.integrations_release_credential_refresh(uuid, uuid, text, text);
drop table if exists public.integration_provider_configs;
drop table if exists public.integration_oauth_states;

-- ── Verification: fail the migration if anything above did not take, or something kept is gone ─────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'workflows', 'workflow_runs', 'workflow_run_steps', 'workflow_run_events',
    'voice_purposes', 'voice_purpose_attempts', 'integration_provider_configs', 'integration_oauth_states'
  ] loop
    if to_regclass('public.' || t) is not null then
      raise exception 'remove_workflow_system: table public.% still exists', t;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'wake_parked_workflow_run', 'integrations_read_provider_secret', 'integrations_upsert_provider_config',
        'integrations_claim_credential_refresh', 'integrations_release_credential_refresh'
      )
  ) then
    raise exception 'remove_workflow_system: a removed function still exists';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'call_analysis_attempt_table_known'
      and pg_get_constraintdef(oid) like '%voice_purpose_attempts%'
  ) then
    raise exception 'remove_workflow_system: call_analysis_attempt_table_known still names voice_purpose_attempts';
  end if;

  if to_regclass('public.integration_connections') is null then
    raise exception 'remove_workflow_system: integration_connections must be kept (WhatsApp Embedded Signup)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'integrations_write_credential'
  ) then
    raise exception 'remove_workflow_system: integrations_write_credential must be kept (WhatsApp Embedded Signup)';
  end if;
end;
$$;
