// Pure, framework-free helpers for the signup flow so the security-sensitive
// branches can be unit-tested without invoking Supabase or Server Actions.

// When email confirmation is enabled, Supabase does NOT return an error for an
// already-registered email (it obfuscates existence to prevent enumeration).
// Instead it returns a user object with an empty `identities` array and no
// session, and sends no email. This detects that case.
export function isExistingUserSignup(data: {
  user: { identities?: unknown[] | null } | null;
}): boolean {
  return Boolean(data.user && data.user.identities?.length === 0);
}
