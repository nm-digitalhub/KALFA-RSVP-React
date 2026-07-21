'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  CELEBRANTS_LOCKED_ERROR,
  EVENT_TYPE_LOCKED_ERROR,
  VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR,
  requireEventAccess,
  updateEvent,
} from '@/lib/data/events';
import { ilWallTimeToIso } from '@/lib/data/event-date';
import {
  INVITE_IMAGE_MAX_BYTES,
  INVITE_IMAGE_TYPES,
  uploadInviteImage,
} from '@/lib/storage/event-media';
import {
  celebrantsSchemaFor,
  parseCelebrantsForm,
  readCelebrantsForm,
  updateEventSchema,
} from '@/lib/validation/schemas';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';

// `eventId` is bound from the route segment (server-side), NOT submitted by the
// browser. Authorization is enforced again inside updateEvent via the ownership
// gate, so a tampered id can never edit another owner's event.
//
// '' (rendered-but-empty, a draft owner explicitly clearing the field) → null.
// Only ever called for a key that IS present in FormData.
function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export async function updateEventAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  // Key PRESENCE in FormData carries the meaning, not the (possibly empty)
  // value — a disabled <input> (locked, non-draft) is never POSTed at all, so
  // formData.has(...) is false and the key is omitted entirely from `raw`
  // (NOT passed as `null` — Zod's `.optional()` only treats a missing key as
  // absent, not a `null` value, and formData.get() of a truly-missing key
  // returns `null`, which would otherwise fail validation outright). A
  // rendered-but-empty draft input IS posted (value ''), so the key is present
  // with an empty-string value. The SAME `formData.has(...)` checks drive both
  // the parse input here and the updateEvent input below — one source of truth.
  const raw = {
    name: formData.get('name'),
    event_type: formData.get('event_type'),
    venue_name: formData.get('venue_name'),
    gift_payment_url: formData.get('gift_payment_url') ?? '',
    venue_address: formData.get('venue_address'),
    event_time: formData.get('event_time') ?? '',
    // Checkbox semantics: the input is ALWAYS rendered, so key presence IS the
    // checked state (an unchecked checkbox posts nothing).
    show_meal_pref: formData.has('show_meal_pref'),
    ...(formData.has('event_date')
      ? { event_date: formData.get('event_date') }
      : {}),
    ...(formData.has('rsvp_deadline')
      ? { rsvp_deadline: formData.get('rsvp_deadline') }
      : {}),
  };

  const parsed = updateEventSchema.safeParse(raw);

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

  const { name, event_type, venue_name, venue_address, gift_payment_url, show_meal_pref } = parsed.data;

  // Invitation image (optional). Validated and uploaded BEFORE updateEvent,
  // behind the same org-aware edit gate; the stored PATH is server-derived —
  // the client never controls it.
  let inviteImagePath: string | undefined;
  const inviteImage = formData.get('invite_image');
  if (inviteImage instanceof File && inviteImage.size > 0) {
    if (inviteImage.size > INVITE_IMAGE_MAX_BYTES) {
      return { error: 'תמונת ההזמנה גדולה מדי (עד 5MB).' };
    }
    if (!(inviteImage.type in INVITE_IMAGE_TYPES)) {
      return { error: 'תמונת ההזמנה חייבת להיות JPG, PNG או WebP.' };
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
      return { error: 'העלאת תמונת ההזמנה נכשלה.' };
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
      // No formData.has() dance here: the celebrant group is always rendered,
      // so its inputs are always posted. Only the SUBMITTED type's fields
      // survive (an event_type change replaces the old shape); all-empty →
      // null clears the column.
      celebrants: parseCelebrantsForm(event_type, celebrantsParsed.data),
      ...(formData.has('event_date')
        ? {
            event_date: (() => {
              const d = trimmedOrNull(formData.get('event_date'));
              const t = parsed.data.event_time || '';
              return d ? ilWallTimeToIso(d, t) : d;
            })(),
          }
        : {}),
      ...(formData.has('rsvp_deadline')
        ? { rsvp_deadline: trimmedOrNull(formData.get('rsvp_deadline')) }
        : {}),
    });
  } catch (err) {
    // Re-throw Next.js control-flow signals (redirect / notFound from the
    // ownership gate); catching them would silently break that flow.
    unstable_rethrow(err);
    // The while-campaign-live locks are the guards reachable through ENABLED UI
    // (the form renders these fields) — the user must see the actionable message,
    // not the generic one. Matched by shared consts (never a raw err.message
    // pass-through), so a rewording of the message never breaks this surfacing.
    if (
      err instanceof Error &&
      (err.message === CELEBRANTS_LOCKED_ERROR ||
        err.message === EVENT_TYPE_LOCKED_ERROR ||
        err.message === VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR)
    ) {
      return { error: err.message };
    }
    return { error: 'עדכון האירוע נכשל. נסו שוב.' };
  }

  revalidatePath('/app/events');
  revalidatePath(`/app/events/${eventId}`);
  return { notice: 'האירוע עודכן' };
}
