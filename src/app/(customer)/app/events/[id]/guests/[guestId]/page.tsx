import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOwnedEvent } from '@/lib/data/events';
import { getGuest, listGroups } from '@/lib/data/guests';
import { updateGuestAction } from '../guests-actions';
import { GuestForm } from '../guest-form';

interface PageProps {
  params: Promise<{ id: string; guestId: string }>;
}

export default async function EditGuestPage({ params }: PageProps) {
  const { id: eventId, guestId } = await params;
  await requireOwnedEvent(eventId);

  const [guest, groups] = await Promise.all([
    getGuest(eventId, guestId),
    listGroups(eventId),
  ]);

  if (!guest) {
    notFound();
  }

  // Bind event + guest ids server-side; the action re-verifies ownership.
  const action = updateGuestAction.bind(null, eventId, guestId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">עריכת מוזמן</h1>
        <Link
          href={`/app/events/${eventId}/guests`}
          className="text-sm text-muted-foreground hover:underline"
        >
          חזרה
        </Link>
      </div>

      <GuestForm
        action={action}
        groups={groups}
        initial={guest}
        submitLabel="שמירת שינויים"
      />
    </div>
  );
}
