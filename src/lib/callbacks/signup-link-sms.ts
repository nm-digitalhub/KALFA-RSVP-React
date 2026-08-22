// The sales-closing agent's send_signup_link SMS fallback text. Pure: no DB,
// no SMS transport — same minimalism as no-contact-sms.ts's buildNoContactSmsText.
// Service reply to a request the customer themselves initiated (the whole
// callback_requests row exists because they asked to be called back about
// buying), never marketing — no consent gate, same reasoning as
// no-contact-sms.ts.

export function buildSignupLinkSmsText(input: { fullName: string; signupUrl: string }): string {
  return (
    `שלום ${input.fullName.trim()}, כפי שסוכם בשיחה, הנה קישור ההרשמה לקלפה: ` +
    `${input.signupUrl}. צוות KALFA`
  );
}
