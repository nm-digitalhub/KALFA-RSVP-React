import type { MetadataRoute } from 'next';

import { EVENT_TYPES } from '@/lib/marketing/event-types';
import { getAppOrigin } from '@/lib/url';

// Served at /sitemap.xml. Lists only the public (site) pages — token surfaces
// and the authenticated app are excluded here and disallowed in robots.ts.
// lastModified is intentionally omitted: a build timestamp would misreport
// content freshness on every deploy.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${origin}/faq`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${origin}/contact`, changeFrequency: 'monthly', priority: 0.8 },
    // Event-type pages. Each targets its own long-tail phrase
    // ("אישורי הגעה ל<סוג>"); the generic head term stays with `/`.
    ...EVENT_TYPES.map((e) => ({
      url: `${origin}${e.path}`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: `${origin}/whatsapp`, changeFrequency: 'monthly', priority: 0.7 },
    // The template's own landing page. The file it serves
    // (/guest-list-template.csv) is deliberately absent: a sitemap lists
    // pages, not attachments.
    { url: `${origin}/guest-list-template`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${origin}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/cookies`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
