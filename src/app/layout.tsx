import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

// The banner (and vanilla-cookieconsent's CSS, imported inside it) loads via
// the ssr:false client wrapper so it stays OUT of the render-blocking path —
// see cookie-consent-lazy.tsx for the doc-mandated shape.
import { CookieConsentBannerLazy } from '@/components/consent/cookie-consent-lazy';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';
import { getAppOrigin } from '@/lib/url';

// Heebo is the primary font (Hebrew + Latin) and drives shadcn's --font-sans.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-sans',
  display: 'swap',
});

// generateMetadata (not a static object) because metadataBase must come from
// getAppOrigin() — the same APP_ORIGIN-only source every absolute link uses,
// never a raw env read or the request Host. metadataBase makes every relative
// canonical/og URL below (and in child segments) resolve absolute.
export async function generateMetadata(): Promise<Metadata> {
  const origin = await getAppOrigin();
  return {
    metadataBase: new URL(origin),
    // title.template brands every CHILD segment's title automatically
    // ("קמפיינים | KALFA") — pages define only their own name and must NOT
    // append the brand by hand. `default` covers segments with no title of
    // their own (a default is required alongside a template per the docs).
    title: {
      default: 'KALFA — ניהול אישורי הגעה',
      template: '%s | KALFA',
    },
    description:
      'מערכת אישורי הגעה לחתונה ולכל אירוע: ניהול רשימת מוזמנים ומלווים, שליחת הזמנות ותזכורות בוואטסאפ, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד.',
    openGraph: {
      type: 'website',
      locale: 'he_IL',
      siteName: 'KALFA',
      title: 'KALFA — ניהול אישורי הגעה',
      description:
        'ניהול מוזמנים, הזמנות ותזכורות, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד.',
      // og:image intentionally NOT set here — the file convention
      // (src/app/opengraph-image.png + .alt.txt) emits it and takes priority.
    },
    twitter: { card: 'summary_large_image' },
  };
}

// Bounds staleness (to at most this many seconds) for any route that would
// otherwise be statically frozen at build time — the auth pages
// (src/app/auth/**) have no dynamic API usage today and are the actual risk;
// every other surface is already forced dynamic for unrelated reasons (home
// via getUser()→cookies(); /contact /terms /cookies /privacy and the guest
// token routes via their own `dynamic = 'force-dynamic'`; customer/admin via
// cookies() in their layouts). See plans/cookie-consent-admin-control.md §9
// for the full reasoning (Next.js 16.2.11, cacheComponents NOT enabled — the
// classic model applies, confirmed against node_modules/next/dist/docs).
// `revalidatePath('/', 'layout')` in every admin write
// (src/app/(admin)/admin/cookie-consent/actions.ts) gives near-immediate
// invalidation on top of this backstop.
export const revalidate = 20;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieConsentAdminConfig = await getCookieConsentPublicConfig();
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full font-sans`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        {children}
        <CookieConsentBannerLazy adminConfig={cookieConsentAdminConfig} />
      </body>
    </html>
  );
}
