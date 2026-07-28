import type { MetadataRoute } from 'next';

import { getAppOrigin } from '@/lib/url';

// Served at /robots.txt (App Router metadata route, cached — origin comes from
// APP_ORIGIN, not a request-time API). The disallow list keeps crawlers (search
// and AI alike) off the guest token surfaces and the authenticated app; only the
// public (site) pages are crawlable.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getAppOrigin();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/r/', '/g/', '/ty/', '/join/', '/app/', '/admin/', '/auth/', '/api/'],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
