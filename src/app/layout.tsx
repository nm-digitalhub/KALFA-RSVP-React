import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

// The banner (and vanilla-cookieconsent's CSS, imported inside it) loads via
// the ssr:false client wrapper so it stays OUT of the render-blocking path —
// see cookie-consent-lazy.tsx for the doc-mandated shape.
import { CookieConsentBannerLazy } from '@/components/consent/cookie-consent-lazy';
import { DirectionProvider } from '@/components/ui/direction';
import { getT } from '@/i18n.server';
import { getCookieConsentPublicConfig } from '@/lib/consent/admin-config';
import { getAppOrigin } from '@/lib/url';
import { OPEN_GRAPH_BASE } from '@/lib/seo/open-graph';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
  // Read here once, so a page with no title of its own inherits this one in the visitor's language with no code of its own.
  const { t } = await getT('public');
  const title = t('site.home.meta.ogTitle', 'KALFA — ניהול אישורי הגעה');
  return {
    metadataBase: new URL(origin),
    // title.template brands every CHILD segment's title automatically
    // ("קמפיינים | KALFA") — pages define only their own name and must NOT
    // append the brand by hand. `default` covers segments with no title of
    // their own (a default is required alongside a template per the docs).
    title: {
      default: title,
      template: '%s | KALFA',
    },
    description: t(
      'site.home.meta.description',
      'מערכת אישורי הגעה לחתונה ולכל אירוע: ניהול רשימת מוזמנים ומלווים, שליחת הזמנות ותזכורות בוואטסאפ, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד.',
    ),
    openGraph: {
      // Shared base (type/locale/siteName) lives in src/lib/seo/open-graph.ts
      // so a page can spread it: setting `openGraph` on a page REPLACES this
      // whole object rather than merging into it.
      ...OPEN_GRAPH_BASE,
      title,
      description: t(
        'site.home.meta.ogDescription',
        'ניהול מוזמנים, הזמנות ותזכורות, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד.',
      ),
      // og:image intentionally NOT set here — the file convention
      // (src/app/opengraph-image.png + .alt.txt) emits it and takes priority.
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieConsentAdminConfig = await getCookieConsentPublicConfig();
  const { i18n, lng } = await getT('public');
  const direction = i18n.dir(lng);
  return (
    <html lang={lng} dir={direction} className={`${heebo.variable} h-full font-sans`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        {/* shadcn RTL guide (ui.shadcn.com/docs/rtl + /docs/components/base/direction,
            read 2026-08-24): `rtl: true` in components.json handles the class
            transforms; Base UI's portaled parts (menus, sheets, navigation-menu
            popups) ignore the DOM `dir` and read this provider instead, so it
            lives here at the root alongside dir="rtl" on <html>. The per-component
            providers that pre-date this are redundant but harmless. */}
        <DirectionProvider direction={direction}>
          {children}
          <CookieConsentBannerLazy adminConfig={cookieConsentAdminConfig} />
        </DirectionProvider>
      </body>
    </html>
  );
}
