import type { MetadataRoute } from 'next';

import { getAppOrigin } from '@/lib/url';

// Served at /sitemap.xml. Lists only the public (site) pages — token surfaces
// and the authenticated app are excluded here and disallowed in robots.ts.
// lastModified is intentionally omitted: a build timestamp would misreport
// content freshness on every deploy.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${origin}/contact`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${origin}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/cookies`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
