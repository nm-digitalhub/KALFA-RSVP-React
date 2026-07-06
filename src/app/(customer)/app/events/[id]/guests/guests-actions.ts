'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  PHONE_TAKEN_ERROR,
  GROUP_NAME_TAKEN_ERROR,
  createGuest,
  updateGuest,
  deleteGuest,
  updateContactStatus,
  createGroup,
  updateGroup,
  deleteGroup,
} from '@/lib/data/guests';
import { linkGuestContact } from '@/lib/data/contacts';
import { regenerateRsvpToken, revokeRsvpToken } from '@/lib/data/rsvp';
import {
  createGuestSchema,
  updateGuestSchema,
  groupSchema,
} from '@/lib/validation/guests';
import { Constants } from '@/lib/supabase/types';
import type { ContactStatus } from '@/lib/data/guests';
import type { FormState } from '@/lib/validation/result';

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
  let createdId: string;
  try {
    const created = await createGuest(eventId, {
      full_name: d.full_name,
      phone: d.phone ? d.phone : null,
      status: d.status,
      contact_status: d.contact_status,
      group_id: d.group_id ? d.group_id : null,
      expected_count: d.expected_count ?? null,
      note: d.note ? d.note : null,
    });
    createdId = created.id;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Error && err.message === PHONE_TAKEN_ERROR) {
      return { fieldErrors: { phone: [PHONE_TAKEN_ERROR] } };
    }
    return { error: 'הוספת המוזמן נכשלה. נסו שוב.' };
  }

  // Best-effort: keep the contacts table (the billing source-of-truth) in sync.
  // The guest is already created and committed — a failure here must NOT fail the
  // action (a retry would create a duplicate guest); contacts reconcile on the
  // next mutation or campaign build.
  await syncGuestContact(eventId, createdId, d.phone ? d.phone : null);

  revalidatePath(`/app/events/${eventId}/guests`);
  redirect(`/app/events/${eventId}/guests`);
}

// Best-effort contact linking shared by create/update. Swallows failures by
// design: the preceding guest mutation is already committed, and the contacts
// table is derivable/idempotent (linkGuestContact upserts on a UNIQUE key).
async function syncGuestContact(
  eventId: string,
  guestId: string,
  phone: string | null,
): Promise<void> {
  try {
    await linkGuestContact(eventId, guestId, phone);
  } catch (err) {
    // Next control-flow signals must propagate, never be swallowed.
    unstable_rethrow(err);
    // Derived secondary effect — never blocks the completed guest mutation, but
    // log (no phone PII) so a dropped link is auditable and reconcilable.
    console.error(
      `[contacts] guest contact sync failed (event=${eventId} guest=${guestId}): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    );
  }
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
    unstable_rethrow(err);
    if (err instanceof Error && err.message === PHONE_TAKEN_ERROR) {
      return { fieldErrors: { phone: [PHONE_TAKEN_ERROR] } };
    }
    return { error: 'עדכון המוזמן נכשל. נסו שוב.' };
  }

  // Re-link the contact only when the phone was part of this update (the only
  // field that changes the contact mapping). Best-effort, same rationale as create.
  if (d.phone !== undefined) {
    await syncGuestContact(eventId, guestId, d.phone ? d.phone : null);
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
    unstable_rethrow(err);
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
    unstable_rethrow(err);
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
    // A form without a color field posts NOTHING for it → null, which
    // z.string().optional() rejects. Normalize to '' (the "no color" value).
    color: formData.get('color') ?? '',
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
    unstable_rethrow(err);
    if (err instanceof Error && err.message === GROUP_NAME_TAKEN_ERROR) {
      return { fieldErrors: { name: [GROUP_NAME_TAKEN_ERROR] } };
    }
    return { error: 'יצירת הקבוצה נכשלה. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/guests`);
  return { notice: 'הקבוצה נוצרה' };
}

// Rename only — color stays whatever it was (the groups manager exposes just
// the name; groupSchema keeps validating both so a future color UI reuses it).
export async function updateGroupAction(
  eventId: string,
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = groupSchema.safeParse({
    name: formData.get('name'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateGroup(eventId, groupId, { name: parsed.data.name });
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Error && err.message === GROUP_NAME_TAKEN_ERROR) {
      return { fieldErrors: { name: [GROUP_NAME_TAKEN_ERROR] } };
    }
    return { error: 'עדכון הקבוצה נכשל. נסו שוב.' };
  }

  revalidatePath(`/app/events/${eventId}/guests`);
  return { notice: 'שם הקבוצה עודכן' };
}

export async function deleteGroupAction(
  eventId: string,
  groupId: string,
): Promise<void> {
  try {
    await deleteGroup(eventId, groupId);
  } catch (err) {
    unstable_rethrow(err);
    throw new Error('מחיקת הקבוצה נכשלה');
  }
  revalidatePath(`/app/events/${eventId}/guests`);
}

// RSVP-link management on the guest detail page. The data layer re-verifies
// event ownership (requireOwnedEvent) before touching the bearer token, which
// is otherwise excluded from every owner-facing guest projection.
export async function revokeRsvpTokenAction(
  eventId: string,
  guestId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await revokeRsvpToken(eventId, guestId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'ביטול קישור ההזמנה נכשל. נסו שוב.' };
  }
  revalidatePath(`/app/events/${eventId}/guests/${guestId}`);
  return { notice: 'הקישור בוטל' };
}

export async function regenerateRsvpTokenAction(
  eventId: string,
  guestId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await regenerateRsvpToken(eventId, guestId);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת קישור חדש נכשלה. נסו שוב.' };
  }
  revalidatePath(`/app/events/${eventId}/guests/${guestId}`);
  return { notice: 'נוצר קישור חדש' };
}
