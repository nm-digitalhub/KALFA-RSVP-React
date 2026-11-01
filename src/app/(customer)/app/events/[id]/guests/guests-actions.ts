'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';

import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  PHONE_TAKEN_ERROR,
  GROUP_NAME_TAKEN_ERROR,
  createGuest,
  updateGuest,
  deleteGuest,
  fillMissingExpectedCount,
  updateContactStatus,
  createGroup,
  updateGroup,
  deleteGroup,
} from '@/lib/data/guests';
import {
  linkGuestContact,
  reconcileCampaignSetForContact,
} from '@/lib/data/contacts';
import { regenerateRsvpToken, revokeRsvpToken } from '@/lib/data/rsvp-links';
import {
  createGuestSchema,
  updateGuestSchema,
  groupSchema,
} from '@/lib/validation/guests';

// The guest form, read through the shared schema. A text field is passed as posted: '' is a value (an empty name gets
// the schema's Hebrew message; on an update it clears the phone, the group or the note). A select or number left blank
// is absent (zfd.text), as it was before.
const createGuestFormSchema = zfd.formData({
  ...createGuestSchema.shape,
  status: zfd.text(createGuestSchema.shape.status),
  contact_status: zfd.text(createGuestSchema.shape.contact_status),
  expected_count: zfd.text(createGuestSchema.shape.expected_count),
});

const updateGuestFormSchema = zfd.formData({
  ...updateGuestSchema.shape,
  status: zfd.text(updateGuestSchema.shape.status),
  contact_status: zfd.text(updateGuestSchema.shape.contact_status),
  expected_count: zfd.text(updateGuestSchema.shape.expected_count),
});

export const createGuestAction = actionClient
  .inputSchema(createGuestFormSchema)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput: d, bindArgsParsedInputs: [eventId] }) => {
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
        returnValidationErrors(createGuestFormSchema, { phone: { _errors: [PHONE_TAKEN_ERROR] } });
      }
      returnUserError('הוספת המוזמן נכשלה. נסו שוב.');
    }

    // Best-effort: keep the contacts table (the billing source-of-truth) in sync.
    // The guest is already created and committed — a failure here must NOT fail the
    // action (a retry would create a duplicate guest); contacts reconcile on the
    // next mutation.
    await syncGuestContact(eventId, createdId, d.phone ? d.phone : null);

    revalidatePath(`/app/events/${eventId}/guests`);
    redirect(`/app/events/${eventId}/guests`);
  });

// Best-effort contact linking shared by create/update. Swallows failures by
// design: the preceding guest mutation is already committed, and the contacts
// table is derivable/idempotent (linkGuestContact upserts on a UNIQUE key).
async function syncGuestContact(
  eventId: string,
  guestId: string,
  phone: string | null,
): Promise<void> {
  try {
    const { contactId, prevContactId } = await linkGuestContact(
      eventId,
      guestId,
      phone,
    );
    // Reconcile the campaign authorized set for this link delta (kill-switch
    // gated by RECONCILE_AUTHORIZED_SET_ENABLED — a no-op while it is off).
    if (prevContactId && contactId && prevContactId !== contactId) {
      await reconcileCampaignSetForContact(eventId, 'repoint', contactId, prevContactId);
    } else if (contactId) {
      await reconcileCampaignSetForContact(eventId, 'add', contactId);
    } else if (prevContactId) {
      // Phone removed/invalidated → the guest no longer points to its contact.
      await reconcileCampaignSetForContact(eventId, 'delete', prevContactId);
    }
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

export const updateGuestAction = actionClient
  .inputSchema(updateGuestFormSchema)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput: d, bindArgsParsedInputs: [eventId, guestId] }) => {
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
        returnValidationErrors(updateGuestFormSchema, { phone: { _errors: [PHONE_TAKEN_ERROR] } });
      }
      returnUserError('עדכון המוזמן נכשל. נסו שוב.');
    }

    // Re-link the contact only when the phone was part of this update (the only
    // field that changes the contact mapping). Best-effort, same rationale as create.
    if (d.phone !== undefined) {
      await syncGuestContact(eventId, guestId, d.phone ? d.phone : null);
    }

    revalidatePath(`/app/events/${eventId}/guests`);
    redirect(`/app/events/${eventId}/guests`);
  });

