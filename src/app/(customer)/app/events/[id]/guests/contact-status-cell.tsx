'use client';

import { useState, useTransition } from 'react';

import { Constants } from '@/lib/supabase/types';
import { CONTACT_STATUS_LABELS } from './labels';
import { setContactStatusAction } from './guests-actions';
import { recoverFromVersionSkew } from '@/components/use-version-skew-reload';
import type { ContactStatus } from '@/lib/data/guests';

// Inline quick-action: change a guest's contact status straight from the list.
// The new value is validated against the DB enum server-side before it is
// applied (the action re-verifies ownership too).
export function ContactStatusCell({
  eventId,
  guestId,
  value,
}: {
  eventId: string;
  guestId: string;
  value: ContactStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onChange(next: string) {
    setFailed(false);
    startTransition(async () => {
      try {
        await setContactStatusAction(eventId, guestId, next);
      } catch (err) {
        // A stale-deployment action id reloads the tab (shared recovery);
        // anything else keeps the inline "נכשל" indicator.
        if (!recoverFromVersionSkew(err)) setFailed(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`contact-${guestId}`}>
        עדכון סטטוס יצירת קשר
      </label>
      <select
        id={`contact-${guestId}`}
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-8 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs disabled:opacity-50"
      >
        {Constants.public.Enums.contact_status.map((s) => (
          <option key={s} value={s}>
            {CONTACT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          נכשל
        </span>
      ) : null}
    </div>
  );
}
