'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { deleteGuestAction } from './guests-actions';
import { recoverFromVersionSkew } from '@/components/use-version-skew-reload';

// Per-row edit link + delete button. Delete confirms first, then calls the
// server action with the ids bound here (never trusting a browser-supplied id
// beyond this owner-scoped page; the action re-verifies ownership server-side).
//
// `compact` renders icon-only controls for the dense mobile card (labels move
// to aria-label so the a11y name is preserved); the desktop table keeps the
// full-text buttons.
export function GuestRowActions({
  eventId,
  guestId,
  compact = false,
}: {
  eventId: string;
  guestId: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onDelete() {
    if (!window.confirm('למחוק את המוזמן?')) return;
    setFailed(false);
    startTransition(async () => {
      try {
        await deleteGuestAction(eventId, guestId);
      } catch (err) {
        // A stale-deployment action id reloads the tab (shared recovery);
        // anything else keeps the inline "נכשל" indicator.
        if (!recoverFromVersionSkew(err)) setFailed(true);
      }
    });
  }

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <Link
          href={`/app/events/${eventId}/guests/${guestId}`}
          aria-label="עריכת מוזמן"
          title="עריכה"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <Pencil className="size-4" aria-hidden />
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={pending}
          aria-label="מחיקת מוזמן"
          title="מחיקה"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
        {failed ? (
          <span role="alert" className="sr-only">
            מחיקה נכשלה
          </span>
        ) : null}
      </div>
    );
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
