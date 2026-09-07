-- Company Instagram profile URL, admin-managed next to the other company_*
-- details (/admin/company).
--
-- WHY. Search Console's platform-property verification offers "automated
-- connection via an existing website property" — Google links an Instagram
-- account to a verified site only when the two point at each other. The
-- home page's Organization JSON-LD had no `sameAs`, and the profile had no
-- website, so the only path left was a direct Instagram login that pauses
-- whenever that session expires. This column feeds the site half:
-- Organization.sameAs on beta.kalfa.me (the profile's website field is set
-- by hand in Instagram). It is also the standard entity-identity signal for
-- Google's Knowledge Graph and AI answer engines — a real SEO/GEO gap on
-- its own, independent of Search Console.
--
-- Nullable, no default: an empty value simply omits sameAs — never a stale
-- placeholder (house rule). Admin-only under the existing app_settings RLS.
alter table public.app_settings
  add column company_instagram_url text;

comment on column public.app_settings.company_instagram_url is
  'Public Instagram profile URL of the company (https://www.instagram.com/<handle>/). Emitted as Organization.sameAs in the site JSON-LD; empty = omitted. Admin-managed via /admin/company.';
