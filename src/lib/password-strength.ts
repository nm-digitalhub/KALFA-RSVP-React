// Live signup password-requirements checklist. This mirrors newPasswordField
// (src/lib/validation/schemas.ts) exactly — which itself mirrors Supabase
// Auth's live project config (password_min_length + password_required_characters,
// verified via the Management API) — so what the user sees checked off is
// always what the server will actually accept, never a separate heuristic
// score (an earlier zxcvbn-ts entropy meter could show "strong" for a
// password Supabase would reject outright, e.g. a long all-lowercase
// passphrase, and vice versa for a short-but-complex one).

import { PASSWORD_SPECIAL_CHARS } from '@/lib/validation/schemas';

export type PasswordRequirement = {
  id: string;
  label: string;
  test: (password: string) => boolean;
};

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  { id: 'length', label: 'לפחות 8 תווים', test: (v) => v.length >= 8 },
  { id: 'lower', label: 'אות קטנה (a-z)', test: (v) => /[a-z]/.test(v) },
  { id: 'upper', label: 'אות גדולה (A-Z)', test: (v) => /[A-Z]/.test(v) },
  { id: 'digit', label: 'ספרה', test: (v) => /[0-9]/.test(v) },
  {
    id: 'special',
    label: 'תו מיוחד (למשל !@#$%)',
    test: (v) => [...v].some((c) => PASSWORD_SPECIAL_CHARS.has(c)),
  },
];
