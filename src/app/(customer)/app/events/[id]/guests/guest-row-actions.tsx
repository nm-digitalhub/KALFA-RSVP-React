'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { deleteGuestAction } from './guests-actions';

// Per-row edit link + delete button. Delete confirms first, then calls the
// server action with the ids bound here (never trusting a browser-supplied id
// beyond this owner-scoped page; the action re-verifies ownership server-side).
export function GuestRowActions({
  eventId,
  guestId,
}: {
  eventId: string;
  guestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onDelete() {
    if (!window.confirm('למחוק את המוזמן?')) return;
    setFailed(false);
    startTransition(async () => {
      try {
        await deleteGuestAction(eventId, guestId);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={`/app/events/${eventId}/guests/${guestId}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        עריכה
      </Link>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        {pending ? 'מוחק…' : 'מחיקה'}
      </button>
      {failed ? (
        <span role="alert" className="text-xs text-red-600">
          נכשל
        </span>
      ) : null}
    </div>
  );
}
