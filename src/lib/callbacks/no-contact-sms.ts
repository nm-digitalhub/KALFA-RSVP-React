// The one-time closing SMS a customer receives after three consecutive
// no-answer call attempts (see applyCallOutcome in callback-scheduling.ts).
//
// Pure: no DB, no SMS transport. Owner-approved wording 2026-08-20 — a
// service reply to a request the customer themselves initiated (never
// marketing), so it carries no marketing-consent gate.

export function buildNoContactSmsText(input: { fullName: string; formUrl: string }): string {
  return (
    `שלום ${input.fullName.trim()}, ניסינו ליצור איתך קשר שלוש פעמים בעקבות בקשתך לשיחה טלפונית, ` +
    `אך לא הצלחנו להשיגך. בקשתך נסגרה בשלב זה. אם עדיין תרצה שנחזור אליך, ניתן להגיש בקשה חדשה כאן: ` +
    `${input.formUrl}. צוות KALFA`
  );
}
