import type { Metadata } from 'next';

import { EventTypePage } from '@/components/site/event-type-page';
import { getEventType } from '@/lib/marketing/event-types';

// Copy lives in the catalogue (src/lib/marketing/event-types.ts) so the four
// event-type pages can be compared side by side; the markup lives once in
// EventTypePage. The brand is appended by the root layout's title.template.
const content = getEventType('brit');

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function BritRsvpPage() {
  return <EventTypePage content={content} />;
}
