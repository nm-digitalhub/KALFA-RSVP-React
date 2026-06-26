'use server';

import { revalidatePath } from 'next/cache';

import { updateEvent } from '@/lib/data/events';
import { updateEventSchema } from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

// `eventId` is bound from the route segment (server-side), NOT submitted by the
// browser. Authorization is enforced again inside updateEvent via the ownership
// gate, so a tampered id can never edit another owner's event.
export async function updateEventAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateEventSchema.safeParse({
    name: formData.get('name'),
    event_type: formData.get('event_type'),
    event_date: formData.get('event_date'),
    venue_name: formData.get('venue_name'),
    venue_address: formData.get('venue_address'),
    rsvp_deadline: formData.get('rsvp_deadline'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const {
    name,
    event_type,
    event_date,
    venue_name,
    venue_address,
    rsvp_deadline,
    status,
  } = parsed.data;

  try {
    await updateEvent(eventId, {
      name,
      event_type,
      event_date: event_date ? event_date : null,
      venue_name: venue_name ? venue_name : null,
      venue_address: venue_address ? venue_address : null,
      rsvp_deadline: rsvp_deadline ? rsvp_deadline : null,
      status,
    });
  } catch (err) {
    // Re-throw Next.js control-flow signals (redirect / notFound from the
    // ownership gate); catching them would silently break that flow.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
        (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
    ) {
      throw err;
    }
    return { error: 'עדכון האירוע נכשל. נסו שוב.' };
  }

  revalidatePath('/app/events');
  revalidatePath(`/app/events/${eventId}`);
  return { notice: 'האירוע עודכן' };
}
