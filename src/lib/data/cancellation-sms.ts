// SMS sent only when the requester checked the SMS-consent box at request
// time (event_cancellation_requests.sms_consent) — see the resolve flow in
// event-cancellation.ts. A service reply to a request the customer themselves
// initiated (never marketing), same rationale as
// src/lib/callbacks/no-contact-sms.ts — the consent gate here is extra
// carefulness on top of that, per an explicit owner decision (2026-08-21).

export function buildCancellationSmsText(input: {
  fullName: string;
  requestNumber: number;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
}): string {
  const name = input.fullName.trim();
  const ref = `בקשת ביטול #${input.requestNumber}`;
  if (input.resolution === 'full_cancellation') {
    return `שלום ${name}, ${ref} בוטלה במלואה, ללא חיוב. פרטים נשלחו במייל. צוות KALFA`;
  }
  if (input.resolution === 'partial_charge') {
    return `שלום ${name}, ${ref} אושרה עם חיוב חלקי של ₪${input.resolutionAmount}. פרטים נשלחו במייל. צוות KALFA`;
  }
  return `שלום ${name}, ${ref} נדחתה. פרטים נשלחו במייל. צוות KALFA`;
}
