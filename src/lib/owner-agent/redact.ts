// The owner agent's output filter (plan §3.5): mask anything shaped like a
// phone number in the model's text before it leaves the runner.
//
// It is the LAST wall, not the first. The tools return counts only, so a phone
// number in an answer can come from nowhere but the model itself: an echo of
// the question, or an invention. Either way it must not go back out over
// WhatsApp, and a regex costs no model call (the reason plan §3.5 prefers it
// to Mastra's PIIDetector).
//
// ⚠️ CHARACTER CLASSES BY PROPERTY, NOT BY LITERAL. The separators include
// invisible characters (LRM/RLM and the bidi isolates a Hebrew renderer puts
// around a number, NBSP). Written literally they are unreadable in review and
// can arrive mangled; \p{…} names them. With the `u` flag \p{Nd} is every
// decimal digit, so Arabic-Indic or full-width digits cannot slip a number
// past an ASCII-only \d.
//
//   \p{Nd}  a decimal digit, any script
//   \p{Zs}  a space separator (space, NBSP, narrow NBSP, …)
//   \p{Cf}  a format character (LRM, RLM, LRI…PDI, zero-width joiners)
//   \p{Pd}  a dash (hyphen-minus, en dash, …)
//
// A run starts at an optional '+' and '(' and a digit that does not follow a
// digit, then takes digits joined by either at most three spaces, format
// characters, dashes or parentheses in a row, or one dot (with nothing but
// format characters around it — so a sentence's full stop and the space after
// it never join "…1234. 12 events" into one number). Commas and colons never
// join, so "1,234,567" and "10:30" are not runs. A LETTER before the run does
// not stop it: Hebrew attaches its prefixes straight to a number
// ("ל0501234567"), and an id that really carries nine digits in a row is
// better masked than trusted.
const RUN =
  /(?<!\p{Nd})\+?\(?\p{Nd}(?:(?:[\p{Zs}\p{Cf}\p{Pd}()]{0,3}|\p{Cf}{0,2}\.\p{Cf}{0,2})\p{Nd})*/gu;
const DIGIT = /\p{Nd}/gu;

// A local number is 9–10 digits (0X-XXXXXXX, 05X-XXXXXXX); in international
// form 972 adds three and drops the 0; E.164 allows up to 15. So nine digits
// without a '+'. With a '+' the writer has declared a phone number, and E.164
// numbers of seven or eight digits exist, so seven is enough.
const MIN_DIGITS = 9;
const MIN_DIGITS_WITH_PLUS = 7;

export const REDACTED_PHONE = '[מספר הוסתר]';

function digitCount(s: string): number {
  return s.match(DIGIT)?.length ?? 0;
}

function isPhoneShaped(run: string): boolean {
  return digitCount(run) >= (run.startsWith('+') ? MIN_DIGITS_WITH_PLUS : MIN_DIGITS);
}

// A date and the hour of a time after it ("24.09.2026 10" in
// "24.09.2026 10:30"): the one ordinary thing a run can join into nine digits.
// Exempted only in exactly this shape and only when a colon follows, so a
// phone number that happens to precede a colon is still masked.
const DATE_THEN_HOUR =
  /^(?:\p{Nd}{1,2}[./-]\p{Nd}{1,2}[./-]\p{Nd}{2,4}|\p{Nd}{4}-\p{Nd}{1,2}-\p{Nd}{1,2})[\p{Zs}\p{Cf}]{1,3}\p{Nd}{1,2}$/u;

export function redactPhoneNumbers(text: string): string {
  return text.replace(RUN, (run: string, offset: number, whole: string) => {
    if (whole[offset + run.length] === ':' && DATE_THEN_HOUR.test(run)) return run;
    return isPhoneShaped(run) ? REDACTED_PHONE : run;
  });
}
