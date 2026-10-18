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
//
// `documentUrl` is the refund's credit document (owner, 18.10.2026: the SMS links to the receipt for the refund), as the ledger
// recorded it from the clearing company's answer. It is added only with a refund, only when it is a plain https address, and on
// a line of its own after its label: a link inside a Hebrew sentence is reordered on the screen, and a phone may take the
// punctuation after it as part of the link. Without it the text is exactly the one before.
import { cancellationReference } from './cancellation-reference';

const isPlainHttps = (url: string): boolean => /^https:\/\/[^\s]+$/.test(url);

export function buildCancellationSmsText(input: {
  fullName: string;
  requestCode: string;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
  refundedAmount?: number;
  documentUrl?: string | null;
}): string {
  const name = input.fullName.trim();
  const ref = `בקשת ביטול ${cancellationReference(input.requestCode)}`;
  const url = input.documentUrl?.trim() ?? '';
  // Between the refund sentence and the closing line: the receipt's link on its own line, or the single space of the old text.
  const receipt = url !== '' && isPlainHttps(url) ? `\nהקבלה על הזיכוי:\n${url}\n` : ' ';
  if (input.resolution === 'full_cancellation') {
    return input.refundedAmount
      ? `שלום ${name}, ${ref} בוטלה במלואה, ו-₪${input.refundedAmount} ששילמת הוחזרו לכרטיס.${receipt}פרטים נשלחו במייל. צוות KALFA`
      : `שלום ${name}, ${ref} בוטלה במלואה, ללא חיוב. פרטים נשלחו במייל. צוות KALFA`;
  }
  if (input.resolution === 'partial_charge') {
    return input.refundedAmount
      ? `שלום ${name}, ${ref} אושרה בניכוי דמי ביטול של ₪${input.resolutionAmount}, ו-₪${input.refundedAmount} הוחזרו לכרטיס.${receipt}פרטים נשלחו במייל. צוות KALFA`
      : `שלום ${name}, ${ref} אושרה עם חיוב חלקי של ₪${input.resolutionAmount}. פרטים נשלחו במייל. צוות KALFA`;
  }
  return `שלום ${name}, ${ref} נדחתה. פרטים נשלחו במייל. צוות KALFA`;
}
