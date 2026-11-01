'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createEvent, ONE_EVENT_PER_ACCOUNT_ERROR } from '@/lib/data/events';
import {
  celebrantsSchemaFor,
  createEventSchema,
  parseCelebrantsForm,
} from '@/lib/validation/schemas';
import {
  INVITE_IMAGE_MAX_BYTES,
  INVITE_IMAGE_TYPES,
  removeInviteImage,
  uploadInviteImage,
} from '@/lib/storage/event-media';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { ilWallTimeToIso } from '@/lib/data/event-date';

// '' (rendered-but-empty) → null. Same mapping updateEventAction uses.
function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// The create form as posted (zfd.formData): every field as typed ('' kept — the
// schema's optional fields accept it and the action maps it to null), the
// celebrants.* inputs nested under `celebrants`, and the invitation image as a
// File (an empty file input is no image).
//
// show_meal_pref: checkbox semantics. The input is ALWAYS rendered, so key
// presence IS the checked state (an unchecked checkbox posts nothing).
//
// The celebrant schema is keyed on event_type, so celebrant inputs are
// validated only once the base parse (which owns event_type, and every
// cross-field rule of createEventSchema) succeeds. Their errors use dotted keys
// ('celebrants.groom', the names the form's inputs carry), so the form can
// attach each to its own field.
const createEventInput = zfd.formData(
  z.preprocess(
    (fields: Record<string, unknown>) => ({ ...fields, show_meal_pref: 'show_meal_pref' in fields }),
    createEventSchema
      .safeExtend({
        celebrants: z.record(z.string(), z.unknown()).optional(),
        // An optional file in zod-form-data's documented shape (README, `file`): with no image chosen the browser
        // still sends an empty File, which zfd.file turns into undefined INSIDE its schema — so the optional has to
        // be inside too. `zfd.file().optional()` refused that empty File and silently blocked every create.
        invite_image: zfd.file(z.instanceof(File).optional()),
      })
      .transform(({ celebrants, ...event }, ctx) => {
        const celebrantsParsed = celebrantsSchemaFor(event.event_type).safeParse(celebrants ?? {});
        if (!celebrantsParsed.success) {
          for (const issue of celebrantsParsed.error.issues) {
            ctx.addIssue({
              code: 'custom',
              message: issue.message,
              path: [['celebrants', ...issue.path].join('.')],
            });
          }
          return z.NEVER;
        }
        // Only the submitted type's fields survive; all-empty → null (SQL NULL).
        return { ...event, celebrants: parseCelebrantsForm(event.event_type, celebrantsParsed.data) };
      }),
  ),
);

// The create form mirrors the edit form 1:1, so this
// action reads the SAME fields updateEventAction does — and the SAME way:
// checkbox presence for show_meal_pref, '' → null for optional text/date, the
// celebrant group keyed on the submitted type, and the invitation image
// validated + uploaded server-side.
//
// Order matters for the image (verified against the Supabase docs, 2.9):
//   1. validate EVERYTHING (fields + file) — nothing is created on a bad input;
//   2. generate the event id here (crypto.randomUUID()) — the storage path is
//      keyed by event id, and events.id accepts a supplied value (default
//      gen_random_uuid() applies only when omitted);
//   3. upload the image under that id — a failed upload creates NO event;
//   4. insert the row with id + invite_image_path in one write — if THAT fails,
//      the already-uploaded file is removed (best-effort) so nothing is left
//      behind. Either everything is saved, or the form shows an error and
//      nothing was — the same contract the edit form gives.
//
// returnUserError throws, so each refusal below is raised outside a try (or as
// the last step of its catch).
export const createEventAction = actionClient
  .inputSchema(createEventInput)
  .stateAction(async ({ parsedInput }) => {
    const {
      name,
      event_type,
      event_date,
      event_time,
      venue_name,
      venue_address,
      rsvp_deadline,
      gift_payment_url,
      show_meal_pref,
      celebrants,
      invite_image: inviteImage,
    } = parsedInput;

    // Invitation image (optional): validated BEFORE anything is created, with
    // the same limits as the edit form.
    if (inviteImage) {
      if (inviteImage.size > INVITE_IMAGE_MAX_BYTES) {
        returnUserError('תמונת ההזמנה גדולה מדי (עד 5MB).');
      }
      if (!(inviteImage.type in INVITE_IMAGE_TYPES)) {
        returnUserError('תמונת ההזמנה חייבת להיות JPG, PNG או WebP.');
      }
    }

    const eventId = crypto.randomUUID();

    let inviteImagePath: string | null = null;
    if (inviteImage) {
      try {
        inviteImagePath = await uploadInviteImage(
          eventId,
          new Uint8Array(await inviteImage.arrayBuffer()),
          inviteImage.type,
        );
      } catch (err) {
        unstable_rethrow(err);
        returnUserError('העלאת תמונת ההזמנה נכשלה. נסו שוב.');
      }
    }

    let newEvent: Awaited<ReturnType<typeof createEvent>>;
    try {
      newEvent = await createEvent({
        id: eventId,
        name,
        event_type,
        event_date: event_date ? ilWallTimeToIso(event_date, event_time || '') : null,
        venue_name: trimmedOrNull(venue_name),
        venue_address: trimmedOrNull(venue_address),
        rsvp_deadline: trimmedOrNull(rsvp_deadline),
        gift_payment_url: trimmedOrNull(gift_payment_url),
        show_meal_pref,
        invite_image_path: inviteImagePath,
        celebrants,
      });
    } catch (err) {
      unstable_rethrow(err);
      // The row never landed — do not leave its image behind.
      if (inviteImagePath) await removeInviteImage(inviteImagePath);
      // R10 is a rule the customer can act on ("call us"), not a failure. Passed
      // through verbatim; everything else stays a generic message so no provider
      // or database text reaches the browser.
      if (err instanceof Error && err.message === ONE_EVENT_PER_ACCOUNT_ERROR) {
        returnUserError(ONE_EVENT_PER_ACCOUNT_ERROR);
      }
      returnUserError('יצירת האירוע נכשלה. נסו שוב.');
    }

    revalidatePath('/app/events');
    redirect(`/app/events/${newEvent.id}`);
  });
