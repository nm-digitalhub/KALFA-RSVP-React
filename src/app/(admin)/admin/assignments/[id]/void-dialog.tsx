'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/forms';
import { voidAssignmentAction } from '../actions';

// The void dialog (admin-panel ד.6, spec §9): opened only from the detail page, the
// project's AlertDialog (never window.confirm), a REQUIRED reason, and the danger styling.
// The server re-decides under locks; the outcome (done, or refused because the state moved)
// is answered on the detail page, which re-reads the live state.

export function VoidAssignmentDialog({
  assignmentId,
  listSearch,
  customerLabel,
  offerTitle,
}: {
  assignmentId: string;
  listSearch: string;
  customerLabel: string;
  offerTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const action = voidAssignmentAction.bind(null, assignmentId, listSearch);
  const [state, formAction, pending] = useActionState(action, null);

  // Only validation and unexpected errors come back here (the reason stays in this
  // component's state); a refusal or a success navigates to the detail page instead.
  useEffect(() => {
    if (state?.error) router.refresh();
  }, [state, router]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        disabled={pending}
        render={<Button type="button" variant="destructive" size="sm" />}
      >
        ביטול ההטבה
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול ההטבה</AlertDialogTitle>
            <AlertDialogDescription>
              {customerLabel} · {offerTitle}
              <br />
              לאחר הביטול לא ניתן יהיה להשתמש בהטבה הזאת.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <FormError message={state?.error} />

          <div className="space-y-1">
            <label htmlFor="void-reason" className="block text-sm font-medium">
              סיבת הביטול
            </label>
            <textarea
              id="void-reason"
              name="reason"
              required
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
            />
            <p className="text-xs text-muted-foreground">עד 500 תווים. הסיבה נשמרת בהיסטוריית ההטבה.</p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel render={<Button type="button" variant="outline" />}>
              חזרה
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending || reason.trim() === ''}>
              {pending ? 'מבטל…' : 'ביטול ההטבה'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
