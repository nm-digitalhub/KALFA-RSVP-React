-- app_settings: direct table access (the cookie client, a staff member's own JWT) requires the
-- platform permission `manage_settings`, not mere membership in platform_staff.
--
-- Until now app_settings_admin_all admitted every row of platform_staff (is_platform_staff()),
-- while the app gated the settings screens with `manage_settings`. The table holds provider
-- credentials (SMTP, WhatsApp, SUMIT, Slack, ElevenLabs, Voximplant tokens/secrets), so a
-- staff member without the permission — e.g. billing_clerk, or a future read-only auditor —
-- could read AND overwrite them straight through PostgREST with the public anon key and their
-- own session token. The owner role holds every permission by definition
-- (has_platform_permission), so the owner is unaffected.
--
-- THIS CHANGE WAS ALREADY APPLIED TO THE LIVE DATABASE by hand (13.10.2026); this file records
-- it so every other environment (local, reset, preview) converges. ALTER POLICY is idempotent:
-- running it where the policy is already in this shape is a no-op. The table GRANTs are
-- unchanged (SELECT, UPDATE to authenticated; service_role bypasses RLS).
--
-- Consequence to know: code that reads app_settings through the COOKIE client under a
-- permission other than manage_settings now gets zero rows (no error) — today that is the
-- owner-agent status card in the integrations panel (getOwnerAgentStatus, staff floor only).
--
-- ROLLBACK:
--   alter policy app_settings_admin_all on public.app_settings
--     using ((select public.is_platform_staff()))
--     with check ((select public.is_platform_staff()));

alter policy app_settings_admin_all on public.app_settings
  using ((select public.has_platform_permission('manage_settings')))
  with check ((select public.has_platform_permission('manage_settings')));
