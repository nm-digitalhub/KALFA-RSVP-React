'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FormError, FormNotice } from '@/components/forms';
import {
  rollbackAccountCallbackAction,
  wireAccountCallbackAction,
} from '../actions';

// B5 wiring controls. Wiring is the ONE mutating Voximplant call — it is gated
// behind an AlertDialog that shows the exact URL that will be registered. On
// success the URL (which embeds the one-time raw token) is shown once so the
// admin can confirm; a rollback restores the previous callback.
export function WiringControls({
  state,
  proposedUrl,
}: {
  state: string;
  proposedUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registeredUrl, setRegisteredUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isWired = state === 'wired' || state === 'pending' || state === 'failed';

  const onWire = (): void => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await wireAccountCallbackAction();
      if (res?.error) {
        setError(res.error);
        return;
      }
      setNotice(res?.notice ?? null);
      setRegisteredUrl(res?.callbackUrl ?? null);
      setOpen(false);
      // Re-render the server component so the state badge reflects the new
      // 'wired' state immediately (not only after a manual reload).
      router.refresh();
    });
  };

  const onRollback = (): void => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await rollbackAccountCallbackAction();
      if (res?.error) {
        setError(res.error);
        return;
      }
      setNotice(res?.notice ?? null);
      setRegisteredUrl(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger
            render={
              <Button variant="outline" size="sm" disabled={pending}>
                {isWired ? 'חווט מחדש' : 'חווט התראות יתרה'}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>חיווט התראות יתרה מול Voximplant</AlertDialogTitle>
              <AlertDialogDescription>
                פעולה זו רושמת אצל Voximplant כתובת callback לחשבון (SetAccountInfo).
                הכתובת שתירשם:
                <code dir="ltr" className="mt-2 block break-all rounded bg-muted p-2 text-xs">
                  {proposedUrl}/…token
                </code>
                טוקן אקראי ייווצר, יישמר אצלנו כ־SHA-256 בלבד, ויוצג לך פעם אחת.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? <FormError message={error} /> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={onWire} disabled={pending}>
                {pending ? 'מחווט…' : 'אשר וחווט'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {isWired ? (
          <Button variant="ghost" size="sm" onClick={onRollback} disabled={pending}>
            {pending ? 'מבטל…' : 'בטל חיווט'}
          </Button>
        ) : null}
      </div>

      <FormNotice message={notice ?? undefined} />
      <FormError message={error ?? undefined} />
      {registeredUrl ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="font-medium">הכתובת שנרשמה (מוצגת פעם אחת — העתק אם צריך):</p>
          <code dir="ltr" className="block break-all">
            {registeredUrl}
          </code>
        </div>
      ) : null}
    </div>
  );
}
