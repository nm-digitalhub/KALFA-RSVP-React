-- CardCom document report (support.cardcom.solutions article 360007138014): CardCom POSTs every document the terminal
-- issues to a URL we give it. The post is not signed. What proves it is CardCom's is a shared secret we put in the
-- terminal's "מחרוזת תוספת לפנייה" (extra request string, e.g. secret=...), which CardCom appends to every report.
--
-- WHAT THIS ADDS: the secret, in Vault, under one fixed name, with a save, a read and an "is one saved" function. Same privileges and
-- search_path as cardcom_config_save / cardcom_api_password (20261007215705). No table and no column changes: the secret
-- is found by its unique Vault name, so cardcom_config and its save function stay as they are.
--
-- WHAT IT DOES NOT DO: store any report. Reports go through the existing webhook intake (webhook_deliveries +
-- webhook_inbox), like every other provider.
--
-- ROLLBACK:
--   drop function public.cardcom_document_report_secret_save(text);
--   drop function public.cardcom_document_report_secret();
--   drop function public.cardcom_document_report_secret_exists();
--   delete from vault.secrets where name = 'cardcom:document_report_secret';

-- Save: creates the secret on first use, replaces it afterwards. A blank value is refused (nothing to save).
create or replace function public.cardcom_document_report_secret_save(p_secret text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id    uuid;
  v_value text := btrim(coalesce(p_secret, ''));
begin
  if v_value = '' then
    raise exception using errcode = '22023', message = 'secret is required';
  end if;
  -- CardCom does not URL-encode the extra string: only English letters and digits are safe in it.
  if v_value !~ '^[A-Za-z0-9]{24,128}$' then
    raise exception using errcode = '22023', message = 'secret must be 24-128 English letters and digits';
  end if;

  -- Two concurrent first saves must not both create the secret (its name is unique).
  perform pg_advisory_xact_lock(hashtextextended('cardcom_document_report_secret', 0));

  select s.id into v_id from vault.secrets s where s.name = 'cardcom:document_report_secret';
  if v_id is null then
    perform vault.create_secret(v_value, 'cardcom:document_report_secret', 'CardCom document report webhook secret', null);
  else
    perform vault.update_secret(v_id, v_value, 'cardcom:document_report_secret', 'CardCom document report webhook secret');
  end if;
end $$;

-- Read: the decrypted secret, or null when none is saved. Called by the webhook route to check a report.
create or replace function public.cardcom_document_report_secret()
returns text
language sql
security invoker
stable
set search_path = ''
as $$
  select s.decrypted_secret
    from vault.decrypted_secrets s
   where s.name = 'cardcom:document_report_secret'
$$;

-- Whether a secret is saved, for the settings page. Answers a boolean so the page never handles the value.
create or replace function public.cardcom_document_report_secret_exists()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select exists (select 1 from vault.secrets s where s.name = 'cardcom:document_report_secret')
$$;

revoke execute on function public.cardcom_document_report_secret_save(text) from public, anon, authenticated;
revoke execute on function public.cardcom_document_report_secret_exists() from public, anon, authenticated;
grant execute on function public.cardcom_document_report_secret_exists() to service_role;
revoke execute on function public.cardcom_document_report_secret() from public, anon, authenticated;
grant execute on function public.cardcom_document_report_secret_save(text) to service_role;
grant execute on function public.cardcom_document_report_secret() to service_role;

-- ── Verification: fails the migration if a client role could run either function. ──
do $$
begin
  if has_function_privilege('anon', 'public.cardcom_document_report_secret()', 'execute')
     or has_function_privilege('authenticated', 'public.cardcom_document_report_secret()', 'execute')
     or has_function_privilege('anon', 'public.cardcom_document_report_secret_save(text)', 'execute')
     or has_function_privilege('authenticated', 'public.cardcom_document_report_secret_save(text)', 'execute')
     or has_function_privilege('anon', 'public.cardcom_document_report_secret_exists()', 'execute')
     or has_function_privilege('authenticated', 'public.cardcom_document_report_secret_exists()', 'execute') then
    raise exception 'cardcom_document_report_secret functions must be service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.cardcom_document_report_secret()', 'execute')
     or not has_function_privilege('service_role', 'public.cardcom_document_report_secret_save(text)', 'execute')
     or not has_function_privilege('service_role', 'public.cardcom_document_report_secret_exists()', 'execute') then
    raise exception 'service_role must be able to run cardcom_document_report_secret functions';
  end if;
end $$;
