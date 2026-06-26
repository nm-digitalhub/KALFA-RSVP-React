'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createEvent } from '@/lib/data/events';
import { createEventSchema } from '@/lib/validation/schemas';
import type { FormState } from '@/lib/validation/result';

export async function createEventAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createEventSchema.safeParse({
    name: formData.get('name'),
    event_type: formData.get('event_type'),
    event_date: formData.get('event_date'),
    venue_name: formData.get('venue_name'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { name, event_type, event_date, venue_name } = parsed.data;

  let newEvent: Awaited<ReturnType<typeof createEvent>>;
  try {
    newEvent = await createEvent({
      name,
      event_type,
      event_date: event_date ? event_date : null,
      venue_name: venue_name ? venue_name : null,
    });
  } catch (err) {
    // Re-throw Next.js control-flow signals (e.g. redirect from requireUser);
    // catching them would silently break the redirect.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
    return { error: 'יצירת האירוע נכשלה. נסו שוב.' };
  }

  revalidatePath('/app/events');
  redirect(`/app/events/${newEvent.id}`);
}
