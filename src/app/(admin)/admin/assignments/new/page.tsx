import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  listAssignableOffers,
  lookupStaffAssignmentRecipient,
  type RecipientLookup,
} from '@/lib/data/admin/coupon-assignments';
import { formatIsraelDate } from '@/lib/date';
import { PageHeading, formatCurrency } from '../../_components';
import { AssignForm } from './assign-form';

export const metadata: Metadata = { title: 'הקצאת הטבה' };

// Staff assign (admin-panel ג.1–ג.3, spec §8): a two-step flow. Step 1 resolves the
// account on the SERVER from an exact email (found / not-found / lookup-failed are three
// distinct answers) and shows the found account — with its active benefits — for the
// staff member to confirm. Only then does step 2 offer the EXPLICIT offer choice and the
// server-computed preview. Nothing can be assigned before an account was resolved.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function AdminAssignNewPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  // Optimistic gate; the real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  const { email: rawEmail } = await searchParams;
  const email = (rawEmail ?? '').trim();
  const emailValid = email !== '' && EMAIL_SHAPE.test(email);

  let lookup: RecipientLookup | null = null;
  let offers: Awaited<ReturnType<typeof listAssignableOffers>> = [];
  if (emailValid) {
    [lookup, offers] = await Promise.all([
      lookupStaffAssignmentRecipient(email),
      listAssignableOffers({ currency: formatCurrency, date: formatIsraelDate }),
    ]);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>הקצאת הטבה</PageHeading>
        <Link href="/admin/assignments" className="text-sm text-muted-foreground hover:underline">
          <span aria-hidden="true">→</span> חזרה להטבות אישיות
        </Link>
      </div>

      <section className="max-w-xl space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">חשבון הלקוח</h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <label htmlFor="assign-email" className="block text-xs font-medium text-muted-foreground">
              אימייל מדויק
            </label>
            <input
              id="assign-email"
              name="email"
              type="email"
              required
              dir="ltr"
              defaultValue={email}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            איתור חשבון
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          ההטבה ניתנת לחשבון קיים בלבד, בלי צורך באימות טלפון.
        </p>

        {email !== '' && !emailValid ? (
          <p role="alert" className="text-sm text-destructive">
            כתובת אימייל לא תקינה.
          </p>
        ) : null}

        {lookup?.status === 'not_found' ? (
          <p role="alert" className="text-sm text-destructive">
            לא נמצא חשבון עם האימייל הזה. ניתן להקצות הטבה לחשבון קיים בלבד.
          </p>
        ) : null}

        {lookup?.status === 'unavailable' ? (
          <p role="alert" className="text-sm text-destructive">
            חיפוש החשבון נכשל כרגע — זו תקלה בחיפוש, לא חשבון חסר. נסו שוב.
          </p>
        ) : null}

        {lookup?.status === 'found' ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{lookup.account.name ?? 'חשבון ללא שם'}</p>
            <p dir="ltr" className="text-muted-foreground">{lookup.account.email}</p>
            {lookup.activeBenefits.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                הטבות פעילות קיימות:{' '}
                {lookup.activeBenefits
                  .map((b) => `${b.summary} (עד ${formatIsraelDate(b.expiresAt)})`)
                  .join(' · ')}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">אין הטבות פעילות לחשבון.</p>
            )}
          </div>
        ) : null}
      </section>

      {lookup?.status === 'found' ? (
        offers.length === 0 ? (
          <p className="max-w-xl rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            אין הצעה פעילה שמותרת להקצאת צוות.{' '}
            <Link href="/admin/offers" className="text-primary hover:underline">
              הגדרת הצעות
            </Link>
          </p>
        ) : (
          <section className="max-w-xl space-y-3 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold">בחירת הצעה</h2>
            <AssignForm email={lookup.account.email} offers={offers} idempotencyKey={randomUUID()} />
          </section>
        )
      ) : null}
    </div>
  );
}
