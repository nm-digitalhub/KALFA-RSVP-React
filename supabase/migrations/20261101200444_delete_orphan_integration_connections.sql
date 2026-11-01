-- Delete the integration connections the removed workflow system left behind — owner decision, 01.11.2026.
--
-- With the workflow builder gone (20261101182757_remove_workflow_system) nothing reads these rows:
--   provider 'sumit', credential_kind 'trigger_url' — the SUMIT CRM trigger subscriptions that fed the workflow
--     webhook (/api/workflows/hook, removed). The payment provider is now CardCom.
--   provider 'microsoft' — the delegated OAuth connection of the workflow's send-email node.
-- Each row keeps its secret in Vault; the secrets go with the rows.
--
-- KEPT: every other provider's row (WhatsApp Embedded Signup stores its token in this table).
-- No code change and no deploy order: no running code reads these providers' rows any more.
-- ROLLBACK: none — the credentials are not restorable; a new connection would be made from scratch.

delete from vault.secrets
where id in (
  select vault_secret_id
  from public.integration_connections
  where provider in ('sumit', 'microsoft') and vault_secret_id is not null
);

delete from public.integration_connections
where provider in ('sumit', 'microsoft');

do $$
begin
  if exists (select 1 from public.integration_connections where provider in ('sumit', 'microsoft')) then
    raise exception 'delete_orphan_integration_connections: a sumit or microsoft connection still exists';
  end if;
end;
$$;
