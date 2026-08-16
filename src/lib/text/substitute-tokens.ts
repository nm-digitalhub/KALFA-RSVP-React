// The ONE `{{token}}` substitution mechanism in the app. Extracted from
// src/lib/agreements/template.ts's `substituteTokens` (which pre-dates this
// module and used to inline the same regex) so the agreement template and
// every other `{{token}}`-bearing surface (the FAQ page, src/lib/faq/tokens.ts)
// share exactly one implementation instead of two that could quietly drift
// apart in escaping or regex behavior.
//
// Literal replace, no eval. A token NOT present as a key in `values` — a typo,
// or a name this particular caller doesn't resolve — is left as the original
// `{{...}}` text: visible in review/preview, never silently dropped. Callers
// own their own value escaping (see template.ts's `escapedExtra`) — this
// function does none, by design, since not every caller's values need
// HTML-escaping (a Hebrew FAQ answer plain-text paragraph doesn't).
export function substituteTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}
