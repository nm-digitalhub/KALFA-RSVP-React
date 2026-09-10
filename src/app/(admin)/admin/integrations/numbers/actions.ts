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
import { assignRoleSchema, numberRoleSchema } from '@/lib/validation/provider-numbers';
import type { FormState } from '@/lib/validation/result';

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
    meta: { provider: 'meta_whatsapp', count: result.count, degraded: result.degraded },
  });

  revalidatePath(NUMBERS);
  revalidatePath(INDEX);

  // "3 numbers" and "3 numbers, some columns blank" are different facts, and only
  // one of them explains an empty cell to whoever is looking at the table.
  return {
    notice: result.degraded
      ? `סונכרנו ${result.count} מספרים — חלק מהשדות לא הוחזרו מ-Meta`
      : `סונכרנו ${result.count} מספרים מ-Meta`,
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
