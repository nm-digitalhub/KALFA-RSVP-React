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
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  availabilityBlockIdSchema,
  availabilityBlockSchema,
} from '@/lib/validation/schemas';

// Server Actions for the availability switcher in the admin account menu.
// Thin by design: validate shape, call the domain layer (which owns
// requireUser + requirePlatformPermission + the Exchange write), return a
// safe result. Every mutation revalidates the admin layout so the menu's
// status dot reflects the change on the next render.
//
// A refusal reaches the menu as serverError (returnUserError, outside every try: it throws, and a catch would turn it
// into its own message); a malformed input as the schema's own Hebrew validation message.

type AvailabilityState = { blocks: AvailabilityBlock[]; presence: PresenceSnapshot };

// Every mutation returns the state re-read from the SERVER (presence from
// Exchange itself, blocks from our table) — the UI never guesses what the
// new state is, which is what keeps the dot honest even when the change
// came from Outlook a second earlier.
async function currentStateOr(message: string): Promise<AvailabilityState> {
  let state: AvailabilityState;
  try {
    const [blocks, presence] = await Promise.all([
      listMyAvailabilityBlocks(),
      getMyPresence(),
    ]);
    state = { blocks, presence };
  } catch (err) {
    unstable_rethrow(err);
    returnUserError(message);
  }
  return state;
}

/** Poll for the live state (menu open / window focus). */
export const refreshAvailabilityAction = actionClient.action(async () =>
  currentStateOr('רענון הסטטוס נכשל.'),
);

export const setAvailabilityBlockAction = actionClient
  .inputSchema(availabilityBlockSchema)
  .action(async ({ parsedInput }) => {
    let result: Awaited<ReturnType<typeof createAvailabilityBlock>>;
    try {
      result = await createAvailabilityBlock(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון הסטטוס נכשל. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    revalidatePath('/admin', 'layout');
    return currentStateOr('הסטטוס עודכן, אך רענון הרשימה נכשל.');
  });

export const clearAvailabilityAction = actionClient.action(async () => {
  let result: Awaited<ReturnType<typeof clearActiveAvailabilityBlocks>>;
  try {
    result = await clearActiveAvailabilityBlocks();
  } catch (err) {
    unstable_rethrow(err);
    returnUserError('ניקוי הסטטוס נכשל. נסו שוב.');
  }
  if (!result.ok) returnUserError(result.message);
  revalidatePath('/admin', 'layout');
  return currentStateOr('הסטטוס נוקה, אך רענון הרשימה נכשל.');
});

export const removeAvailabilityBlockAction = actionClient
  .inputSchema(availabilityBlockIdSchema)
  .action(async ({ parsedInput }) => {
    let result: Awaited<ReturnType<typeof deleteAvailabilityBlock>>;
    try {
      result = await deleteAvailabilityBlock(parsedInput.blockId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ביטול הסטטוס נכשל. נסו שוב.');
    }
    if (!result.ok) returnUserError(result.message);
    revalidatePath('/admin', 'layout');
    return currentStateOr('הסטטוס בוטל, אך רענון הרשימה נכשל.');
  });
