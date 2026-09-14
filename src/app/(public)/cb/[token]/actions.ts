'use server';

import { headers } from 'next/headers';

import { submitCallbackIntake } from '@/lib/data/callback-intake';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { callbackIntakeSchema } from '@/lib/validation/inquiries';

export type IntakeFormState = {
  error?: string;
  notice?: string;
  fieldErrors?: Partial<Record<'full_name' | 'topic' | 'note', string[]>>;
} | null;

const RATE = { limit: 10, windowMs: 10 * 60_000 };

// One generic refusal for every "no". Which token exists, which has expired and
// which was already used are all the same sentence here — the difference is
// exactly what a prober would be probing for.
const UNAVAILABLE = 'הקישור הזה כבר לא פעיל. אפשר להשאיר פרטים מחדש בעמוד יצירת הקשר.';
const GENERIC = 'שליחת הפרטים נכשלה. אפשר לנסות שוב.';

/**
 * The token arrives BOUND, not as a form field.
 *
 * Next's forms guide is explicit that a hidden input "will be part of the
 * rendered HTML and will not be encoded", while a bound argument is encrypted
 * with NEXT_SERVER_ACTIONS_ENCRYPTION_KEY and fixed server-side at render time.
 * With a hidden input, anyone could edit the value in devtools and aim the
 * write at a different row; bound, there is nothing to edit.
 *
 * Every gate that matters — expiry, single use, terminal status, and whether
 * the slot is already fixed — lives inside submit_callback_intake, in the same
 * statement as the UPDATE. Nothing here is a security boundary: the framework's
 * own guidance is that render-time gating is not one, because the POST can be
 * sent without the UI.
 */
export async function submitIntakeAction(
  token: string,
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  // Keyed on a FINGERPRINT, never the raw bearer token — raw tokens in
  // in-memory keys can surface in diagnostics (same pattern as /r and /ty).
  if (!rateLimit(`cb-intake:${tokenFingerprint(token)}:${ip}`, RATE).allowed) {
    return { error: 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.' };
  }

  // Honeypot: a bot that fills the hidden field gets the same success it would
  // have got anyway, and nothing is written.
  if (String(formData.get('company') ?? '').trim()) {
    return { notice: 'הפרטים נשמרו. נחזור אליך בהקדם.' };
  }

  const parsed = callbackIntakeSchema.safeParse({
    full_name: formData.get('full_name'),
    topic: formData.get('topic'),
    note: String(formData.get('note') ?? '').trim() || undefined,
    // An unchecked radio group posts nothing; the schema's default makes that
    // 'asap', which is what this form means when nobody chooses.
    preference: String(formData.get('preference') ?? '').trim() || undefined,
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  let outcome;
  try {
    outcome = await submitCallbackIntake(token, parsed.data);
  } catch {
    return { error: GENERIC };
  }

  if (!outcome.ok) {
    return { error: outcome.reason === 'unavailable' ? UNAVAILABLE : GENERIC };
  }

  return {
    notice: outcome.scheduleLocked
      ? 'הפרטים נשמרו, תודה. המועד שכבר נקבע לא השתנה — נחזור אליך אז.'
      : 'הפרטים נשמרו, תודה. נחזור אליך בהקדם.',
  };
}
