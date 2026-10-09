// SMS sent only when the requester checked the SMS-consent box at request
// time (event_cancellation_requests.sms_consent) — see the resolve flow in
// event-cancellation.ts. A service reply to a request the customer themselves
// initiated (never marketing), same rationale as
// src/lib/callbacks/no-contact-sms.ts — the consent gate here is extra
// carefulness on top of that, per an explicit owner decision.

//
// `refundedAmount` is money that ALREADY went back to the card (a fixed-price package: the SMS follows the confirmed
// refund, like the e-mail). With it, `resolutionAmount` is the fee that stayed and the SMS says both — never "ללא חיוב"
// to a customer who paid, and never the refunded sum as if it were a charge (both happened before 9.10.2026). Without it
// the wording is the one for a request that returned nothing.
export function buildCancellationSmsText(input: {
  fullName: string;
  requestNumber: number;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
  refundedAmount?: number;
}): string {
  const name = input.fullName.trim();
  const ref = `בקשת ביטול #${input.requestNumber}`;
  if (input.resolution === 'full_cancellation') {
    return input.refundedAmount
      ? `שלום ${name}, ${ref} בוטלה במלואה, ו-₪${input.refundedAmount} ששילמת הוחזרו לכרטיס. פרטים נשלחו במייל. צוות KALFA`
      : `שלום ${name}, ${ref} בוטלה במלואה, ללא חיוב. פרטים נשלחו במייל. צוות KALFA`;
  }
  if (input.resolution === 'partial_charge') {
    return input.refundedAmount
      ? `שלום ${name}, ${ref} אושרה בניכוי דמי ביטול של ₪${input.resolutionAmount}, ו-₪${input.refundedAmount} הוחזרו לכרטיס. פרטים נשלחו במייל. צוות KALFA`
      : `שלום ${name}, ${ref} אושרה עם חיוב חלקי של ₪${input.resolutionAmount}. פרטים נשלחו במייל. צוות KALFA`;
  }
  return `שלום ${name}, ${ref} נדחתה. פרטים נשלחו במייל. צוות KALFA`;
}
