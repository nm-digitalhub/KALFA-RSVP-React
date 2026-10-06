-- Answer "is this provider configured, and is it switched on" WITHOUT handing the
-- secret to the application to find out.
--
-- WHY. /admin/debug's Integrations panel renders seven ✔/✘ marks. To produce them,
-- getIntegrationsStatus() calls five resolvers that each return the real credential:
--
--   getWhatsAppConfig()               -> accessToken, appSecret
--   getVoximplantConfig()             -> the service-account JSON
--   getElevenLabsApiKeyWithSource()   -> the key
--   getAlertsConfig()                 -> the Slack bot token
--   getSumitServerConfig()            -> the SUMIT api key
--
-- Five secrets read through the service-role client, on every page load, to compute
-- five booleans. Nothing leaks -- the panel prints only the booleans -- but they sit
-- in process memory for no reason, and the plan's own readiness review already ruled
-- (§0.2) that the equivalent NEW code must not do this. Same rule, applied to the
-- code that already exists.
--
-- It also fixes a real display bug. ExtrA's "configured" is currently derived from
-- getSmsSender(), which throws SmsConfigError when `!sms_enabled || !token || !sender`
-- -- so switching SMS OFF makes the panel report ExtrA as NOT CONFIGURED, rather than
-- "configured, switched off". Splitting the two answers apart is what tells them
-- apart; see the `_enabled` columns below.
--
-- WHAT IT DOES NOT COVER, deliberately: ElevenLabs falls back to
-- process.env.ELEVENLABS_API_KEY when the column is empty, GA4 is env-only, and
-- Voximplant live calls carry an env KILL SWITCH (VOXIMPLANT_LIVE_CALLS='false' hard
-- disables regardless of the DB). SQL cannot see any of those. The DB half is
-- returned here and the env half stays in TypeScript, ORed/ANDed there -- stated
-- rather than silently half-answered.
--
-- Empty string counts as unset, matching every caller: getWhatsAppConfig treats ''
-- as missing (`if (!phoneNumberId || !accessToken) return null`), and so do the rest.
--
-- ROLLBACK: drop function public.integrations_configured_flags();

create or replace function public.integrations_configured_flags()
returns table (
  whatsapp_configured   boolean,
  whatsapp_enabled      boolean,
  voximplant_configured boolean,
  voximplant_enabled    boolean,
  extra_sms_configured  boolean,
  extra_sms_enabled     boolean,
  email_configured      boolean,
  email_enabled         boolean,
  sumit_configured      boolean,
  sumit_enabled         boolean,
  slack_configured      boolean,
  slack_enabled         boolean,
  elevenlabs_configured boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- SECURITY DEFINER bypasses RLS on app_settings, so the gate is here. A non-staff
  -- caller gets ZERO ROWS, not false values — the difference matters: the client
  -- treats "no row" as unknown and fails closed, while a row of `false` would read
  -- as "nothing is configured" and be indistinguishable from a real answer.
  if not public.is_platform_staff() then
    return;
  end if;

  return query
  select
    (nullif(btrim(coalesce(s.whatsapp_phone_number_id, '')), '') is not null
     and nullif(btrim(coalesce(s.whatsapp_access_token, '')), '') is not null),
    coalesce(s.outreach_enabled, false),

    -- getVoximplantConfig() requires all three before it returns non-null.
    (nullif(btrim(coalesce(s.voximplant_service_account_json, '')), '') is not null
     and nullif(btrim(coalesce(s.voximplant_rule_id, '')), '') is not null
     and nullif(btrim(coalesce(s.voximplant_caller_id, '')), '') is not null),
    coalesce(s.voximplant_live_calls, false),

    -- Credentials only. sms_enabled is the SWITCH and is returned separately —
    -- that separation is the display bug this migration fixes.
    (nullif(btrim(coalesce(s.extra_sms_token, '')), '') is not null
     and nullif(btrim(coalesce(s.extra_sms_sender, '')), '') is not null),
    coalesce(s.sms_enabled, false),

    -- smtp_from is the one field both transports need; Resend needs nothing else,
    -- SMTP additionally needs a host. Which transport is active is an env decision
    -- (EMAIL_PROVIDER) the caller resolves, so the stricter half is left to it.
    (nullif(btrim(coalesce(s.smtp_from, '')), '') is not null),
    coalesce(s.email_enabled, false),

    (nullif(btrim(coalesce(s.sumit_company_id, '')), '') is not null
     and nullif(btrim(coalesce(s.sumit_api_key, '')), '') is not null),
    coalesce(s.payments_enabled, false),

    (nullif(btrim(coalesce(s.slack_bot_token, '')), '') is not null
     and nullif(btrim(coalesce(s.slack_alert_channel_id, '')), '') is not null),
    coalesce(s.slack_alerts_enabled, false),

    -- DB half only — the env fallback is ORed in TypeScript.
    (nullif(btrim(coalesce(s.elevenlabs_api_key, '')), '') is not null)
  from public.app_settings s
  where s.id = true;
end;
$$;

revoke execute on function public.integrations_configured_flags() from anon;
grant execute on function public.integrations_configured_flags() to authenticated, service_role;

comment on function public.integrations_configured_flags() is
  'Presence + switch state for every provider whose credentials live in app_settings, as booleans only — never a credential value. Exists so the admin Integrations panel can render seven status marks without loading five secrets into the application to do it. Staff-gated inside (SECURITY DEFINER bypasses RLS); a non-staff caller gets zero rows, which the client must treat as unknown. ElevenLabs env fallback, GA4 and the VOXIMPLANT_LIVE_CALLS kill switch are NOT visible to SQL and are resolved by the caller.';
