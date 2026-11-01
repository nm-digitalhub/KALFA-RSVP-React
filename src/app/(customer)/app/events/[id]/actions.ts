'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';
import { zfd } from 'zod-form-data';

import {
  CELEBRANTS_LOCKED_ERROR,
  DATES_LOCKED_ERROR,
  EVENT_TYPE_LOCKED_ERROR,
  VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR,
  getEvent,
  requireEventAccess,
  updateEvent,
} from '@/lib/data/events';
import { missingSetupPrerequisites } from '@/lib/data/setup-steps';
import { rescheduleEventExchangeAppointment } from '@/lib/data/event-exchange-sync';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import {
  INVITE_IMAGE_MAX_BYTES,
  INVITE_IMAGE_TYPES,
  uploadInviteImage,
} from '@/lib/storage/event-media';
import { createCancellationRequest } from '@/lib/data/event-cancellation';
import {
  celebrantsSchemaFor,
  parseCelebrantsForm,
  updateEventSchema,
} from '@/lib/validation/schemas';
import { createCancellationRequestSchema } from '@/lib/validation/event-cancellation';
import { cancellationReference } from '@/lib/data/cancellation-reference';
import { actionClient, returnUserError } from '@/lib/safe-action';

// `eventId` is bound from the route segment (server-side), NOT submitted by the
// browser. Authorization is enforced again inside updateEvent via the event-access
// gate (the owner, or an org member holding events.edit), so a tampered id can
// never edit an event the user has no access to.
//
// '' (rendered-but-empty, a draft owner explicitly clearing the field) → null.
// Only ever called for a key that IS present in the form.
function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// The event form as the browser posts it, read into updateEventSchema exactly as before.
//
// Key PRESENCE carries the meaning, not the (possibly empty) value — a disabled
// <input> (locked, non-draft) is never POSTed at all, so the key is omitted
// entirely from what the schema parses (NOT passed as `null` — Zod's
// `.optional()` only treats a missing key as absent, not a `null` value). A
// rendered-but-empty draft input IS posted (value ''), so the key is present
// with an empty-string value. The parsed input keeps that difference (no
// event_date key vs event_date ''), and the save below reads it from there —
// one source of truth.
//
// The celebrant inputs (celebrants.groom, …) arrive grouped under `celebrants`.
// Their schema is keyed on event_type, so they are validated only once the base
// parse (which owns event_type) succeeds. Their errors use dotted keys
// ('celebrants.groom'), where the form shows them; the base errors are
// necessarily empty then.
const eventForm = zfd.formData(
  z
    .preprocess(
      (form: Record<string, unknown>) => ({
        name: form.name ?? null,
        event_type: form.event_type ?? null,
        venue_name: form.venue_name ?? null,
        gift_payment_url: form.gift_payment_url ?? '',
        venue_address: form.venue_address ?? null,
        event_time: form.event_time ?? '',
        // Checkbox semantics: the input is ALWAYS rendered, so key presence IS the
        // checked state (an unchecked checkbox posts nothing).
        show_meal_pref: 'show_meal_pref' in form,
        ...('event_date' in form ? { event_date: form.event_date } : {}),
        ...('rsvp_deadline' in form ? { rsvp_deadline: form.rsvp_deadline } : {}),
        celebrants: form.celebrants,
        invite_image: form.invite_image,
      }),
      updateEventSchema.safeExtend({ celebrants: z.unknown(), invite_image: z.unknown() }),
    )
    .transform((input, ctx) => {
      const celebrants = celebrantsSchemaFor(input.event_type).safeParse(input.celebrants ?? {});
      if (!celebrants.success) {
        for (const issue of celebrants.error.issues) {
          ctx.addIssue({
            code: 'custom',
            message: issue.message,
            path: [['celebrants', ...issue.path].join('.')],
          });
        }
        return z.NEVER;
      }
      return { ...input, celebrants: celebrants.data };
    }),
);

