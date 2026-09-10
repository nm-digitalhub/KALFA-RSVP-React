import 'server-only';

// SUMIT's `Status` field arrives in THREE different shapes, and this is the one place
// that says so.
//
// The vendor's own OpenAPI document (openapi/sumit.openapi.json, obtained 2026-09-10,
// 84 operations) declares it as a string enum:
//
//     "Teva.Common.ResponseStatus": "Success (0)" | "BusinessError (1)" | "TechnicalError (2)"
//
// (Two generated clients were produced from that spec on the same day and neither is
// committed or imported yet — one openapi-typescript, one orval; which to keep is an
// open question. Nothing here depends on either: the shapes below are read from the
// spec, not generated from it.)
//
// The live API does not restrict itself to that. authorize.ts and capture.ts each
// already carried the same three-way test, written from what came back in practice:
// a NUMBER (0/1/2), that STRING, or an OBJECT with `IsError`. Three copies of one
// rule is how the fourth copy ends up subtly different, so the rule lives here.
//
// ⚠️ NOT YET WIRED INTO THE BILLING PATHS. authorize.ts and capture.ts keep their own
// inline copies for now: they are live money code with tests around them, and swapping
// their decline logic is a change that deserves its own review rather than riding along
// with a settings page. Their copies and this module must agree — if you change one,
// change all of them, and the comment in each points here.
//
// Also unwired, for a different reason: charge.ts:94 checks ONLY `Status?.IsError`, so
// the string form the vendor now documents would read as "not a decline" there. It is
// dead code — `chargeSumit` has no caller; only its error classes are imported — which
// is why it is a note rather than a fix.

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
