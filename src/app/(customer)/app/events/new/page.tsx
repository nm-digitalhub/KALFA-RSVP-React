import Link from 'next/link';

import { NewEventForm } from './new-event-form';

export default function NewEventPage() {
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