// The save behind both edit actions below: the plain edit, and the setup flow's details step.
async function saveEvent(eventId: string, input: z.output<typeof eventForm>): Promise<void> {
  const { name, event_type, venue_name, venue_address, gift_payment_url, show_meal_pref, celebrants } = input;
  const { event_date: eventDate, rsvp_deadline: rsvpDeadline } = input;

  // Invitation image (optional). Validated and uploaded BEFORE updateEvent,
  // behind the same org-aware edit gate; the stored PATH is server-derived —
  // the client never controls it.
  let inviteImagePath: string | undefined;
  const inviteImage = input.invite_image;
  if (inviteImage instanceof File && inviteImage.size > 0) {
    if (inviteImage.size > INVITE_IMAGE_MAX_BYTES) {
      returnUserError('תמונת ההזמנה גדולה מדי (עד 5MB).');
    }
    if (!(inviteImage.type in INVITE_IMAGE_TYPES)) {
      returnUserError('תמונת ההזמנה חייבת להיות JPG, PNG או WebP.');
    }
    try {
      await requireEventAccess(eventId, 'events', 'edit');
      inviteImagePath = await uploadInviteImage(
        eventId,
        new Uint8Array(await inviteImage.arrayBuffer()),
        inviteImage.type,
      );
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('העלאת תמונת ההזמנה נכשלה.');
    }
  }

  try {
    await updateEvent(eventId, {
      name,
      event_type,
      venue_name: venue_name ? venue_name : null,
      gift_payment_url: gift_payment_url ? gift_payment_url : null,
      show_meal_pref,
      ...(inviteImagePath ? { invite_image_path: inviteImagePath } : {}),
      venue_address: venue_address ? venue_address : null,
      // No presence dance here: the celebrant group is always rendered,
      // so its inputs are always posted. Only the SUBMITTED type's fields
      // survive (an event_type change replaces the old shape); all-empty →
      // null clears the column.
      celebrants: parseCelebrantsForm(event_type, celebrants),
      ...(eventDate !== undefined
        ? {
            event_date: (() => {
              const d = trimmedOrNull(eventDate);
              const t = input.event_time || '';
              return d ? ilWallTimeToIso(d, t) : d;
            })(),
          }
        : {}),
      ...(rsvpDeadline !== undefined
        ? { rsvp_deadline: trimmedOrNull(rsvpDeadline) }
        : {}),
    });
  } catch (err) {
    // Re-throw Next.js control-flow signals (redirect / notFound from the
    // access gate); catching them would silently break that flow.
    unstable_rethrow(err);
    // The while-campaign-live locks are the guards reachable through ENABLED UI
    // (the form renders these fields) — the user must see the actionable message,
    // not the generic one. Matched by shared consts (never a raw err.message
    // pass-through), so a rewording of the message never breaks this surfacing.
    if (
      err instanceof Error &&
      (err.message === DATES_LOCKED_ERROR ||
        err.message === CELEBRANTS_LOCKED_ERROR ||
        err.message === EVENT_TYPE_LOCKED_ERROR ||
        err.message === VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR)
    ) {
      returnUserError(err.message);
    }
    returnUserError('עדכון האירוע נכשל. נסו שוב.');
  }

  // A date that moved while the event is live leaves the calendar entry on the old
  // one. Staff reschedules do the same (rescheduleEventForAdmin). The schema only
  // accepts a deadline together with a date, so the date key is the signal. A no-op
  // for an event that was never synced (a draft has no entry), and it never throws,
  // so it cannot turn a saved edit into a failure.
  if (eventDate !== undefined) {
    await rescheduleEventExchangeAppointment(eventId);
  }

  revalidatePath('/app/events');
  revalidatePath(`/app/events/${eventId}`);
}

export const updateEventAction = actionClient
  .inputSchema(eventForm)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId] }) => {
    await saveEvent(eventId, parsedInput);
    return { notice: 'האירוע עודכן' };
  });

// The details step of the setup flow ("שמירה והמשך"): the SAME save as the plain
// edit (updateEventAction — validation, ownership, locks all unchanged), then the
// step moves on. If something the flow needs is still missing the owner stays on
// this step and is told exactly what; the save is NOT rolled back, since what was
// typed is valid and worth keeping. The flow's own state is recomputed on the
// server (computeSetupSteps) when the page loads, so nothing is passed along.
//
// It never returns a notice (it moves on, or answers with what is missing), but its result is typed as the plain
// edit's, so the edit form can bind either action.
export const setupSaveEventAction = actionClient
  .inputSchema(eventForm)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId] }): Promise<{ notice: string }> => {
    await saveEvent(eventId, parsedInput);

    const missing = missingSetupPrerequisites(await getEvent(eventId));
    if (missing.length > 0) {
      // Both: the sentence says what is missing, and each field that has a place in
      // the form is marked where the owner will look for it.
      const fieldErrors: Record<string, { _errors: string[] }> = {};
      for (const { field } of missing) if (field) fieldErrors[field] = { _errors: ['שדה חובה כדי להמשיך'] };
      returnValidationErrors(eventForm, {
        _errors: [`נשמר. כדי להמשיך יש להשלים: ${missing.map((m) => m.label).join(', ')}`],
        ...fieldErrors,
      });
    }
    redirect(`/app/events/${eventId}/setup`);
  });

const cancellationRequestForm = zfd.formData(
  z.preprocess(
    (form: Record<string, unknown>) => ({
      reason: form.reason ?? null,
      smsConsent: form.smsConsent === 'on',
    }),
    createCancellationRequestSchema,
  ),
);

export const createCancellationRequestAction = actionClient
  .inputSchema(cancellationRequestForm)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [eventId] }) => {
    const { requestCode } = await createCancellationRequest(eventId, parsedInput);
    revalidatePath(`/app/events/${eventId}`);
    return { notice: `בקשת הביטול נשלחה — מספר בקשה ${cancellationReference(requestCode)}. נעדכן אותך במייל.` };
  });
