'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createGuest,
  updateGuest,
  deleteGuest,
  updateContactStatus,
  createGroup,
  deleteGroup,
} from '@/lib/data/guests';
import {
  createGuestSchema,
  updateGuestSchema,
  groupSchema,
} from '@/lib/validation/guests';
import { Constants } from '@/lib/supabase/types';
import type { ContactStatus } from '@/lib/data/guests';
import type { FormState } from '@/lib/validation/result';

// Next.js signals control flow (redirect, notFound) by throwing a sentinel
// error carrying a `digest`. Those MUST propagate — catching them would break
// the redirect/404. Everything else becomes a safe, generic message.
function isNextControlFlow(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('digest' in err)) return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') ||
      digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
  );
}

// Normalise an optional text field: '' -> null (clear), otherwise the value.
function orNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

export async function createGuestAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createGuestSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    status: orNull(formData.get('status')) ?? undefined,
    contact_status: orNull(formData.get('contact_status')) ?? undefined,
    group_id: formData.get('group_id'),
    expected_count: orNull(formData.get('expected_count')) ?? undefined,
    note: formData.get('note'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const d = parsed.data;
  try {
    await createGuest(eventId, {
      full_name: d.full_name,
      phone: d.phone ? d.phone : null,
      status: d.status,
      contact_status: d.contact_status,
      group_id: d.group_id ? d.group_id : null,
      expected_count: d.expected_count ?? null,
      note: d.note ? d.note : null,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'הוספת המוזמן נכשלה. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/guests`);
  redirect(`/app/events/${eventId}/guests`);
}

export async function updateGuestAction(
  eventId: string,
  guestId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateGuestSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    status: orNull(formData.get('status')) ?? undefined,
    contact_status: orNull(formData.get('contact_status')) ?? undefined,
    group_id: formData.get('group_id'),
    expected_count: orNull(formData.get('expected_count')) ?? undefined,
    note: formData.get('note'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const d = parsed.data;
  try {
    await updateGuest(eventId, guestId, {
      full_name: d.full_name,
      phone: d.phone !== undefined ? (d.phone ? d.phone : null) : undefined,
      status: d.status,
      contact_status: d.contact_status,
      group_id:
        d.group_id !== undefined ? (d.group_id ? d.group_id : null) : undefined,
      expected_count: d.expected_count ?? undefined,
      note: d.note !== undefined ? (d.note ? d.note : null) : undefined,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'עדכון המוזמן נכשל. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/guests`);
  redirect(`/app/events/${eventId}/guests`);
}

export async function deleteGuestAction(
  eventId: string,
  guestId: string,
): Promise<void> {
  try {
    await deleteGuest(eventId, guestId);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    // Surface a generic failure by re-throwing so the nearest error boundary
    // handles it; there is no form state to return to for this action.
    throw new Error('מחיקת המוזמן נכשלה');
  }
  revalidatePath(`/app/events/${eventId}/guests`);
}

// Quick contact-status update from the list. The value is validated against the
// DB enum before it reaches the data layer.
export async function setContactStatusAction(
  eventId: string,
  guestId: string,
  value: string,
): Promise<void> {
  const valid = (Constants.public.Enums.contact_status as readonly string[]).includes(
    value,
  );
  if (!valid) {
    throw new Error('סטטוס יצירת קשר לא תקין');
  }
  try {
    await updateContactStatus(eventId, guestId, value as ContactStatus);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    throw new Error('עדכון סטטוס יצירת הקשר נכשל');
  }
  revalidatePath(`/app/events/${eventId}/guests`);
}

export async function createGroupAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = groupSchema.safeParse({
    name: formData.get('name'),
    color: formData.get('color'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createGroup(eventId, {
      name: parsed.data.name,
      color: parsed.data.color ? parsed.data.color : null,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { error: 'יצירת הקבוצה נכשלה. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/guests`);
  return { notice: 'הקבוצה נוצרה' };
}

export async function deleteGroupAction(
  eventId: string,
  groupId: string,
): Promise<void> {
  try {
    await deleteGroup(eventId, groupId);
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    throw new Error('מחיקת הקבוצה נכשלה');
  }
  revalidatePath(`/app/events/${eventId}/guests`);
}
