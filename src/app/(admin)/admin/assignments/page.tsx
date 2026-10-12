import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformPermission } from '@/lib/auth/dal';

import { listStaffAssignments, type StaffAssignmentListRow } from '@/lib/data/admin/coupon-assignments';
import { PageHeading, Badge, formatCurrency, formatDateTime } from '../_components';
import { VoidAssignmentForm } from './void-assignment-form';

export const metadata: Metadata = { title: 'הטבות אישיות' };

// Staff: every personal benefit — source, target, frozen options, bound campaign, and that
// campaign's package-payment outcome (task 7.3, mockup ui/Assignments.dc.html). A held
// assignment (pending payment / review / approved terms) shows WHY instead of a void button,
// and the D10 guard banner says plainly whether any succeeded payment left its assignment
// unconsumed.

const STATE_LABEL: Record<StaffAssignmentListRow['state'], string> = {
  assigned: 'ממתינה לשימוש',
  bound: 'קשורה לאירוע',
  consumed: 'מומשה',
  void: 'בוטלה או פגה',
};

const PAYMENT_LABEL: Record<StaffAssignmentListRow['payment'], string | null> = {
  none: null,
  pending: 'בהמתנה',
  review: 'בבדיקה',
  succeeded: 'שולם',
};

const HELD_LABEL: Record<NonNullable<StaffAssignmentListRow['heldBy']>, string> = {
  payment: 'מוחזקת על ידי תשלום פתוח',
  review: 'מוחזקת עד סיום הבדיקה',
  approved_terms: 'קשורה לתנאים מאושרים',
};

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  // Optimistic gate; the real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const { state: stateFilter } = await searchParams;
  const { rows, guardCount } = await listStaffAssignments();

  const filters: { key: string | undefined; label: string }[] = [
    { key: undefined, label: 'הכול' },
    { key: 'assigned', label: STATE_LABEL.assigned },
    { key: 'bound', label: STATE_LABEL.bound },
    { key: 'consumed', label: STATE_LABEL.consumed },
    { key: 'void', label: STATE_LABEL.void },
  ];
  const visible = stateFilter ? rows.filter((r) => r.state === stateFilter) : rows;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <PageHeading>הטבות אישיות</PageHeading>
          <p className="text-sm text-muted-foreground">
            הטבות שהוקצו ללקוחות בשיחה עם עומר או על ידי הצוות. כל הטבה משמשת לרכישה אחת.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/offers"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            הגדרת הצעות
          </Link>
          <Link
            href="/admin/assignments/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            הקצאת הטבה
          </Link>
        </div>
      </div>

      {guardCount === 0 ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          אין תשלום שהצליח בלי שההטבה שלו סומנה כמומשה.
        </p>
      ) : (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {guardCount} תשלומים הצליחו בלי שההטבה שלהם סומנה כמומשה — יש לבדוק מול התשלומים.
        </p>
      )}

      <nav aria-label="סינון לפי מצב" className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (stateFilter ?? undefined) === f.key;
          return (
            <Link
              key={f.label}
              href={f.key ? `/admin/assignments?state=${f.key}` : '/admin/assignments'}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'inline-flex h-7 items-center rounded-lg border border-primary bg-primary/5 px-2.5 text-xs font-medium text-primary'
                  : 'inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-xs font-medium'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          אין הטבות במצב הזה.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">מועד</th>
                <th className="px-4 py-3 text-start font-medium">מקבל ההטבה</th>
                <th className="px-4 py-3 text-start font-medium">מקור</th>
                <th className="px-4 py-3 text-start font-medium">חבילות ומחירים</th>
                <th className="px-4 py-3 text-start font-medium">מצב</th>
                <th className="px-4 py-3 text-start font-medium">אירוע וחבילה</th>
                <th className="px-4 py-3 text-start font-medium">תשלום</th>
                <th className="px-4 py-3 text-start font-medium">
                  <span className="sr-only">פעולות</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 tabular-nums">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    {row.target.userEmail ? (
                      <span>{row.target.userEmail}</span>
                    ) : (
                      <span dir="ltr">{row.target.phoneMasked ?? '—'}</span>
                    )}
                    {!row.target.claimed ? (
                      <div className="text-xs text-muted-foreground">טרם נתבעה</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{row.source.kind === 'agent' ? 'שיחה עם עומר' : 'צוות'}</td>
                  <td className="px-4 py-3 leading-relaxed">
                    {row.options.map((o) => (
                      <div key={`${row.id}-${o.packageName}`}>
                        {o.packageName} · <span dir="ltr">{formatCurrency(o.finalPrice)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{STATE_LABEL[row.state]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {row.bound ? (
                      <>
                        <span className="font-medium">{row.bound.eventName ?? '—'}</span>
                        {row.bound.packageName ? (
                          <div className="text-xs text-muted-foreground">
                            {row.bound.packageName}
                            {row.bound.finalPrice != null ? (
                              <>
                                {' · '}
                                <span dir="ltr">{formatCurrency(row.bound.finalPrice)}</span>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {PAYMENT_LABEL[row.payment] ? (
                      <>
                        <Badge>{PAYMENT_LABEL[row.payment]}</Badge>
                        {row.heldBy === 'payment' || row.heldBy === 'review' ? (
                          <div className="mt-1 text-xs text-muted-foreground">{HELD_LABEL[row.heldBy]}</div>
                        ) : null}
                        {row.guard ? (
                          <div className="mt-1 text-xs text-destructive">שולם אך ההטבה לא סומנה כמומשה</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.state === 'assigned' || row.state === 'bound' ? (
                      <VoidAssignmentForm id={row.id} heldReason={row.heldBy ? HELD_LABEL[row.heldBy] : null} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
