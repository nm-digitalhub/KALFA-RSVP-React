'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  clearActiveAvailabilityBlocks,
  createAvailabilityBlock,
  deleteAvailabilityBlock,
  getMyPresence,
  listMyAvailabilityBlocks,
  type AvailabilityBlock,
  type PresenceSnapshot,
} from '@/lib/data/exchange-availability';
import {
  availabilityBlockIdSchema,
  availabilityBlockSchema,
} from '@/lib/validation/schemas';

// Server Actions for the availability switcher in the admin account menu.
// Thin by design: validate shape, call the domain layer (which owns
// requireUser + requirePlatformPermission + the Exchange write), return a
// safe result. Every mutation revalidates the admin layout so the menu's
// status dot reflects the change on the next render.

export type AvailabilityActionResult =
  | { ok: true; blocks: AvailabilityBlock[]; presence: PresenceSnapshot }
  | { ok: false; message: string };

// Every mutation returns the state re-read from the SERVER (presence from
// Exchange itself, blocks from our table) — the UI never guesses what the
// new state is, which is what keeps the dot honest even when the change
// came from Outlook a second earlier.
async function currentStateOr(message: string): Promise<AvailabilityActionResult> {
  try {
    const [blocks, presence] = await Promise.all([
      listMyAvailabilityBlocks(),
      getMyPresence(),
    ]);
    return { ok: true, blocks, presence };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message };
  }
}

/** Poll for the live state (menu open / window focus). */
export async function refreshAvailabilityAction(): Promise<AvailabilityActionResult> {
  return currentStateOr('רענון הסטטוס נכשל.');
}

export async function setAvailabilityBlockAction(input: {
  showAs: string;
  startsAtIso: string;
  endsAtIso: string;
}): Promise<AvailabilityActionResult> {
  const parsed = availabilityBlockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'קלט לא תקין' };
  }
  try {
    const result = await createAvailabilityBlock(parsed.data);
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath('/admin', 'layout');
    return await currentStateOr('הסטטוס עודכן, אך רענון הרשימה נכשל.');
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'עדכון הסטטוס נכשל. נסו שוב.' };
  }
}

export async function clearAvailabilityAction(): Promise<AvailabilityActionResult> {
  try {
    const result = await clearActiveAvailabilityBlocks();
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath('/admin', 'layout');
    return await currentStateOr('הסטטוס נוקה, אך רענון הרשימה נכשל.');
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'ניקוי הסטטוס נכשל. נסו שוב.' };
  }
}

export async function removeAvailabilityBlockAction(input: {
  blockId: string;
}): Promise<AvailabilityActionResult> {
  const parsed = availabilityBlockIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'מזהה סטטוס לא תקין' };
  try {
    const result = await deleteAvailabilityBlock(parsed.data.blockId);
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath('/admin', 'layout');
    return await currentStateOr('הסטטוס בוטל, אך רענון הרשימה נכשל.');
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'ביטול הסטטוס נכשל. נסו שוב.' };
  }
}
