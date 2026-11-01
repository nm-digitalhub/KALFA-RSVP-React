'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import {
  markEventAsTest,
  purgeTestEvent,
  unmarkEventAsTest,
  type MarkOutcome,
  type PurgeOutcome,
  type UnmarkOutcome,
} from '@/lib/data/admin/test-events';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Thin entry points for the test-event section of the staff event page. Each
// action is reachable by a direct POST, so the permission check lives in the
// data layer call it makes (requirePlatformPermission per key), not in the page.

const PURGE_ERRORS: Record<Exclude<PurgeOutcome, 'purged'>, string> = {
  not_marked: 'האירוע לא מסומן כאירוע בדיקה.',
  financial_activity:
    'לא ניתן למחוק: באירוע יש פעילות כספית (תשלום או החזר ביומן התשלומים, מסמך SUMIT או גביית ביטול).',
  approved_terms:
    'לא ניתן למחוק: בקמפיין של האירוע אושרו תנאים — מחיר מאושר הוא היסטוריה שאינה נמחקת.',
  not_staff: 'אין הרשאה לפעולה.',
  no_event: 'האירוע לא נמצא.',
};

// The event id travels in a hidden field and reaches the data layer as sent (an
// absent one as ''): the data layer checks the permission first, then the id.
const eventIdForm = zfd.formData({ eventId: z.string().prefault('') });

export const markTestEventAction = actionClient
  .inputSchema(eventIdForm)
  .stateAction(async ({ parsedInput: { eventId } }) => {
    let outcome: MarkOutcome;
    try {
      outcome = await markEventAsTest(eventId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('סימון האירוע נכשל. נסו שוב.');
    }
    if (outcome === 'not_staff') returnUserError('אין הרשאה לפעולה.');
    if (outcome === 'no_event') returnUserError('האירוע לא נמצא.');
    revalidatePath(`/admin/events/${eventId}`);
    return { notice: 'האירוע סומן כאירוע בדיקה.' };
  });

export const unmarkTestEventAction = actionClient
  .inputSchema(eventIdForm)
  .stateAction(async ({ parsedInput: { eventId } }) => {
    let outcome: UnmarkOutcome;
    try {
      outcome = await unmarkEventAsTest(eventId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ביטול הסימון נכשל. נסו שוב.');
    }
    if (outcome === 'not_staff') returnUserError('אין הרשאה לפעולה.');
    if (outcome === 'no_event') returnUserError('האירוע לא נמצא.');
    revalidatePath(`/admin/events/${eventId}`);
    return { notice: 'הסימון בוטל.' };
  });

export const purgeTestEventAction = actionClient
  .inputSchema(eventIdForm)
  .stateAction(async ({ parsedInput: { eventId } }) => {
    let outcome: PurgeOutcome;
    try {
      outcome = await purgeTestEvent(eventId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('מחיקת האירוע נכשלה. נסו שוב.');
    }
    if (outcome !== 'purged') returnUserError(PURGE_ERRORS[outcome]);

    // The event no longer exists, so its page would 404 — go to the campaign board.
    revalidatePath('/admin/campaigns');
    redirect('/admin/campaigns');
  });
