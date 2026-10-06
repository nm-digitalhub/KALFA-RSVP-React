// The two pure decisions of resolving a cancellation request for a fixed-price package: how much goes back, and what
// the admin is told when it could not. No server-only imports, nothing read or written: the money itself moves in
// src/lib/payments/package-refund.ts.

const toCents = (n: number) => Math.round(n * 100);

// The same meaning the post-charge branch of resolveCancellationRequest already gives the two resolutions:
//   full_cancellation → everything the card paid goes back;
//   partial_charge    → `resolutionAmount` STAYS with us (a cancellation fee, or what was already provided) and the rest
//                       goes back. The amount may have started as a percentage; by now it is an amount.
// `paid` is what the card paid before THIS request refunded anything. Throws a plain Hebrew sentence the admin sees.
export function planPackageRefund(input: {
  paid: number;
  resolution: 'full_cancellation' | 'partial_charge';
  resolutionAmount?: number;
}): { kept: number; refund: number } {
  const paid = toCents(input.paid);
  if (input.resolution === 'full_cancellation') return { kept: 0, refund: paid / 100 };
  if (input.resolutionAmount === undefined) throw new Error('יש להזין סכום או אחוז עבור חיוב חלקי');
  const kept = toCents(input.resolutionAmount);
  if (kept > paid) throw new Error('הסכום שנשאר אצלנו גדול ממה ששולם בחבילה');
  return { kept: kept / 100, refund: (paid - kept) / 100 };
}

// What the admin screen says about a package before anything is approved, from three facts the server read: was the
// ledger readable, how much did the card pay (before THIS request refunded anything), is there a card to send it back to.
//   refund            — something was paid and there is a card: an approval refunds it by itself;
//   no_card           — something was paid but there is no card: an approval that has money to return is refused;
//   nothing_to_refund — nothing was paid (or it all went back already): an approval moves no money;
//   resume            — this request already sent money back and a later step failed: an approval finishes the job
//                       without refunding again (a saved card is not needed — the money is already back);
//   unreadable        — the ledger could not be read: nothing is claimed about the money, only a decline can go ahead.
// These mirror the amount and card checks of resolveCancellationRequest. The server also checks that payments are switched
// on and that the payer has a SUMIT customer number; when either fails, an approval is refused before the customer is
// e-mailed even though the screen said "refund" — a refusal, never a promise broken.
export type PackageCancellationState = 'refund' | 'no_card' | 'nothing_to_refund' | 'resume' | 'unreadable';

export function packageCancellationState(input: {
  unreadable: boolean;
  paid: number | null;
  hasCard: boolean;
  refundedForRequest?: number | null;
}): PackageCancellationState {
  if (input.unreadable || input.paid == null || !Number.isFinite(input.paid)) return 'unreadable';
  if ((input.refundedForRequest ?? 0) > 0) return 'resume';
  if (!(input.paid > 0)) return 'nothing_to_refund';
  return input.hasCard ? 'refund' : 'no_card';
}

type RefundResultLike =
  | { status: 'declined' | 'review' | 'in_progress' | 'error' }
  | { status: 'refused'; reason: 'disabled' | 'invalid_amount' | 'no_payment' | 'exceeds_refundable' | 'no_customer' | 'no_card' };

const REFUSALS = {
  disabled: 'התשלומים כבויים או שהגדרות SUMIT חסרות — לא בוצעה פעולה',
  invalid_amount: 'סכום ההחזר אינו תקין — לא בוצעה פעולה',
  no_payment: 'אין בקמפיין תשלום חבילה להחזרה — לא בוצעה פעולה',
  exceeds_refundable: 'סכום ההחזר גדול ממה שנותר להחזרה בקמפיין — לא בוצעה פעולה',
  no_customer: 'לא נמצא מספר לקוח ב-SUMIT עבור המשלם — יש להחזיר ידנית ב-SUMIT. לא בוצעה פעולה',
  no_card: 'אין כרטיס שמור לקמפיין — יש להחזיר ידנית ב-SUMIT. לא בוצעה פעולה',
} as const;

// What the admin reads when a refund did not go through. Fixed sentences only: never the provider's own text, never a
// number someone typed. The request stays open in every one of these cases.
export function packageRefundMessage(result: RefundResultLike): string {
  switch (result.status) {
    case 'refused':
      return REFUSALS[result.reason];
    case 'declined':
      return 'הזיכוי נדחה על ידי חברת האשראי — לא הוחזר כסף. הבקשה נשארה פתוחה ואפשר לנסות שוב או להחזיר ידנית ב-SUMIT';
    case 'review':
      return 'תשובת SUMIT לא חד-משמעית — ייתכן שהכסף כבר הוחזר. בדקו ב-SUMIT ובמסך התשלומים שממתינים להכרעה, ואל תנסו שוב';
    case 'in_progress':
      return 'זיכוי לבקשה הזו כבר בתהליך — המתינו לסיומו';
    case 'error':
      return 'קריאת נתוני התשלום נכשלה — לא בוצעה פעולה';
  }
}
