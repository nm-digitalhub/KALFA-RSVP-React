'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

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
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';

// The gate lives in the DAL, per provider — syncMetaNumbers takes manage_settings,
// syncVoximplantNumbers takes manage_voice. Not repeated here on purpose: two gates
// on one path is how they drift apart, and the DAL's is the one that also protects
// every other caller. A Server Action is its own endpoint, so "the page checked" is
// never the answer; "the function it calls checks" is.

const NUMBERS = '/admin/integrations/numbers';
const INDEX = '/admin/integrations';

export async function syncMetaNumbersAction(): Promise<FormState> {
  let result: Awaited<ReturnType<typeof syncMetaNumbers>>;
  try {
    result = await syncMetaNumbers();
  } catch (err) {
    unstable_rethrow(err);
    // The DAL's message is already user-facing Hebrew and names the fixable case
    // (missing WABA id / token). Anything else is ours and stays generic.
    const message = err instanceof Error ? err.message : '';
    return {
      error: message.startsWith('חסרים') ? message : 'סנכרון המספרים מ-Meta נכשל',
    };
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
}

export async function syncVoximplantNumbersAction(): Promise<FormState> {
  let result: Awaited<ReturnType<typeof syncVoximplantNumbers>>;
  try {
    result = await syncVoximplantNumbers();
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : '';
    return {
      error: message.startsWith('חסרים') ? message : 'סנכרון המספרים מ-Voximplant נכשל',
    };
  }

  await logActivity({
    action: 'admin.integrations.numbers_synced',
    meta: { provider: 'voximplant', count: result.count },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);
  return { notice: `סונכרנו ${result.count} מספרים מ-Voximplant` };
}

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
export async function assignRoleAction(formData: FormData): Promise<FormState> {
  const rawRole = formData.get('role');
  const rawNumber = formData.get('numberId');

  const role = numberRoleSchema.safeParse(rawRole);
  if (!role.success) return { error: 'תפקיד לא מוכר' };

  // An empty select means "nobody". Distinct from an invalid id, which is a bug in
  // the form rather than a choice, and gets a different message.
  const wantsClear = rawNumber === '' || rawNumber === null;

  try {
    if (wantsClear) {
      await clearRole(role.data);
    } else {
      const parsed = assignRoleSchema.safeParse({ role: role.data, numberId: rawNumber });
      if (!parsed.success) return { error: 'מזהה מספר לא תקין' };
      await assignRole(parsed.data.role, parsed.data.numberId);
    }
  } catch (err) {
    unstable_rethrow(err);
    // The DAL names the one failure a caller can act on (the number is gone);
    // anything else is ours and stays generic.
    const message = err instanceof Error ? err.message : '';
    return { error: message === 'המספר שנבחר אינו קיים' ? message : 'שמירת השיוך נכשלה' };
  }

  await logActivity({
    action: 'admin.integrations.number_role_assigned',
    meta: { role: role.data, cleared: wantsClear },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);
  // The inbox names the receiving number from these rows, so a reassignment changes
  // what it prints.
  revalidatePath('/admin/webhooks');

  return { notice: wantsClear ? 'השיוך בוטל' : 'השיוך נשמר' };
}

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
// into fieldErrors, and not recorded in the activity row.

/** Superset of FormState: the wizard needs the new id to move to the next step. */
export interface AddNumberState {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Meta's phone_number_id for the number just added. Never a phone number. */
  phoneNumberId?: string;
  /**
   * The business name as submitted, echoed back so a failed attempt does not wipe it.
   *
   * A Server Action re-renders the form, and an uncontrolled input with no
   * defaultValue comes back EMPTY — so the first real failure blanked the name the
   * admin had just typed while leaving the phone number in place, which reads as the
   * form having eaten it. The phone number is NOT echoed here: PhoneInput keeps its
   * own state, and a phone number has no business making a round trip it does not
   * need to.
   */
  verifiedName?: string;
}

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

export async function addNumberAction(
  _prev: AddNumberState | null,
  formData: FormData,
): Promise<AddNumberState> {
  const parsed = addNumberSchema.safeParse({
    phone: formData.get('phone'),
    verifiedName: formData.get('verifiedName'),
  });
  if (!parsed.success) {
    const raw = formData.get('verifiedName');
    return {
      fieldErrors: issuesToFieldErrors(parsed.error.issues),
      verifiedName: typeof raw === 'string' ? raw : undefined,
    };
  }

  const verifiedName = parsed.data.verifiedName;

  let phoneNumberId: string;
  try {
    phoneNumberId = await addNumber(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    const message = err instanceof Error ? err.message : '';
    // The DAL now maps every Meta failure to Hebrew AND appends the numeric code, so
    // passing it through is what makes "it failed" into something diagnosable. Before
    // this the test was `startsWith('חסרים')`, which matched only the missing-token
    // case and flattened every other failure — including the one the owner hit — into
    // a sentence with no information in it.
    return {
      error: isUserFacing(message) ? message : 'הוספת המספר נכשלה',
      verifiedName,
    };
  }

  await logActivity({
    action: ADD_ACTION,
    // The Meta object id, not the phone number: this row is an audit trail, and the
    // number itself is personal data we have no reason to duplicate into it.
    meta: { phoneNumberId },
  });

  revalidatePath(NUMBERS);
  return {
    phoneNumberId,
    notice: 'המספר נוסף ל-WABA. עכשיו צריך לאמת בעלות עליו.',
  };
}

/**
 * Ask Meta to send the verification code.
 *
 * ⚠️ THIS RINGS OR TEXTS A REAL HANDSET. Nothing here is a dry run.
 */
export async function requestCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = requestCodeSchema.safeParse({
    phoneNumberId: formData.get('phoneNumberId'),
    codeMethod: formData.get('codeMethod'),
  });
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  try {
    await requestCode(parsed.data.phoneNumberId, parsed.data.codeMethod);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'בקשת הקוד נכשלה' };
  }

  await logActivity({
    action: CODE_ACTION,
    meta: { phoneNumberId: parsed.data.phoneNumberId, method: parsed.data.codeMethod },
  });

  return {
    notice:
      parsed.data.codeMethod === 'SMS'
        ? 'נשלחה הודעת SMS עם הקוד למספר.'
        : 'Meta מתקשרת למספר ומקריאה את הקוד.',
  };
}

export async function verifyCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = verifyCodeSchema.safeParse({
    phoneNumberId: formData.get('phoneNumberId'),
    code: formData.get('code'),
  });
  if (!parsed.success) {
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  try {
    await verifyCode(parsed.data.phoneNumberId, parsed.data.code);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'אימות הקוד נכשל' };
  }

  await logActivity({
    action: VERIFY_ACTION,
    // The code is single-use and already spent, but it is still a secret the audit
    // row has no use for.
    meta: { phoneNumberId: parsed.data.phoneNumberId },
  });

  revalidatePath(NUMBERS);
  return { notice: 'הבעלות על המספר אומתה. אפשר לרשום אותו ל-Cloud API.' };
}

/**
 * Register the number. OWNER ONLY, and it spends from a budget of 10 per number per
 * 72 hours that Meta will not refill.
 *
 * The typed confirmation is not friction for its own sake: this is the one control on
 * the page whose accidental use cannot be undone by pressing it again.
 */
export async function registerNumberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const confirm = confirmWordSchema.safeParse(formData.get('confirm'));
  if (!confirm.success) {
    return { fieldErrors: { confirm: [confirm.error.issues[0]?.message ?? ''] } };
  }

  const parsed = registerNumberSchema.safeParse({
    phoneNumberId: formData.get('phoneNumberId'),
    pin: formData.get('pin'),
  });
  if (!parsed.success) {
    // issuesToFieldErrors carries MESSAGES, never the submitted values — so a bad PIN
    // produces "ה-PIN מורכב מ-6 ספרות" and never the PIN itself.
    return { fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  try {
    await registerNumber(parsed.data.phoneNumberId, parsed.data.pin);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'רישום המספר נכשל' };
  }

  await logActivity({
    action: 'admin.integrations.number_registered',
    meta: { phoneNumberId: parsed.data.phoneNumberId },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);
  return { notice: 'המספר נרשם ל-Cloud API ויכול לשלוח.' };
}

/** Deregister. OWNER ONLY. Sending through this number stops immediately. */
export async function deregisterNumberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const confirm = confirmWordSchema.safeParse(formData.get('confirm'));
  if (!confirm.success) {
    return { fieldErrors: { confirm: [confirm.error.issues[0]?.message ?? ''] } };
  }

  const id = phoneNumberIdSchema.safeParse(formData.get('phoneNumberId'));
  if (!id.success) return { error: 'מזהה מספר לא תקין' };

  try {
    await deregisterNumber(id.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'הסרת הרישום נכשלה' };
  }

  await logActivity({
    action: 'admin.integrations.number_deregistered',
    meta: { phoneNumberId: id.data },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);
  return { notice: 'רישום המספר הוסר. שליחה דרכו נפסקה.' };
}
