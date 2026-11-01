'use server';

import {
  findEventsForSupport,
  getEventForSupportView,
  listGuestsForSupportView,
  type SupportEventView,
  type SupportGuestView,
} from '@/lib/data/admin/support';
import { actionClient } from '@/lib/safe-action';
import { supportFindSchema, supportViewSchema } from '@/lib/validation/admin';

// Server actions backing the /admin/support READ-ONLY customer-support surface.
// Both actions re-gate via the data layer (requirePlatformPermission —
// belt-and-suspenders on top of the page's own gate). Neither action ever
// calls .update()/.insert()/.delete() on a customer table —
// findSupportEventsAction resolves candidates and viewSupportEventAction returns
// the event dossier; both are reason-required and audited in the data layer.
// A failure is the action client's: the data layer's Hebrew message reaches the
// screen, anything else becomes the generic one.

export const findSupportEventsAction = actionClient
  .inputSchema(supportFindSchema)
  .action(async ({ parsedInput }) =>
    findEventsForSupport(
      {
        eventId: parsedInput.event_id || undefined,
        ownerPhone: parsedInput.owner_phone || undefined,
        ownerEmail: parsedInput.owner_email || undefined,
      },
      parsedInput.reason,
    ),
  );

export interface SupportEventDossier {
  event: SupportEventView;
  guests: SupportGuestView[];
}

export const viewSupportEventAction = actionClient
  .inputSchema(supportViewSchema)
  .action(async ({ parsedInput: { event_id, reason } }): Promise<SupportEventDossier> => {
    const event = await getEventForSupportView(event_id, reason);
    const guests = await listGuestsForSupportView(event_id, reason);
    return { event, guests };
  });
