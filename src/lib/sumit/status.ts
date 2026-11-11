import 'server-only';

// SUMIT's `Status` field arrives in THREE different shapes, and this is the one place
// that says so.
//
// The vendor's own OpenAPI document (openapi/sumit.openapi.json, obtained 2026-09-10,
// 84 operations) declares it as a string enum:
//
//     "Teva.Common.ResponseStatus": "Success (0)" | "BusinessError (1)" | "TechnicalError (2)"
//
// (Two generated clients were produced from that spec on the same day — one
// openapi-typescript, src/lib/sumit/types.generated.ts, which charge.ts imports; one
// orval, openapi/src/lib/sumit/sumit-v1.generated.ts, which nothing imports; which to
// keep is an open question. Nothing here depends on either: the shapes below are read
// from the spec, not generated from it.)
//
// The live API does not restrict itself to that. What came back in practice is one of
// three shapes: a NUMBER (0/1/2), that STRING, or an OBJECT with `IsError`. The J5
// modules (authorize.ts and capture.ts, deleted 2026-10-11 with the pay-per-result
// model) each carried their own copy of this three-way test; this module is now the
// only one. charge.ts, health.ts, probe.ts and mutator.ts read `Status` through it.

export type SumitStatus = 'success' | 'business_error' | 'technical_error' | 'unknown';

/**
 * Classify a SUMIT response envelope's `Status`.
 *
 * `unknown` is a real answer and must never be collapsed into either of the others: an
 * unrecognised status means the outcome is undetermined, which for money is a review,
 * not a decline and certainly not a success.
 */
export function sumitStatus(raw: unknown): SumitStatus {
  if (raw === 0) return 'success';
  if (raw === 1) return 'business_error';
  if (raw === 2) return 'technical_error';

  if (typeof raw === 'string') {
    if (/success|\(0\)/i.test(raw)) return 'success';
    if (/business|\(1\)/i.test(raw)) return 'business_error';
    if (/technical|\(2\)/i.test(raw)) return 'technical_error';
    return 'unknown';
  }

  if (raw && typeof raw === 'object') {
    const isError = (raw as { IsError?: unknown }).IsError;
    if (isError === false) return 'success';
    // `true` says an error happened but not which kind. Business vs technical decides
    // whether a caller may retry, so guessing is worse than admitting we do not know.
    if (isError === true) return 'unknown';
  }

  return 'unknown';
}
