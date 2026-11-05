import type { Metadata } from 'next';

import { EventTypePage } from '@/components/site/event-type-page';
import { getT } from '@/i18n.server';
import { getEventTypeContent } from '@/lib/marketing/event-types';
import { pageOpenGraph } from '@/lib/seo/open-graph';

// Copy lives in the catalogue (src/lib/marketing/event-types.ts) so the four
// event-type pages can be compared side by side; the markup lives once in
// EventTypePage. The brand is appended by the root layout's title.template.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('public');
  const content = getEventTypeContent('wedding', t);
  return {
    title: content.title,
    description: content.description,
    // Same reason as the other public pages — see src/lib/seo/open-graph.ts.
    openGraph: pageOpenGraph(content.title, content.description, content.path),
    alternates: { canonical: content.path },
  };
}

export default function WeddingRsvpPage() {
  return <EventTypePage slug="wedding" />;
}
