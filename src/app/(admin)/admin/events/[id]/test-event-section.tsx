'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError, FormNotice } from '@/components/forms';
import { formatIsraelDate } from '@/lib/date';
import { markTestEventAction, purgeTestEventAction, unmarkTestEventAction } from './actions';

// Staff-only "test event" controls. Rendered by the page only for a viewer
// holding events.mark_test and/or events.purge_test; each action re-checks its
// own key server-side. The purge confirmation is built into the page (no
// confirm() dialog) and asks for the event name, so a stray click on the wrong
// event cannot delete it.
export function TestEventSection({
  eventId,
  eventName,
  marked,
  markedAt,
  purgeBlocked,
  canMark,
  canPurge,
}: {
  eventId: string;
  eventName: string;
  marked: boolean;
  markedAt: string | null;
  purgeBlocked: boolean;
  canMark: boolean;
  canPurge: boolean;
}) {
  const [markState, markAction, markPending] = useActionState(markTestEventAction, null);
  const [unmarkState, unmarkAction, unmarkPending] = useActionState(unmarkTestEventAction, null);
  const [purgeState, purgeAction, purgePending] = useActionState(purgeTestEventAction, null);
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState('');

  const confirmId = `purge-confirm-${eventId}`;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {marked
          ? `האירוע מסומן כאירוע בדיקה${markedAt ? ` (${formatIsraelDate(markedAt)})` : ''}. הסימון גלוי לצוות בלבד.`
          : 'האירוע אינו מסומן כאירוע בדיקה. רק אירוע מסומן ניתן למחיקה מלאה, כולל רישומי החיוב שלו.'}
      </p>

      {canMark && (
        <form action={marked ? unmarkAction : markAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="submit" variant="outline" disabled={markPending || unmarkPending}>
            {marked ? 'ביטול סימון אירוע בדיקה' : 'סימון כאירוע בדיקה'}
          </Button>
        </form>
      )}
      <FormError message={markState?.error ?? unmarkState?.error} />
      <FormNotice message={markState?.notice ?? unmarkState?.notice} />

      {canPurge && marked && (
        <div className="space-y-2 border-t border-border pt-3">
          {purgeBlocked ? (
            <p className="text-muted-foreground">
              לא ניתן למחוק: באירוע יש פעילות כספית (חיוב, תפיסת מסגרת שלא שוחררה, מסמך SUMIT או גביית ביטול).
            </p>
          ) : !confirming ? (
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              מחיקת אירוע הבדיקה
            </Button>
          ) : (
            <form action={purgeAction} className="space-y-2">
              <input type="hidden" name="eventId" value={eventId} />
              <p className="font-medium text-destructive">
                המחיקה סופית: האירוע, האורחים, הקמפיין ורישומי החיוב יימחקו. עותק של רישומי החיוב נשמר לתיעוד בלבד.
                תפיסות מסגרת פתוחות ב-SUMIT יש לשחרר שם בנפרד.
              </p>
              <label htmlFor={confirmId} className="block text-muted-foreground">
                לאישור, הקלידו את שם האירוע: <span className="font-medium text-foreground">{eventName}</span>
              </label>
              <input
                id={confirmId}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
                className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-2"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={purgePending || typedName.trim() !== eventName.trim()}
                >
                  {purgePending ? 'מוחק…' : 'מחיקה סופית'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setTypedName('');
                  }}
                >
                  ביטול
                </Button>
              </div>
            </form>
          )}
          <FormError message={purgeState?.error} />
        </div>
      )}
    </div>
  );
}
