import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { canCreateEvent } from '@/lib/data/events';
import { NewEventForm } from './new-event-form';

export const metadata: Metadata = { title: 'אירוע חדש' };

export default async function NewEventPage() {
  // R10, server-side: hiding the button on the list is not a gate — this URL is
  // typed, bookmarked and linked. A customer who already has an event is sent
  // back rather than shown a form whose submit is certain to be refused.
  if (!(await canCreateEvent())) {
    redirect('/app/events');
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">אירוע חדש</h1>
        <Link href="/app/events" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <span aria-hidden="true">→</span>
          חזרה לרשימה
        </Link>
      </div>

      <NewEventForm />
    </div>
  );
}
