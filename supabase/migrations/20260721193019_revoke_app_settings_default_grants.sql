-- app_settings: take back the table privileges the schema defaults handed out.
--
-- This table holds every platform secret — sumit_api_key, whatsapp_access_token,
-- whatsapp_app_secret, slack_bot_token, smtp_password, dkim_private_key,
-- elevenlabs_api_key, extra_sms_token, voximplant_callback_secret — and the
-- grant layer on it was wide open:
--
--   anon           INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   authenticated  INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- NOT a live exposure, and this migration is not a breach response: RLS is
-- enabled and the single policy (app_settings_admin_all) requires
-- has_role(auth.uid(),'admin'), so a role with no matching policy is denied.
-- Verified empirically before writing this — as `anon` and as a non-admin
-- `authenticated`, `select count(*) from app_settings` returns 0 rows.
--
-- The problem is that RLS is the ONLY thing standing there. On the most
-- sensitive table in the system there should be two layers, not one: if RLS is
-- ever dropped or disabled by a future migration — even briefly — every secret
-- becomes readable by `anon` through PostgREST, with the grants saying that is
-- fine. The same "defaults were never revoked" shape produced a real hole in the
-- console views yesterday (migration 20260720193844) and reopened it a day later
-- (20260721133850), so it is not a hypothetical failure mode here.
--
-- Grants are reduced to what the code actually uses, verified by reading every
-- call site:
--   * anon has no legitimate access at all → everything revoked.
--   * authenticated reaches this table ONLY through the admin UI, via the cookie
--     client, in six modules (admin/settings, admin/channels, admin/alerts,
--     admin/outreach-master, admin/voximplant-channel, admin/agreement config).
--     Every one of them does SELECT and/or UPDATE. There is no insert, upsert or
--     delete anywhere — the table is a single settings row (count = 1).
--   * service_role is untouched; the worker and every server path use it.
--
-- RLS still decides WHO among authenticated may act (admins only). This just
-- stops the grant layer from being a blank cheque underneath it.

revoke all on public.app_settings from anon;
revoke all on public.app_settings from authenticated;

grant select, update on public.app_settings to authenticated;
