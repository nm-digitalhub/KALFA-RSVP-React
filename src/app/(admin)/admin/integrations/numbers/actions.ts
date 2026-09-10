'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { logActivity } from '@/lib/data/activity';
import {
  syncMetaNumbers,
  syncVoximplantNumbers,
} from '@/lib/data/admin/integrations/provider-numbers';
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
