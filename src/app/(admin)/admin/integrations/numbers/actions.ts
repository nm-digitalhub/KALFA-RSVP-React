'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { flattenValidationErrors, returnValidationErrors } from 'next-safe-action';
import type { FlattenedValidationErrors, ValidationErrors } from 'next-safe-action';
import { zfd } from 'zod-form-data';

import { actionClient, returnUserError } from '@/lib/safe-action';
import { logActivity } from '@/lib/data/activity';
import {
  assignRole,
  clearRole,
  syncMetaNumbers,
  syncVoximplantNumbers,
} from '@/lib/data/admin/integrations/provider-numbers';
import {
  ADD_ACTION,
  CODE_ACTION,
  VERIFY_ACTION,
  addNumber,
  deregisterNumber,
  registerNumber,
  requestCode,
  verifyCode,
} from '@/lib/data/admin/integrations/number-registration';
import { assignRoleSchema, numberRoleSchema } from '@/lib/validation/provider-numbers';
import {
  addNumberSchema,
  confirmWordSchema,
  phoneNumberIdSchema,
  registerNumberSchema,
  requestCodeSchema,
  verifyCodeSchema,
} from '@/lib/validation/whatsapp-numbers';

// The gate lives in the DAL, per provider — syncMetaNumbers takes manage_settings,
// syncVoximplantNumbers takes manage_voice. Not repeated here on purpose: two gates
// on one path is how they drift apart, and the DAL's is the one that also protects
// every other caller. A Server Action is its own endpoint, so "the page checked" is
// never the answer; "the function it calls checks" is.

const NUMBERS = '/admin/integrations/numbers';
const INDEX = '/admin/integrations';

