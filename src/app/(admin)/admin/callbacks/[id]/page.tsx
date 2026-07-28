import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getCallbackRequest } from '@/lib/data/admin/callbacks';
import { callbackStatusLabel } from '@/lib/data/admin/labels';
import { PageHeading, formatDateTime } from '../../_components';
import { CallbackStatusForm } from '../callback-status-form';

// One callback request.
//
// This is the target of the deep link the scheduler writes into the calendar
// item's body, so it is read on a phone, in the seconds before a call — not
// browsed. Everything needed to make that call is above the fold and the phone
// number is a real tel: link, because the whole point is to tap it and dial.

export default async function CallbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Optimistic gate; the real enforcement lives per-function in the DAL.
  await requirePlatformPermission('view_customer_data');
  const { id } = await params;
  const callback = await getCallbackRequest(id);

  // A calendar item outlives the row it points at — a deleted request must give
  // a proper 404, not a server error.
  if (!callback) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/callbacks"
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          ← כל בקשות החזרה
        </Link>
        <PageHeading>{callback.full_name}</PageHeading>
      </div>

      {/* The call itself. Big, tappable, first. */}
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs font-medium text-muted-foreground">טלפון</p>
        <a
          href={`tel:${callback.phone}`}
          dir="ltr"
          className="mt-1 inline-block text-2xl font-semibold text-primary underline underline-offset-4"
        >
          {callback.phone}
        </a>
        {callback.attempt_count > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            ניסיונות קודמים: {callback.attempt_count}
          </p>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">נושא</dt>
          <dd className="mt-1 text-sm">{callback.topic || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">סטטוס</dt>
          <dd className="mt-1 text-sm">{callbackStatusLabel(callback.status)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">התקבלה</dt>
          <dd className="mt-1 text-sm">{formatDateTime(callback.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">מועד מבוקש</dt>
          <dd className="mt-1 text-sm">
            {callback.requested_at ? formatDateTime(callback.requested_at) : 'ללא העדפה'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">שובץ ביומן</dt>
          <dd className="mt-1 text-sm">
            {callback.scheduled_at ? (
              formatDateTime(callback.scheduled_at)
            ) : (
              <span className="text-muted-foreground">טרם שובץ</span>
            )}
          </dd>
        </div>
      </dl>

      {callback.note && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">מה שנכתב בפנייה</p>
          {/* wrap-anywhere: a long unbreakable token would otherwise widen the
              admin shell — same latent overflow as the list and /admin/fleet. */}
          <p className="mt-1 wrap-anywhere whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {callback.note}
          </p>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">עדכון סטטוס</p>
        <CallbackStatusForm id={callback.id} currentStatus={callback.status} />
      </div>
    </div>
  );
}
