'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  markEventAsTest,
  purgeTestEvent,
  unmarkEventAsTest,
  type PurgeOutcome,
} from '@/lib/data/admin/test-events';
import type { FormState } from '@/lib/validation/result';

// Thin entry points for the test-event section of the staff event page. Each
// action is reachable by a direct POST, so the permission check lives in the
// data layer call it makes (requirePlatformPermission per key), not in the page.

const PURGE_ERRORS: Record<Exclude<PurgeOutcome, 'purged'>, string> = {
  not_marked: 'האירוע לא מסומן כאירוע בדיקה.',
  financial_activity:
    'לא ניתן למחוק: באירוע יש פעילות כספית (חיוב, תפיסת מסגרת פתוחה, מסמך SUMIT או גביית ביטול).',
  not_staff: 'אין הרשאה לפעולה.',
  no_event: 'האירוע לא נמצא.',
};

function eventIdFrom(formData: FormData): string {
  return (formData.get('eventId') ?? '').toString();
}

export async function markTestEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = eventIdFrom(formData);
  try {
    const outcome = await markEventAsTest(eventId);
    if (outcome === 'not_staff') return { error: 'אין הרשאה לפעולה.' };
    if (outcome === 'no_event') return { error: 'האירוע לא נמצא.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'סימון האירוע נכשל. נסו שוב.' };
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { notice: 'האירוע סומן כאירוע בדיקה.' };
}

export async function unmarkTestEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = eventIdFrom(formData);
  try {
    const outcome = await unmarkEventAsTest(eventId);
    if (outcome === 'not_staff') return { error: 'אין הרשאה לפעולה.' };
    if (outcome === 'no_event') return { error: 'האירוע לא נמצא.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'ביטול הסימון נכשל. נסו שוב.' };
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { notice: 'הסימון בוטל.' };
}

export async function purgeTestEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = eventIdFrom(formData);
  let outcome: PurgeOutcome;
  try {
    outcome = await purgeTestEvent(eventId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'מחיקת האירוע נכשלה. נסו שוב.' };
  }
  if (outcome !== 'purged') return { error: PURGE_ERRORS[outcome] };

  // The event no longer exists, so its page would 404 — go to the campaign board.
  revalidatePath('/admin/campaigns');
  redirect('/admin/campaigns');
}
