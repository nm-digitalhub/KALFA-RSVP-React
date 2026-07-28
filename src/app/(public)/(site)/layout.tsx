import { GoogleAnalyticsGated } from '@/components/consent/google-analytics-gated';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';

// URL-neutral route group for the public MARKETING pages (home, contact,
// legal). Exists so consent-gated analytics can mount here without ever
// reaching the sibling guest token surfaces (/r /g /ty /join) — guests are
// deliberately not measured and their token URLs must not leak to a third
// party (see google-analytics-gated.tsx).
export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Deduped against the same call in the root layout via React `cache()`
  // (src/lib/consent/admin-config.ts) — not a second DB round trip.
  const cookieConsentAdminConfig = await getCookieConsentPublicConfig();
  return (
    <>
      {children}
      <GoogleAnalyticsGated mechanismEnabled={cookieConsentAdminConfig.enabled} />
    </>
  );
}
