'use client';

import { useActionState, useState } from 'react';

import { FormError, FormNotice } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

type BoundAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

// Owner-facing RSVP link controls on the guest detail page. The absolute link
// is built server-side (see getAppUrl) and passed in; this component only
// copies it and submits the revoke/regenerate actions (which re-verify
// ownership and revalidate this page, refreshing `url`/`revokedAt`).
export function RsvpLink({
  url,
  revokedAt,
  revokeAction,
  regenerateAction,
}: {
  url: string;
  revokedAt: string | null;
  revokeAction: BoundAction;
  regenerateAction: BoundAction;
}) {
  const [copied, setCopied] = useState(false);
  const [revokeState, revoke] = useActionState(revokeAction, null);
  const [regenState, regenerate] = useActionState(regenerateAction, null);
  const revoked = revokedAt != null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-input p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">קישור אישור הגעה</h2>
        {revoked ? (
          <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
            מבוטל
          </span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          dir="ltr"
          aria-label="קישור אישור הגעה"
          className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={copy}
          disabled={revoked || !url}
          className="shrink-0 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {copied ? 'הועתק' : 'העתקה'}
        </button>
      </div>

      {revoked ? (
        <p className="text-xs text-muted-foreground">
          הקישור בוטל ואינו פעיל. ניתן ליצור קישור חדש שיחליף אותו.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          שלחו את הקישור למוזמן כדי שיאשר הגעה. יצירת קישור חדש מבטלת את הקודם.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!revoked ? (
          <form action={revoke}>
            <button
              type="submit"
              className="rounded-md border border-input px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              ביטול הקישור
            </button>
          </form>
        ) : null}
        <form action={regenerate}>
          <button
            type="submit"
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
          >
            יצירת קישור חדש
          </button>
        </form>
      </div>

      <FormError message={revokeState?.error ?? regenState?.error} />
      <FormNotice message={revokeState?.notice ?? regenState?.notice} />
    </section>
  );
}
