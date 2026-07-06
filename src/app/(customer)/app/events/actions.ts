'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createEvent } from '@/lib/data/events';
import {
  celebrantsSchemaFor,
  createEventSchema,
  parseCelebrantsForm,
} from '@/lib/validation/schemas';
import { issuesToFieldErrors, type FormState } from '@/lib/validation/result';
import { ilWallTimeToIso } from '@/lib/data/event-date';

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

  const { name, event_type, event_date, event_time, venue_name } = parsed.data;

  let newEvent: Awaited<ReturnType<typeof createEvent>>;
  try {
    newEvent = await createEvent({
      name,
      event_type,
      event_date: event_date ? ilWallTimeToIso(event_date, event_time || '') : null,
      venue_name: venue_name ? venue_name : null,
      // Only the submitted type's fields survive; all-empty → null (SQL NULL).
      celebrants: parseCelebrantsForm(event_type, celebrantsParsed.data),
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת האירוע נכשלה. נסו שוב.' };
  }

  revalidatePath('/app/events');
  redirect(`/app/events/${newEvent.id}`);
}