export const syncMetaNumbersAction = actionClient.action(async () => {
  let result: Awaited<ReturnType<typeof syncMetaNumbers>>;
  try {
    result = await syncMetaNumbers();
  } catch (err) {
    unstable_rethrow(err);
    // The DAL's message is already user-facing Hebrew and names the fixable case
    // (missing WABA id / token). Anything else is ours and stays generic.
    const message = err instanceof Error ? err.message : '';
    returnUserError(message.startsWith('חסרים') ? message : 'סנכרון המספרים מ-Meta נכשל');
  }

  await logActivity({
    action: 'admin.integrations.numbers_synced',
    meta: {
      provider: 'meta_whatsapp',
      count: result.count,
      // Audited separately from `count`: switching a number off is the one thing
      // this run does that an admin did not ask for, and "which sync turned that
      // off" has to be answerable afterwards.
      deactivated: result.deactivated,
      degraded: result.degraded,
    },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);

  // "3 numbers" and "3 numbers, some columns blank" are different facts, and only
  // one of them explains an empty cell to whoever is looking at the table.
  const base = result.degraded
    ? `סונכרנו ${result.count} מספרים — חלק מהשדות לא הוחזרו מ-Meta`
    : `סונכרנו ${result.count} מספרים מ-Meta`;

  // Never silent. A row changing from active to inactive without a word is the
  // same class of surprise as the bug this closes — a deleted number that stayed
  // on — just in the other direction.
  return {
    notice:
      result.deactivated > 0
        ? `${base}. ${result.deactivated} מספרים שכבר אינם ב-Meta סומנו כלא פעילים (השורה והשיוכים נשמרו).`
        : base,
  };
});

export const syncVoximplantNumbersAction = actionClient.action(async () => {
  let result: Awaited<ReturnType<typeof syncVoximplantNumbers>>;
  try {
    result = await syncVoximplantNumbers();
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : '';
    returnUserError(message.startsWith('חסרים') ? message : 'סנכרון המספרים מ-Voximplant נכשל');
  }

  await logActivity({
    action: 'admin.integrations.numbers_synced',
    meta: { provider: 'voximplant', count: result.count },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);
  return { notice: `סונכרנו ${result.count} מספרים מ-Voximplant` };
});

/**
 * Point a role at a number, or at nobody.
 *
 * ONE ACTION FOR BOTH, because it is one decision — which number holds this role.
 * A separate "remove" path would let an admin assign without noticing what they
 * displaced, and would need its own gate that could drift from this one.
 *
 * The gate is in the DAL, per role: pointing voice_caller_id_* or voice_inbound_did
 * at a different line changes which number places calls, and that is voice
 * configuration. Not repeated here — a Server Action is its own endpoint, so the
 * answer is never "the page checked", and two gates on one path drift apart.
 */
export const assignRoleAction = actionClient
  .inputSchema(
    zfd.formData({
      role: numberRoleSchema,
      // An empty select means "nobody" (zfd.text reads '' as absent). Distinct from an
      // invalid id, which is a bug in the form rather than a choice, and gets a
      // different message.
      numberId: zfd.text(assignRoleSchema.shape.numberId.optional()),
    }),
  )
  .action(async ({ parsedInput: { role, numberId } }) => {
    try {
      if (numberId === undefined) {
        await clearRole(role);
      } else {
        await assignRole(role, numberId);
      }
    } catch (err) {
      unstable_rethrow(err);
      // The DAL names the one failure a caller can act on (the number is gone);
      // anything else is ours and stays generic.
      const message = err instanceof Error ? err.message : '';
      returnUserError(message === 'המספר שנבחר אינו קיים' ? message : 'שמירת השיוך נכשלה');
    }

    const wantsClear = numberId === undefined;
    await logActivity({
      action: 'admin.integrations.number_role_assigned',
      meta: { role, cleared: wantsClear },
    });

    revalidatePath(NUMBERS);
    revalidatePath(INDEX);
    // The inbox names the receiving number from these rows, so a reassignment changes
    // what it prints.
    revalidatePath('/admin/webhooks');

    return { notice: wantsClear ? 'השיוך בוטל' : 'השיוך נשמר' };
  });

// ─── THE META NUMBER LIFECYCLE ────────────────────────────────────────────────
// add → request code → verify → register / deregister.
//
// The gates live in the DAL, per operation: adding and verifying take
// manage_settings, register and deregister take requirePlatformOwner on top. Not
// repeated here — a Server Action is its own endpoint, so "the wizard only showed
// the step to an owner" is never the answer, and two gates on one path drift apart.
//
// ⚠️ NO PIN REACHES THIS FILE'S LOGS OR RETURN VALUES. It is read from the form and
// handed to the DAL in the same expression. It is not put in a notice, not echoed
// into the validation errors, and not recorded in the activity row.

/**
 * Whether a message was written for the admin.
 *
 * The DAL's errors are Hebrew by construction; the typed client's normalisers throw
 * English TypeErrors describing Meta's field rules, and Meta's own text never reaches
 * here at all. One Hebrew letter is the difference between a sentence someone can act
 * on and one that leaks how the request was built.
 */
function isUserFacing(message: string): boolean {
  return /[\u0590-\u05FF]/.test(message);
}

// The form's own fields (phone, verifiedName) validate here, so their errors keep the
// names the wizard shows them under; addNumberSchema's split of the phone into Meta's
// cc + phone_number runs in the action, once, on the validated values.
const addNumberInput = zfd.formData(addNumberSchema.in);

export const addNumberAction = actionClient
  .inputSchema(addNumberInput, {
    // Every refusal of this step — the schema's or Meta's — carries the business name back
    // as it was typed, so a failed attempt does not wipe it.
    //
    // A Server Action re-renders the form, and an uncontrolled input with no
    // defaultValue comes back EMPTY — so the first real failure blanked the name the
    // admin had just typed while leaving the phone number in place, which reads as the
    // form having eaten it. The phone number is NOT echoed here: PhoneInput keeps its
    // own state, and a phone number has no business making a round trip it does not
    // need to.
    handleValidationErrorsShape: async (errors, { clientInput }) => {
      const typed = clientInput instanceof FormData ? clientInput.get('verifiedName') : null;
      return {
        ...flattenValidationErrors(errors),
        verifiedName: typeof typed === 'string' ? typed : undefined,
      };
    },
  })
  .stateAction(async ({ parsedInput }) => {
    let phoneNumberId: string;
    try {
      phoneNumberId = await addNumber(addNumberSchema.out.parse(parsedInput));
    } catch (err) {
      unstable_rethrow(err);
      const message = err instanceof Error ? err.message : '';
      // The DAL maps every Meta failure to Hebrew AND appends the numeric code, so
      // passing it through is what makes "it failed" into something diagnosable.
      returnValidationErrors(addNumberInput, {
        _errors: [isUserFacing(message) ? message : 'הוספת המספר נכשלה'],
      });
    }

    await logActivity({
      action: ADD_ACTION,
      // The Meta object id, not the phone number: this row is an audit trail, and the
      // number itself is personal data we have no reason to duplicate into it.
      meta: { phoneNumberId },
    });

    revalidatePath(NUMBERS);
    // The wizard needs the new id to move to the next step. Never a phone number.
    return {
      phoneNumberId,
      notice: 'המספר נוסף ל-WABA. עכשיו צריך לאמת בעלות עליו.',
    };
  });

/**
 * Ask Meta to send the verification code.
 *
 * ⚠️ THIS RINGS OR TEXTS A REAL HANDSET. Nothing here is a dry run.
 */
export const requestCodeAction = actionClient
  .inputSchema(zfd.formData(requestCodeSchema))
  .stateAction(async ({ parsedInput: { phoneNumberId, codeMethod } }) => {
    await requestCode(phoneNumberId, codeMethod);

    await logActivity({
      action: CODE_ACTION,
      meta: { phoneNumberId, method: codeMethod },
    });

    return {
      notice:
        codeMethod === 'SMS'
          ? 'נשלחה הודעת SMS עם הקוד למספר.'
          : 'Meta מתקשרת למספר ומקריאה את הקוד.',
    };
  });

export const verifyCodeAction = actionClient
  .inputSchema(zfd.formData(verifyCodeSchema))
  .stateAction(async ({ parsedInput: { phoneNumberId, code } }) => {
    await verifyCode(phoneNumberId, code);

    await logActivity({
      action: VERIFY_ACTION,
      // The code is single-use and already spent, but it is still a secret the audit
      // row has no use for.
      meta: { phoneNumberId },
    });

    revalidatePath(NUMBERS);
    return { notice: 'הבעלות על המספר אומתה. אפשר לרשום אותו ל-Cloud API.' };
  });

// Register and deregister check the typed confirmation FIRST: while it is wrong, it is
// the only thing the form says.
const registerInput = zfd.formData({ confirm: confirmWordSchema, ...registerNumberSchema.shape });
type RegisterErrors = FlattenedValidationErrors<ValidationErrors<typeof registerInput>>;

/**
 * Register the number. OWNER ONLY, and it spends from a budget of 10 per number per
 * 72 hours that Meta will not refill.
 *
 * The typed confirmation is not friction for its own sake: this is the one control on
 * the page whose accidental use cannot be undone by pressing it again.
 */
export const registerNumberAction = actionClient
  .inputSchema(registerInput, {
    // The flattened errors carry MESSAGES, never the submitted values — so a bad PIN
    // produces "ה-PIN מורכב מ-6 ספרות" and never the PIN itself.
    handleValidationErrorsShape: async (errors): Promise<RegisterErrors> => {
      const flat = flattenValidationErrors(errors);
      return flat.fieldErrors.confirm
        ? { formErrors: [], fieldErrors: { confirm: flat.fieldErrors.confirm } }
        : flat;
    },
  })
  .stateAction(async ({ parsedInput: { phoneNumberId, pin } }) => {
    try {
      await registerNumber(phoneNumberId, pin);
    } catch (err) {
      unstable_rethrow(err);
      // The DAL's message is passed through as it is, Hebrew or not: the DAL's contract
      // is that none of its messages carries the PIN, and actions.test.ts pins both.
      returnUserError(err instanceof Error ? err.message : 'רישום המספר נכשל');
    }

    await logActivity({
      action: 'admin.integrations.number_registered',
      meta: { phoneNumberId },
    });

    revalidatePath(NUMBERS);
    revalidatePath(INDEX);
    return { notice: 'המספר נרשם ל-Cloud API ויכול לשלוח.' };
  });

const deregisterInput = zfd.formData({ confirm: confirmWordSchema, phoneNumberId: phoneNumberIdSchema });
type DeregisterErrors = FlattenedValidationErrors<ValidationErrors<typeof deregisterInput>>;

/** Deregister. OWNER ONLY. Sending through this number stops immediately. */
export const deregisterNumberAction = actionClient
  .inputSchema(deregisterInput, {
    // A bad id is a bug in the form rather than a field the owner can fix, so it is
    // said once, above the button.
    handleValidationErrorsShape: async (errors): Promise<DeregisterErrors> => {
      const flat = flattenValidationErrors(errors);
      if (flat.fieldErrors.confirm) {
        return { formErrors: [], fieldErrors: { confirm: flat.fieldErrors.confirm } };
      }
      return { formErrors: flat.fieldErrors.phoneNumberId ? ['מזהה מספר לא תקין'] : [], fieldErrors: {} };
    },
  })
  .stateAction(async ({ parsedInput: { phoneNumberId } }) => {
    await deregisterNumber(phoneNumberId);

    await logActivity({
      action: 'admin.integrations.number_deregistered',
      meta: { phoneNumberId },
    });

    revalidatePath(NUMBERS);
    revalidatePath(INDEX);
    return { notice: 'רישום המספר הוסר. שליחה דרכו נפסקה.' };
  });
