'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { FormError, SubmitButton } from '@/components/forms';
import { formatAmount } from '@/lib/format';
import type { FormState } from '@/lib/validation/result';

// The acceptance flow's banner (task 5.5/7.1, ש5/D21 — mocked in ui/States.dc.html): the owner of
// an APPROVED, unpaid campaign holds a benefit that prices its package lower. Accepting opens a
// fresh approval at the discounted price (the action supersedes and routes back to the terms);
// not accepting leaves the already-approved price payable — the link continues straight to
// payment. The customer decides; nothing happens by itself.
export function BenefitAcceptBanner({
  action,
  approvedPrice,
  benefitPrice,
  paymentHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  approvedPrice: number;
  benefitPrice: number;
  paymentHref: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <div className="space-y-2.5 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="text-[15px] font-semibold text-primary">
        יש לכם הטבה אישית: <span dir="ltr">{formatAmount(benefitPrice)}</span> במקום{' '}
        <span dir="ltr">{formatAmount(approvedPrice)}</span>
      </p>
      <p className="text-[13px] leading-relaxed">
        קבלת ההטבה תפתח אישור מחודש של התנאים במחיר המוזל. אם לא תקבלו אותה — התנאים שכבר אישרתם (
        <span dir="ltr">{formatAmount(approvedPrice)}</span>) נשארים בתוקף לתשלום.
      </p>
      <FormError message={state?.error} />
      <div className="flex flex-wrap items-center gap-3">
        <form action={formAction}>
          <SubmitButton className="h-9 w-auto px-4 text-sm">קבלת ההטבה ואישור תנאים מעודכנים</SubmitButton>
        </form>
        <Link href={paymentHref} className="text-[13px] font-medium underline underline-offset-2">
          להמשיך לתשלום במחיר המאושר
        </Link>
      </div>
    </div>
  );
}
