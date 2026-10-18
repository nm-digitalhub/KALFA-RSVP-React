-- Google Pay on the CardCom package payment form (openspec/changes/add-google-pay-cardcom, design D1).
-- A three-position setting on the CardCom connection:
--   off     no buyer sees the Google Pay option (the default; nothing changes until the owner moves it);
--   admins  only someone who may configure the integration sees it (the real-money acceptance runs here);
--   all     every buyer going through CardCom sees it.
-- Any value outside these three is refused by the table's own check, and the application treats an unreadable value as off.
--
-- cardcom_config_save gets a second TRAILING defaulted parameter, the same way the save-card switch did
-- (20261012030027), so existing named-argument callers keep working. NULL means "keep the stored value", the same
-- convention the function already uses for an empty password and for the save-card switch.
--
-- ROLLBACK: alter table public.cardcom_config drop column google_pay_mode;
--           re-create cardcom_config_save from 20261012030027 (the six-parameter definition) and restate its grants.

alter table public.cardcom_config
  add column google_pay_mode text not null default 'off'
  constraint cardcom_config_google_pay_mode_check check (google_pay_mode in ('off', 'admins', 'all'));

comment on column public.cardcom_config.google_pay_mode is
  'Who is offered Google Pay on the package payment form: off (nobody, the default), admins (only someone who may configure the integration), all (every buyer through CardCom).';

-- The new trailing parameter changes the signature, so CREATE OR REPLACE alone would leave the six-parameter
-- function behind as an ambiguous overload (the same trap 20261012030027 documents).
drop function if exists public.cardcom_config_save(integer, text, text, boolean, uuid, boolean);

CREATE OR REPLACE FUNCTION public.cardcom_config_save(p_terminal_number integer, p_api_name text, p_api_password text, p_enabled boolean, p_updated_by uuid, p_save_card_on_purchase boolean DEFAULT NULL::boolean, p_google_pay_mode text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_secret_id uuid;
  v_name      text := btrim(coalesce(p_api_name, ''));
begin
  if p_terminal_number is null or p_terminal_number <= 0 then
    raise exception using errcode = '22023', message = 'terminal number is required';
  end if;
  if v_name = '' then
    raise exception using errcode = '22023', message = 'api name is required';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'enabled is required';
  end if;
  -- NULL keeps the stored value; anything else must be one of the three positions (the table check says the same).
  if p_google_pay_mode is not null and p_google_pay_mode not in ('off', 'admins', 'all') then
    raise exception using errcode = '22023', message = 'google pay mode must be off, admins or all';
  end if;

  -- Two concurrent first saves must not both create a Vault secret (the name below is unique).
  perform pg_advisory_xact_lock(hashtextextended('cardcom_config', 0));

  select c.api_password_secret into v_secret_id from public.cardcom_config c where c.id for update;

  if nullif(btrim(coalesce(p_api_password, '')), '') is not null then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_api_password, 'cardcom:api_password', 'CardCom API password (refunds only)', null);
    else
      perform vault.update_secret(v_secret_id, p_api_password, 'cardcom:api_password', 'CardCom API password (refunds only)');
    end if;
  end if;

  insert into public.cardcom_config (id, terminal_number, api_name, api_password_secret, enabled, save_card_on_purchase, google_pay_mode, updated_by)
  values (true, p_terminal_number, v_name, v_secret_id, p_enabled, coalesce(p_save_card_on_purchase, false), coalesce(p_google_pay_mode, 'off'), p_updated_by)
  on conflict (id) do update
     set terminal_number       = excluded.terminal_number,
         api_name              = excluded.api_name,
         api_password_secret   = excluded.api_password_secret,
         enabled               = excluded.enabled,
         -- NULL = the caller did not decide; keep what is stored (same convention as the empty password).
         -- The parameters, not excluded: excluded already holds the coalesced VALUES entries.
         save_card_on_purchase = coalesce(p_save_card_on_purchase, cardcom_config.save_card_on_purchase),
         google_pay_mode       = coalesce(p_google_pay_mode, cardcom_config.google_pay_mode),
         updated_at            = now(),
         updated_by            = excluded.updated_by;
end $function$;

-- The drop above took the old signature's grants with it; restate them for the new signature
-- (same posture as 20261007215705 and 20261012030027: service_role only).
revoke execute on function public.cardcom_config_save(integer, text, text, boolean, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.cardcom_config_save(integer, text, text, boolean, uuid, boolean, text) to service_role;
