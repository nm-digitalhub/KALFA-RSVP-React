// The SMS a caller gets when they rang us and nobody was free to answer.
//
// Pure: no DB, no SMS transport — same minimalism as buildNoContactSmsText.
//
// Its whole job is to turn a row we know almost nothing about into a row we
// can actually work. A missed call gives us a phone number and nothing else,
// so `full_name` is stored as a stand-in and `topic` as a system label — and
// the confirmation agent later reads both aloud. MEASURED 2026-09-14: one
// caller was asked "מדבר עם מתקשר?"; another asked four times what the call
// was about and was told an invented "נושא העבודה".
//
// LEGAL: owner-approved 2026-09-14 — a service reply to contact the person
// themselves initiated (they dialled us and we did not answer), not a דבר
// פרסומת, so it carries no marketing-consent gate. Same ruling that already
// covers buildNoContactSmsText; the fact patterns differ (that one follows
// three failed attempts to someone who explicitly asked for a call, this one
// follows the first unanswered ring) and both were put to the owner as such.
// ⚠️ The moment this message sells anything, that ruling stops applying —
// which is what the "not a marketing message" test pins.
//
// Hebrew SMS is sent as UCS-2 — 70 characters per segment, 67 when a message
// splits — so every word here costs money on every missed call. Kept to two
// segments, which `intakeSmsSegments` pins.

/** No name is used: at this point the stand-in is all we have, and it is not a name. */
export function buildIntakeSmsText(input: { formUrl: string }): string {
  return (
    `התקשרת ל-KALFA ולא הצלחנו לענות. ` +
    `כדי שנחזור אליך מוכנים, כמה פרטים כאן: ${input.formUrl}`
  );
}

/**
 * How many UCS-2 segments a Hebrew SMS of this length occupies.
 *
 * 70 for a single segment; a longer message is split and each part carries a
 * 6-byte concatenation header, leaving 67. Used by the test to keep the
 * wording honest about its own cost rather than by the sender.
 */
export function intakeSmsSegments(text: string): number {
  // Code units, not code points: UCS-2 bills a surrogate pair as two.
  const units = text.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
