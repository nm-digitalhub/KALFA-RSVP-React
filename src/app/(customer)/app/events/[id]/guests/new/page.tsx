import Link from 'next/link';

import { requireOwnedEvent } from '@/lib/data/events';
import { listGroups } from '@/lib/data/guests';
import { createGuestAction } from '../guests-actions';
import { GuestForm } from '../guest-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NewGuestPage({ params }: PageProps) {
  const { id: eventId } = await params;
  // Ownership gate before loading the form's groups.
  await requireOwnedEvent(eventId);
  const groups = await listGroups(eventId);

  // Bind the event id server-side; the action re-verifies ownership.
  const action = createGuestAction.bind(null, eventId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">מוזמן חדש</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה
        </Link>
      </div>

      <GuestForm action={action} groups={groups} submitLabel="הוספת מוזמן" />
    </div>
  );
}
