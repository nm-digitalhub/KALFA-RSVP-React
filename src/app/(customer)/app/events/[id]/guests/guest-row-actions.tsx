'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
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
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/app/events/${eventId}/guests/${guestId}`}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        עריכה
      </Link>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={pending}
      >
        {pending ? 'מוחק…' : 'מחיקה'}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          נכשל
        </span>
      ) : null}
    </div>
  );
}
