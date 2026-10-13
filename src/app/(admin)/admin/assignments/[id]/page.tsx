import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getStaffAssignmentDetail } from '@/lib/data/admin/coupon-assignments';
import { formatIsraelDate, formatIsraelDateTime } from '@/lib/date';
import { PageHeading, Badge, formatCurrency, formatDateTime } from '../../_components';
import { listBackHref } from '../list-params';
import { VoidAssignmentDialog } from './void-dialog';

export const metadata: Metadata = { title: 'פרטי הטבה' };

// The assignment detail page (admin-panel ב.2, spec §7): a standalone URL, permission
// checked BEFORE existence is revealed; every section from the single detail reader;
// a failed side section renders as "לא זמין" without discarding the rest; links to the
// account and the event appear only when the VIEWER holds their own permissions.

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'בתהליך',
  review: 'בבדיקה',
  succeeded: 'שולם',
  failed: 'נכשל',
};

const BLOCK_REASON_TEXT: Record<string, string> = {
  held_by_payment: 'מוחזקת על ידי תשלום פתוח — אין ביטול עד שהתשלום יוכרע.',
  held_by_review: 'מוחזקת עד סיום בדיקת התשלום.',
  held_by_approved_terms: 'קשורה לתנאים מאושרים — משולמת בתוקפה או פגה.',
  already_ended: 'ההטבה כבר הסתיימה.',
  consumption_exception: 'חריגת מימוש — נדרשת בדיקה מול התשלומים לפני כל פעולה.',
};

function SectionUnavailable() {
  return <p className="text-sm text-muted-foreground">החלק הזה אינו זמין כרגע.</p>;
}

