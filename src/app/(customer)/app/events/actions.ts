'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createEvent } from '@/lib/data/events';
import {
  celebrantsSchemaFor,
  createEventSchema,
  parseCelebrantsForm,
  readCelebrantsForm,
} from '@/lib/validation/schemas';
import {
  INVITE_IMAGE_MAX_BYTES,
  INVITE_IMAGE_TYPES,
  removeInviteImage,
  uploadInviteImage,
} from '@/lib/storage/event-media';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';
import { ilWallTimeToIso } from '@/lib/data/event-date';

// '' (rendered-but-empty) → null. Same mapping updateEventAction uses.
function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// The create form mirrors the edit form 1:1 (owner ruling 2026-09-02), so this
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
export async function createEventAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createEventSchema.safeParse({
    name: formData.get('name'),
    event_type: formData.get('event_type'),
    event_date: formData.get('event_date'),
    event_time: formData.get('event_time') ?? '',
    venue_name: formData.get('venue_name'),
    venue_address: formData.get('venue_address') ?? '',
    rsvp_deadline: formData.get('rsvp_deadline') ?? '',
    gift_payment_url: formData.get('gift_payment_url') ?? '',
    // Checkbox semantics: the input is ALWAYS rendered, so key presence IS the
    // checked state (an unchecked checkbox posts nothing).
    show_meal_pref: formData.has('show_meal_pref'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // The celebrant schema is keyed on event_type, so celebrant inputs are
  // validated only once the base parse (which owns event_type) succeeds.
  // Errors use dotted keys ('celebrants.groom') via issuesToFieldErrors —
  // flatten() cannot express nested paths — and would merge with any base
  // fieldErrors, which are necessarily empty here.
  const celebrantsParsed = celebrantsSchemaFor(parsed.data.event_type).safeParse(
    readCelebrantsForm(formData),
  );
  if (!celebrantsParsed.success) {
    return {
      fieldErrors: issuesToFieldErrors(
        celebrantsParsed.error.issues.map((issue) => ({
          ...issue,
          path: ['celebrants', ...issue.path],
        })),
      ),
    };
  }

  // Invitation image (optional): validated BEFORE anything is created, with
  // the same limits as the edit form.
  const inviteImage = formData.get('invite_image');
  const hasImage = inviteImage instanceof File && inviteImage.size > 0;
  if (hasImage) {
    if (inviteImage.size > INVITE_IMAGE_MAX_BYTES) {
      return { error: 'תמונת ההזמנה גדולה מדי (עד 5MB).' };
    }
    if (!(inviteImage.type in INVITE_IMAGE_TYPES)) {
      return { error: 'תמונת ההזמנה חייבת להיות JPG, PNG או WebP.' };
    }
  }

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
  } = parsed.data;

  const eventId = crypto.randomUUID();

  let inviteImagePath: string | null = null;
  if (hasImage) {
    try {
      inviteImagePath = await uploadInviteImage(
        eventId,
        new Uint8Array(await inviteImage.arrayBuffer()),
        inviteImage.type,
      );
    } catch (err) {
      unstable_rethrow(err);
      return { error: 'העלאת תמונת ההזמנה נכשלה. נסו שוב.' };
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
      // Only the submitted type's fields survive; all-empty → null (SQL NULL).
      celebrants: parseCelebrantsForm(event_type, celebrantsParsed.data),
    });
  } catch (err) {
    unstable_rethrow(err);
    // The row never landed — do not leave its image behind.
    if (inviteImagePath) await removeInviteImage(inviteImagePath);
    return { error: 'יצירת האירוע נכשלה. נסו שוב.' };
  }

  revalidatePath('/app/events');
  redirect(`/app/events/${newEvent.id}`);
}
