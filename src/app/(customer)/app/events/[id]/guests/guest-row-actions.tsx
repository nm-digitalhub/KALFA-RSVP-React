'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { deleteGuestAction } from './guests-actions';
import { recoverFromVersionSkew } from '@/components/use-version-skew-reload';

// Per-row edit link + delete button. Delete confirms first, then calls the
// server action with the ids bound here (never trusting a browser-supplied id
// beyond this owner-scoped page; the action re-verifies ownership server-side).
//
// `compact` renders icon-only controls for the dense mobile card (labels move
// to aria-label so the a11y name is preserved); the desktop table keeps the
// full-text buttons. `guestName` makes each row's controls distinguishable to
// a screen reader (otherwise every row reads "עריכה"/"מחיקה").
export function GuestRowActions({
  eventId,
  guestId,
  guestName,
  compact = false,
}: {
  eventId: string;
  guestId: string;
  guestName?: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function onDelete() {
    setConfirmOpen(false);
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

  // Shared by both variants; portaled, so it does not affect either layout.
  const confirmContent = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>למחוק את המוזמן?</AlertDialogTitle>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>ביטול</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onDelete}>
          מחיקה
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <Link
          href={`/app/events/${eventId}/guests/${guestId}`}
          aria-label={guestName ? `עריכת ${guestName}` : 'עריכת מוזמן'}
          title="עריכה"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <Pencil className="size-4" aria-hidden />
        </Link>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger
            disabled={pending}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={guestName ? `מחיקת ${guestName}` : 'מחיקת מוזמן'}
                title="מחיקה"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              />
            }
          >
            <Trash2 className="size-4" aria-hidden />
          </AlertDialogTrigger>
          {confirmContent}
        </AlertDialog>
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
        {/* Visible text stays a prefix of the accessible name (label-in-name),
            so voice control still matches "עריכה"/"מחיקה". */}
        עריכה
        {guestName ? <span className="sr-only"> – {guestName}</span> : null}
      </Link>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger
          disabled={pending}
          render={<Button type="button" variant="destructive" size="sm" />}
        >
          {pending ? 'מוחק…' : 'מחיקה'}
          {guestName ? <span className="sr-only"> – {guestName}</span> : null}
        </AlertDialogTrigger>
        {confirmContent}
      </AlertDialog>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          נכשל
        </span>
      ) : null}
    </div>
  );
}
