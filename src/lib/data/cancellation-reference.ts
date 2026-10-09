// The reference a customer and staff see for a cancellation request: "CX-" and the request's random code
// (event_cancellation_requests.request_code, set by the database — migration 20261009194139). It replaces the running
// request_number, which told anyone how many requests exist. One place, so the screens, the e-mail and the SMS agree.
export const CANCELLATION_REFERENCE_PREFIX = 'CX-';

export function cancellationReference(requestCode: string): string {
  return `${CANCELLATION_REFERENCE_PREFIX}${requestCode}`;
}
