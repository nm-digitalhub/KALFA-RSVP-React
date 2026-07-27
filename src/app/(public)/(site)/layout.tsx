import { GoogleAnalyticsGated } from '@/components/consent/google-analytics-gated';

// URL-neutral route group for the public MARKETING pages (home, contact,
// legal). Exists so consent-gated analytics can mount here without ever
// reaching the sibling guest token surfaces (/r /g /ty /join) — guests are
// deliberately not measured and their token URLs must not leak to a third
// party (see google-analytics-gated.tsx).
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <GoogleAnalyticsGated />
    </>
  );
}
