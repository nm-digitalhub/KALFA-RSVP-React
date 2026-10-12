-- The save-card switch (owner, 12.10.2026: "עדיף להוסיף מתג שיעדכן את אופן הסליקה") — D24's groundwork gets its
-- admin control. When ON, the package purchase requests ChargeAndCreateToken (charge + save the card for the
-- planned upgrades) instead of ChargeOnly; the request, the stamp on the ledger row and the settle gate all
-- follow the same value.
--
-- ⚠️ OPERATIONAL RULE (the admin form shows it too): before turning this ON, the package terms body must disclose
-- that the payment method is saved for future upgrade charges — the owner's/attorney's wording. The switch ships
-- OFF and nothing turns it on automatically.
--
-- cardcom_config_save is re-created with a TRAILING defaulted parameter (Postgres requires defaults to trail), so
-- existing named-arg callers keep working. A NULL for the new parameter means "keep the stored value" — the same
-- convention the function already uses for an empty password.
--
-- ROLLBACK: alter table public.cardcom_config drop column save_card_on_purchase;
--           re-create cardcom_config_save from the live definition minus the new parameter.

alter table public.cardcom_config
  add column save_card_on_purchase boolean not null default false;

comment on column public.cardcom_config.save_card_on_purchase is
  'When true, package purchases request ChargeAndCreateToken (save the card for future upgrade charges). The package terms body must disclose the saving BEFORE this is enabled. Default false.';

-- The new trailing parameter changes the signature, so CREATE OR REPLACE alone would leave the old 5-param
-- function behind as an ambiguous overload (verified on the replica: "function ... is not unique").
drop function if exists public.cardcom_config_save(integer, text, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.cardcom_config_save(p_terminal_number integer, p_api_name text, p_api_password text, p_enabled boolean, p_updated_by uuid, p_save_card_on_purchase boolean DEFAULT NULL)
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

  insert into public.cardcom_config (id, terminal_number, api_name, api_password_secret, enabled, save_card_on_purchase, updated_by)
  values (true, p_terminal_number, v_name, v_secret_id, p_enabled, coalesce(p_save_card_on_purchase, false), p_updated_by)
  on conflict (id) do update
     set terminal_number       = excluded.terminal_number,
         api_name              = excluded.api_name,
         api_password_secret   = excluded.api_password_secret,
         enabled               = excluded.enabled,
         -- NULL = the caller did not decide; keep what is stored (same convention as the empty password).
         -- The parameter, not excluded: excluded already holds the coalesced-to-false VALUES entry.
         save_card_on_purchase = coalesce(p_save_card_on_purchase, cardcom_config.save_card_on_purchase),
         updated_at            = now(),
         updated_by            = excluded.updated_by;
end $function$;

-- The drop above took the old signature's grants with it; restate them for the new signature
-- (same posture as 20261007215705: service_role only).
revoke execute on function public.cardcom_config_save(integer, text, text, boolean, uuid, boolean) from public, anon, authenticated;
grant execute on function public.cardcom_config_save(integer, text, text, boolean, uuid, boolean) to service_role;