export default async function AdminAssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The gate runs FIRST — an unknown id answers not-found only afterwards (spec §12).
  await requirePlatformPermission('manage_billing');
  const { id } = await params;
  const sp = await searchParams;
  const backHref = listBackHref(sp);
  const notice = typeof sp.notice === 'string' ? sp.notice : '';
  const noticeText =
    notice === 'created'
      ? 'ההטבה הוקצתה.'
      : notice === 'existing'
        ? 'ההטבה כבר הוקצתה. מוצגים הפרטים שנשמרו.'
        : notice === 'duplicate_kept'
          ? 'ההקצאה החדשה זהה להטבה קיימת ולכן לא נשמרה — מוצגת ההטבה שנשארה בתוקף.'
          : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const detail = await getStaffAssignmentDetail(id);
  if (!detail) notFound();

  const [canSeeUsers, canSeeEvents] = await Promise.all([
    hasPlatformPermission('manage_staff'),
    hasPlatformPermission('view_events'),
  ]);

  const a = detail.assignment;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
          <span aria-hidden="true">→</span> חזרה להטבות אישיות
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <PageHeading>{a.offerTitle ?? 'הטבה אישית'}</PageHeading>
          <Badge>{a.display.label}</Badge>
          {a.display.reasonLabel ? (
            <span className="text-sm text-muted-foreground">{a.display.reasonLabel}</span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          הוקצתה {formatDateTime(a.createdAt)} · בתוקף עד {formatIsraelDate(a.expiresAt)}
        </p>
      </div>

      {noticeText ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          {noticeText}
        </p>
      ) : null}

      {detail.warnings.map((w) => (
        <p key={w} role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {w}
        </p>
      ))}

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">מקבל ההטבה</h2>
        {detail.recipient === 'unavailable' ? (
          <p className="mt-2 text-sm text-muted-foreground">פרטי החשבון אינם זמינים כרגע.</p>
        ) : (
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {detail.recipient.name ? (
              <div>
                <dt className="text-muted-foreground">שם</dt>
                <dd>{detail.recipient.name}</dd>
              </div>
            ) : null}
            {detail.recipient.email ? (
              <div>
                <dt className="text-muted-foreground">אימייל</dt>
                <dd dir="ltr">{detail.recipient.email}</dd>
              </div>
            ) : null}
            {detail.recipient.phoneMasked ? (
              <div>
                <dt className="text-muted-foreground">טלפון</dt>
                <dd dir="ltr">{detail.recipient.phoneMasked}</dd>
              </div>
            ) : null}
            {canSeeUsers && detail.recipient.userId ? (
              <div>
                <dt className="text-muted-foreground">חשבון</dt>
                <dd>
                  <Link href={`/admin/users/${detail.recipient.userId}`} className="text-primary hover:underline">
                    לכרטיס המשתמש
                  </Link>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">שיוך לחשבון</dt>
              <dd>
                {detail.recipient.claimed ? 'משויכת לחשבון' : 'טרם שויכה לחשבון'}
                {detail.recipient.claimedAt ? ` · ${formatDateTime(detail.recipient.claimedAt)}` : ''}
              </dd>
            </div>
          </dl>
        )}
        {detail.recipient !== 'unavailable' && !detail.recipient.claimed && detail.source.kind === 'agent' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            ההטבה ממתינה לשיוך לחשבון לאחר אימות מספר הטלפון המתאים.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">תנאים ומקור</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">התנאים שנשמרו</dt>
            <dd>
              {a.kind === 'percent' ? `${a.value}% הנחה` : `${formatCurrency(a.value)} הנחה`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">מקור</dt>
            <dd>
              {detail.source.kind === 'agent'
                ? 'שיחה עם עומר'
                : detail.source.kind === 'staff'
                  ? `הקצאת צוות${detail.source.assignedByName ? ` · ${detail.source.assignedByName}` : ''}`
                  : '—'}
            </dd>
          </div>
          {detail.source.kind === 'agent' && detail.source.objectionReason ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">ההתנגדות שתועדה</dt>
              <dd>{detail.source.objectionReason}</dd>
            </div>
          ) : null}
          {detail.source.kind === 'agent' ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">שיחת המקור</dt>
              <dd>
                {detail.source.callbackRequestId ? (
                  <Link href={`/admin/callbacks?inspect=${detail.source.callbackRequestId}`} className="text-primary hover:underline">
                    בקשת החזרה הקשורה
                  </Link>
                ) : (
                  <span dir="ltr" className="font-mono text-xs">{detail.source.callAttemptId}</span>
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">חבילות ומחירים קפואים</h2>
        {detail.frozenOptions === 'unavailable' ? (
          <SectionUnavailable />
        ) : detail.frozenOptions.length === 0 ? null : (
          <>
            {/* Desktop table; mobile stacked blocks (spec §7). */}
            <table className="mt-2 hidden w-full text-sm sm:table">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-start font-medium">חבילה</th>
                  <th className="py-1 text-start font-medium">מחיר מחירון</th>
                  <th className="py-1 text-start font-medium">הנחה</th>
                  <th className="py-1 text-start font-medium">מחיר סופי</th>
                </tr>
              </thead>
              <tbody>
                {detail.frozenOptions.map((o) => (
                  <tr key={o.packageId} className="border-t border-border">
                    <td className="py-2">
                      {o.packageName}
                      {detail.currentBinding !== null &&
                      detail.currentBinding !== 'unavailable' &&
                      detail.currentBinding.packageId === o.packageId ? (
                        <span className="ms-2 text-xs text-primary">החבילה שנבחרה</span>
                      ) : null}
                    </td>
                    <td className="py-2" dir="ltr">{formatCurrency(o.listPrice)}</td>
                    <td className="py-2" dir="ltr">{formatCurrency(o.discountAmount)}</td>
                    <td className="py-2 font-medium" dir="ltr">{formatCurrency(o.finalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-2 space-y-2 sm:hidden">
              {detail.frozenOptions.map((o) => (
                <li key={o.packageId} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{o.packageName}</p>
                  <p className="mt-1">
                    <span dir="ltr">{formatCurrency(o.finalPrice)}</span>{' '}
                    <span className="text-muted-foreground line-through" dir="ltr">
                      {formatCurrency(o.listPrice)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              שם החבילה הוא תיאור נוכחי; המחירים הם ההבטחה השמורה.
            </p>
          </>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">אירוע, קמפיין ותשלום</h2>
        {detail.currentBinding === 'unavailable' ? (
          <SectionUnavailable />
        ) : detail.currentBinding === null ? (
          <p className="mt-2 text-sm text-muted-foreground">ההטבה אינה משויכת כרגע לאירוע.</p>
        ) : (
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">אירוע</dt>
              <dd>
                {canSeeEvents && detail.currentBinding.eventId ? (
                  <Link href={`/admin/events/${detail.currentBinding.eventId}`} className="text-primary hover:underline">
                    {detail.currentBinding.eventName ?? 'לאירוע'}
                  </Link>
                ) : (
                  detail.currentBinding.eventName ?? '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">החבילה שנבחרה</dt>
              <dd>
                {detail.currentBinding.packageName ?? '—'}
                {detail.currentBinding.roundPrice != null ? (
                  <>
                    {' · '}
                    <span dir="ltr">{formatCurrency(detail.currentBinding.roundPrice)}</span>
                  </>
                ) : null}
                {detail.currentBinding.locked ? ' · תנאים מאושרים' : ''}
              </dd>
            </div>
          </dl>
        )}

        <h3 className="mt-4 text-xs font-semibold text-muted-foreground">ניסיונות תשלום של ההטבה</h3>
        {detail.paymentAttempts === 'unavailable' ? (
          <SectionUnavailable />
        ) : detail.paymentAttempts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">טרם נפתח תשלום להטבה הזאת.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {detail.paymentAttempts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Badge>{PAYMENT_LABELS[p.outcome] ?? 'לא ניתן לקבוע'}</Badge>
                <span dir="ltr">{formatCurrency(p.amount)}</span>
                <span className="text-muted-foreground">
                  {formatIsraelDateTime(p.at)}
                  {p.roundVersion != null ? ` · סבב ${p.roundVersion}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">היסטוריית פעולות</h2>
        {detail.history === 'unavailable' ? (
          <p className="mt-2 text-sm text-muted-foreground">טעינת ההיסטוריה נכשלה — אין לראות בכך היעדר פעולות.</p>
        ) : detail.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">אין פעולות נוספות מתועדות.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm">
            {detail.history.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <span className="tabular-nums text-muted-foreground">{formatIsraelDateTime(e.at)}</span>
                <span className="font-medium">{e.actionLabel}</span>
                {!e.known ? (
                  <code className="text-xs text-muted-foreground">{e.rawAction}</code>
                ) : null}
                <span className="text-muted-foreground">· {e.actorLabel}</span>
                {e.reason ? <span className="text-muted-foreground">· {e.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">פעולות</h2>
        {detail.allowedActions.canVoid ? (
          <div className="mt-2 space-y-2">
            <VoidAssignmentDialog
              assignmentId={a.id}
              customerLabel={
                detail.recipient !== 'unavailable'
                  ? (detail.recipient.name ?? detail.recipient.email ?? detail.recipient.phoneMasked ?? '')
                  : ''
              }
              offerTitle={a.offerTitle ?? 'הטבה אישית'}
            />
            <p className="text-xs text-muted-foreground">הביטול יאומת שוב בשרת תחת נעילות.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {BLOCK_REASON_TEXT[detail.allowedActions.blockReason ?? ''] ?? 'אין פעולה זמינה.'}
          </p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        מזהה הקצאה: <code dir="ltr" className="select-all">{a.id}</code>
      </p>
    </div>
  );
}
