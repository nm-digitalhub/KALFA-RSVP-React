'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { FormError } from '@/components/forms';

// Per-row reconciliation control for orders the payment flow could not resolve
// on its own. Rendered only by the server page for actionable rows, so the
// "stuck" decision (processing older than 10 minutes) is computed once on the
// server and baked into the HTML — no client-side clock, no hydration mismatch.
//
//   action="auto"  — `payment_review` row → PATH A: the server queries SUMIT by
//                     sumit_document_id and marks paid/failed when conclusive.
//   action="reset" — a `processing` row stuck >10 min → reset to `failed` so the
//                     user can retry normally (the atomic pay lock accepts failed).
//
// POSTs JSON to /api/admin/orders/[id]/reconcile (same-origin cookie auth) and
// refreshes the route on success. The route returns 200 { reconciled: false }
// for legitimate no-ops (e.g. inconclusive SUMIT lookup), which we surface as an
// inline notice rather than a silent click.

const LABELS = {
  auto: { idle: 'בירור אוטומטי', busy: 'מברר…' },
  reset: { idle: 'אפס לנכשל', busy: 'מאפס…' },
} as const;

type ReconcileResponse = {
  reconciled?: boolean;
  outcome?: string;
  error?: string;
};

export function ReconcileButton({
  orderId,
  action,
}: {
  orderId: string;
  action: 'auto' | 'reset';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  async function handleClick() {
    setPending(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      let body: ReconcileResponse = {};
      try {
        body = (await res.json()) as ReconcileResponse;
      } catch {
        body = {};
      }

      if (!res.ok) {
        // The route returns curated, privacy-safe Hebrew error strings.
        setError(body.error ?? 'הבירור נכשל. נסו שוב מאוחר יותר.');
        return;
      }

      if (body.reconciled) {
        // Status changed — refresh so the row reflects its new state and this
        // button disappears.
        router.refresh();
        return;
      }

      // Legitimate no-op: nothing to update programmatically. Surface it so the
      // admin knows manual reconciliation in SUMIT is required.
      setNotice('לא נמצא עדכון אוטומטי — נדרש בירור ידני.');
    } catch {
      setError('שגיאת תקשורת. נסו שוב מאוחר יותר.');
    } finally {
      setPending(false);
    }
  }

  const text = LABELS[action];

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-border px-3 py-1 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? text.busy : text.idle}
      </button>
      <FormError message={error} />
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}
