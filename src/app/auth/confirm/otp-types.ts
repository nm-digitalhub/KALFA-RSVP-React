// Single source of truth for the email-OTP `type` values /auth/confirm accepts —
// a const tuple → derived union + runtime guard (no hand-written union, no `as`
// cast). `email_change` is included because the app has a real email-change flow
// (settings → requestEmailChangeAction → updateUser({ email })) whose confirmation
// link carries type=email_change.
export const CONFIRM_OTP_TYPES = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email',
  'email_change',
] as const;

export type ConfirmOtpType = (typeof CONFIRM_OTP_TYPES)[number];

export function isConfirmOtpType(value: string): value is ConfirmOtpType {
  return (CONFIRM_OTP_TYPES as readonly string[]).includes(value);
}
