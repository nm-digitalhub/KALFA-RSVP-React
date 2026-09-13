import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

// Input shapes for the Meta phone-number lifecycle: add → request code → verify →
// register / deregister.
//
// The add-number field rules are NOT invented here. They mirror Meta's OpenAPI spec
// (facebook/openapi e96a1c9), which `src/lib/whatsapp/add-waba-phone-number.ts`
// already enforces at the boundary: `phone_number` is E.164 WITHOUT the plus and
// WITH the country code (the spec's own example is `16315551000` beside `cc: "1"`),
// and `verified_name` is 2–75 characters — 75, not the 512 an earlier draft of the
// plan guessed. Validating here as well is not duplication: this layer returns a
// Hebrew field error to the admin, while the client's normalisers throw TypeErrors
// that exist to stop a bad request reaching Meta at all.

/**
 * ONE phone field, split into Meta's two by the parser — not by the admin.
 *
 * The first version of this asked for `cc` and `phone_number` separately, with a hint
 * explaining that the second one carries the country code but not the '+'. That is a
 * convention Meta's API has and a person does not, and this codebase had already
 * decided not to ask: `PhoneInput` (the flag control the guest form and the contact
 * forms use) submits ONE value, exactly as typed, and libphonenumber-js works out the
 * country. `0501234567` and `+972 50-123 4567` are the same number, and the owner
 * should not have to know which of Meta's two fields each half belongs in.
 *
 * `defaultCountry: 'IL'` matches src/lib/phone.ts — consulted only when the value
 * carries no country code of its own, so a foreign number written in +CC form is
 * still read against its own numbering plan.
 */
export const wabaPhoneSchema = z
  .string()
  .trim()
  .min(1, 'יש להזין מספר טלפון')
  .transform((raw, ctx) => {
    const parsed = parsePhoneNumberFromString(raw, 'IL');
    if (!parsed || !parsed.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'מספר טלפון לא תקין' });
      return z.NEVER;
    }
    return {
      // ⚠️ `phone_number` IS THE NATIONAL NUMBER, WITHOUT THE COUNTRY CODE.
      // META CONCATENATES `cc` AND `phone_number`. PROVEN LIVE 2026-09-11, at the
      // cost of a junk number that cannot be deleted: sending cc="33" with
      // phone_number="33756982370" (E.164 minus the plus) created
      // +3333756982370 on the WABA — the calling code doubled.
      //
      // This overrules the OpenAPI spec, which is what an earlier version of this file
      // followed. Its example reads `phone_number: 16315551000` beside `cc: "1"`, and
      // that cannot be right: concatenated it yields +116315551000. The reference
      // page's "national digits" phrasing is the accurate one, and the spec example is
      // the trap. Meta's own behaviour is the only source that settled it.
      cc: parsed.countryCallingCode,
      phoneNumber: parsed.nationalNumber,
    };
  });

export const verifiedNameSchema = z
  .string()
  .trim()
  .min(2, 'שם העסק חייב להכיל לפחות 2 תווים')
  .max(75, 'שם העסק מוגבל ל-75 תווים');

export const addNumberSchema = z
  .object({
    phone: wabaPhoneSchema,
    verifiedName: verifiedNameSchema,
  })
  // Flattened so the DAL still receives Meta's two fields and never sees the raw
  // typed string — the split happens once, here, at the boundary.
  .transform(({ phone, verifiedName }) => ({
    cc: phone.cc,
    phoneNumber: phone.phoneNumber,
    verifiedName,
  }));
export type AddNumberInput = z.infer<typeof addNumberSchema>;

/** A Meta object id. Digits only — never a phone number, never a UUID. */
export const phoneNumberIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,25}$/, 'מזהה מספר לא תקין');

export const codeMethodSchema = z.enum(['SMS', 'VOICE']);

export const requestCodeSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  codeMethod: codeMethodSchema,
});

export const verifyCodeSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'קוד האימות מורכב מ-6 ספרות'),
});

/**
 * ⚠️ THE PIN IS A CREDENTIAL — treat this field like a password, not like a code.
 *
 * There is no "create a PIN" operation at Meta: this value is a parameter of
 * register. If the number already has two-step verification it must be the EXISTING
 * PIN; if it does not, this value BECOMES the number's 2SV PIN. Meta then requires
 * it for changing the PIN and for deleting the number, so its blast radius outlives
 * the registration.
 *
 * It is never stored, never returned to the browser, never logged, and never placed
 * in an error message. Every registration asks the owner for it again — which is the
 * point: storing it would let an unattended job re-register a number, and that is
 * exactly the operation that should require a person.
 */
export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'ה-PIN מורכב מ-6 ספרות');

export const registerNumberSchema = z.object({
  phoneNumberId: phoneNumberIdSchema,
  pin: pinSchema,
});

/**
 * Typing the word to confirm. Register and deregister are rate-limited by Meta to
 * 10 per number per 72 hours, so an accidental click is not free — it spends a
 * budget that cannot be topped up.
 */
export const CONFIRM_WORD = 'REGISTER';
export const confirmWordSchema = z
  .string()
  .trim()
  .refine((v) => v === CONFIRM_WORD, `יש להקליד ${CONFIRM_WORD} לאישור`);

export const CODE_METHOD_LABELS: Record<z.infer<typeof codeMethodSchema>, string> = {
  SMS: 'הודעת SMS',
  VOICE: 'שיחה קולית',
};
