import type { MetadataRoute } from 'next';

import { getAppOrigin } from '@/lib/url';

// Served at /robots.txt (App Router metadata route, cached — origin comes from
// APP_ORIGIN, not a request-time API). The disallow list keeps crawlers (search
// and AI alike) off the guest token surfaces and the authenticated app; only the
// public (site) pages are crawlable.
//
// /auth/ is deliberately NOT here. Google's own rule (Page Indexing report,
// "Blocked by robots.txt"): robots.txt is not the mechanism for keeping a page
// out of Search — a blocked URL can still be indexed as a bare URL when it is
// linked, and Google can never see a noindex it is not allowed to fetch. The
// sign-in/sign-up pages are linked from the homepage and llms.txt, so they get
// the correct treatment instead: crawlable + `robots: noindex` (src/app/auth/
// layout.tsx). The token surfaces (/r/ /g/ /rate/ /ty/ /join/) stay blocked on
// purpose even though they also carry noindex: a fetch of a guest's personal
// page hands guest data to a crawler, and no public page links to them, so
// the "bare URL" residual risk Google describes is the smaller of the two.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getAppOrigin();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/r/', '/g/', '/rate/', '/ty/', '/join/', '/app/', '/admin/', '/api/'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
