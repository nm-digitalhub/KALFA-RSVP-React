'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { CELEBRANTS_LOCKED_ERROR, updateEvent } from '@/lib/data/events';
import {
  celebrantsSchemaFor,
  parseCelebrantsForm,
  updateEventSchema,
} from '@/lib/validation/schemas';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';

// All six possible celebrant inputs across the four kinds (plain named inputs,
// e.g. `celebrants.groom`). The submitted event_type's schema keeps only its
// own kind's fields (z.object strips unknown keys). A missing key maps to
// undefined (accepted by the optional fields) — defensive only; the celebrant
// group is always rendered, so the current kind's inputs are always posted.
function readCelebrantsForm(formData: FormData) {
  return {
    groom: formData.get('celebrants.groom') ?? undefined,
    bride: formData.get('celebrants.bride') ?? undefined,
    name: formData.get('celebrants.name') ?? undefined,
    parents: formData.get('celebrants.parents') ?? undefined,
    child: formData.get('celebrants.child') ?? undefined,
    names: formData.get('celebrants.names') ?? undefined,
  };
}

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
    venue_address: formData.get('venue_address'),
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

  const { name, event_type, venue_name, venue_address } = parsed.data;

  try {
    await updateEvent(eventId, {
      name,
      event_type,
      venue_name: venue_name ? venue_name : null,
      venue_address: venue_address ? venue_address : null,
      // No formData.has() dance here: the celebrant group is always rendered,
      // so its inputs are always posted. Only the SUBMITTED type's fields
      // survive (an event_type change replaces the old shape); all-empty →
      // null clears the column.
      celebrants: parseCelebrantsForm(event_type, celebrantsParsed.data),
      ...(formData.has('event_date')
        ? { event_date: trimmedOrNull(formData.get('event_date')) }
        : {}),
      ...(formData.has('rsvp_deadline')
        ? { rsvp_deadline: trimmedOrNull(formData.get('rsvp_deadline')) }
        : {}),
    });
  } catch (err) {
    // Re-throw Next.js control-flow signals (redirect / notFound from the
    // ownership gate); catching them would silently break that flow.
    unstable_rethrow(err);
    // The celebrants lock is the one guard reachable through ENABLED UI — the
    // user must see the actionable message, not the generic one. Matched by
    // the shared const (never a raw err.message pass-through).
    if (err instanceof Error && err.message === CELEBRANTS_LOCKED_ERROR) {
      return { error: err.message };
    }
    return { error: 'עדכון האירוע נכשל. נסו שוב.' };
  }

  revalidatePath('/app/events');
  revalidatePath(`/app/events/${eventId}`);
  return { notice: 'האירוע עודכן' };
}
