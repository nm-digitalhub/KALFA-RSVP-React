-- Cookie-consent admin control (app_settings singleton). Four admin-managed
-- AVAILABILITY flags — never a per-visitor consent choice (stays local-only,
-- see docs/consent/cookie-consent.md). RLS: no new policy — app_settings_admin_all
-- (FOR ALL, has_role(auth.uid(),'admin')) already covers every column. The
-- public read path (src/lib/consent/admin-config.ts) intentionally bypasses
-- RLS via the service-role client, server-side only, like
-- src/lib/data/alerts-config.ts. DEFAULTS = current shipped behavior —
-- applying this migration changes nothing observable until an admin flips a
-- toggle. See plans/cookie-consent-admin-control.md for the full design.
alter table public.app_settings
  add column if not exists cookie_consent_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_enabled is
  'Master kill switch for vanilla-cookieconsent. Default true (SAFE). When false, CookieConsentBanner never calls CookieConsent.run() — verified fail-safe: acceptedCategory() then returns false for every category regardless of any previously stored consent cookie (plans/cookie-consent-admin-control.md §2.1), so GoogleAnalyticsGated never loads GA / sends Consent Mode ad signals. Rare/emergency control, not a routine toggle.';

alter table public.app_settings
  add column if not exists cookie_consent_analytics_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_analytics_enabled is
  'Whether the `analytics` category is OFFERED at all. Default true. Every write bumps cookie_consent_revision_bump in the SAME UPDATE statement — see plans/cookie-consent-admin-control.md §2.2 (correctness requirement: omitting a category from the built config alone does not erase it from an already-valid stored consent cookie).';

alter table public.app_settings
  add column if not exists cookie_consent_marketing_enabled boolean not null default true;

comment on column public.app_settings.cookie_consent_marketing_enabled is
  'Whether the `marketing` (Google Ads remarketing/conversions) category is OFFERED at all. Default true. Same automatic-bump requirement as cookie_consent_analytics_enabled.';

alter table public.app_settings
  add column if not exists cookie_consent_revision_bump integer not null default 0;

comment on column public.app_settings.cookie_consent_revision_bump is
  'Admin-only, monotonically-increasing counter. Effective vanilla-cookieconsent revision sent to every visitor = CONSENT_REVISION (code constant, src/lib/consent/cookie-consent-config.ts) + this bump. Incremented by every write to cookie_consent_enabled/analytics_enabled/marketing_enabled and by the standalone "force re-consent" action, always in the SAME single-row UPDATE as the flag change (no RPC, no split writes). Never decremented.';