// Called from the guest row (not a form). A failure comes back as the result's serverError; the row shows "נכשל".
export const deleteGuestAction = actionClient
  .inputSchema(z.object({ eventId: z.uuid(), guestId: z.uuid() }))
  .action(async ({ parsedInput: { eventId, guestId } }) => {
    try {
      await deleteGuest(eventId, guestId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('מחיקת המוזמן נכשלה');
    }
    revalidatePath(`/app/events/${eventId}/guests`);
  });

// Quick contact-status update from the list. The value is validated against the
// DB enum before it reaches the data layer. It arrives as the select's string;
// the guest schema's enum (and its Hebrew message) decides whether it is one.
export const setContactStatusAction = actionClient
  .inputSchema(
    z.object({
      eventId: z.uuid(),
      guestId: z.uuid(),
      value: z.string().pipe(createGuestSchema.shape.contact_status.unwrap()),
    }),
  )
  .action(async ({ parsedInput: { eventId, guestId, value } }) => {
    try {
      await updateContactStatus(eventId, guestId, value);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון סטטוס יצירת הקשר נכשל');
    }
    revalidatePath(`/app/events/${eventId}/guests`);
  });

// A form without a color field posts nothing for it → absent, which the
// schema's optional color accepts (the "no color" value).
const createGroupFormSchema = zfd.formData(groupSchema.shape);

export const createGroupAction = actionClient
  .inputSchema(createGroupFormSchema)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId] }) => {
    try {
      await createGroup(eventId, {
        name: parsedInput.name,
        color: parsedInput.color ? parsedInput.color : null,
      });
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof Error && err.message === GROUP_NAME_TAKEN_ERROR) {
        returnValidationErrors(createGroupFormSchema, { name: { _errors: [GROUP_NAME_TAKEN_ERROR] } });
      }
      returnUserError('יצירת הקבוצה נכשלה. נסו שוב.');
    }

    revalidatePath(`/app/events/${eventId}/guests`);
    return { notice: 'הקבוצה נוצרה' };
  });

// Rename only — color stays whatever it was (the groups manager exposes just
// the name; groupSchema keeps validating both so a future color UI reuses it).
const updateGroupFormSchema = zfd.formData({ name: groupSchema.shape.name });

export const updateGroupAction = actionClient
  .inputSchema(updateGroupFormSchema)
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId, groupId] }) => {
    try {
      await updateGroup(eventId, groupId, { name: parsedInput.name });
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof Error && err.message === GROUP_NAME_TAKEN_ERROR) {
        returnValidationErrors(updateGroupFormSchema, { name: { _errors: [GROUP_NAME_TAKEN_ERROR] } });
      }
      returnUserError('עדכון הקבוצה נכשל. נסו שוב.');
    }

    revalidatePath(`/app/events/${eventId}/guests`);
    return { notice: 'שם הקבוצה עודכן' };
  });

// Called from the groups manager (not a form). A failure comes back as the result's serverError; the row shows "נכשל".
export const deleteGroupAction = actionClient
  .inputSchema(z.object({ eventId: z.uuid(), groupId: z.uuid() }))
  .action(async ({ parsedInput: { eventId, groupId } }) => {
    try {
      await deleteGroup(eventId, groupId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('מחיקת הקבוצה נכשלה');
    }
    revalidatePath(`/app/events/${eventId}/guests`);
  });

// RSVP-link management on the guest detail page. The data layer re-verifies
// event access (requireEventAccess) before touching the bearer token, which
// is otherwise excluded from every owner-facing guest projection. Each is a
// one-button form: it posts no fields.
export const revokeRsvpTokenAction = actionClient
  .inputSchema(zfd.formData({}))
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, guestId] }) => {
    try {
      await revokeRsvpToken(eventId, guestId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('ביטול קישור ההזמנה נכשל. נסו שוב.');
    }
    revalidatePath(`/app/events/${eventId}/guests/${guestId}`);
    return { notice: 'הקישור בוטל' };
  });

export const regenerateRsvpTokenAction = actionClient
  .inputSchema(zfd.formData({}))
  .bindArgsSchemas([z.uuid(), z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [eventId, guestId] }) => {
    try {
      await regenerateRsvpToken(eventId, guestId);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת קישור חדש נכשלה. נסו שוב.');
    }
    revalidatePath(`/app/events/${eventId}/guests/${guestId}`);
    return { notice: 'נוצר קישור חדש' };
  });

// A FormData value as posted (a string, or a File). What the count must be is decided in the body.
const fillExpectedCountFormSchema = zfd.formData({
  expected_count: z.union([z.string(), z.instanceof(File)]).optional(),
});

// Fill the invited size for every guest of this event that has none — offered on
// the guest list only while such guests exist. The count is validated through
// the SAME schema field the guest form uses, so this back-fill cannot store a
// value the form would have rejected.
export const fillMissingExpectedCountAction = actionClient
  .inputSchema(fillExpectedCountFormSchema)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput: { expected_count }, bindArgsParsedInputs: [eventId] }) => {
    const parsed = createGuestSchema.shape.expected_count.safeParse(
      (expected_count ?? '').toString().trim(),
    );
    if (!parsed.success || parsed.data === undefined) {
      returnValidationErrors(fillExpectedCountFormSchema, {
        expected_count: { _errors: ['נא להזין מספר מוזמנים'] },
      });
    }

    let filled: number;
    try {
      filled = await fillMissingExpectedCount(eventId, parsed.data);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('עדכון כמות המוזמנים נכשל. נסו שוב.');
    }

    revalidatePath(`/app/events/${eventId}/guests`);
    return {
      notice:
        filled === 0
          ? 'לא נמצאו מוזמנים ללא כמות.'
          : `הושלמה כמות עבור ${filled.toLocaleString('he-IL')} מוזמנים.`,
    };
  });
