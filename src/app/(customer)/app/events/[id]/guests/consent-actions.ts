'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { actionClient, returnUserError } from '@/lib/safe-action';
import { requireEventAccess } from '@/lib/data/events';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { recordCallConsent } from '@/lib/data/contacts';
import { logActivity } from '@/lib/data/activity';

// B1 — owner/admin per-contact grant of CALL consent (the SECONDARY capture
// surface; the primary is the public RSVP self-service opt-in). Attests that
// lawful call consent was obtained out-of-band for this contact. Inert until
// outreach is enabled. Authorization is enforced server-side via
// requireEventAccess (notFound() on deny); the write itself is service-role
// (contacts has no owner UPDATE policy) and scoped by (id, event_id) in
// recordCallConsent. Records a PII-free audit row — closing the gap the WhatsApp
// consent precedent leaves open. Never clears removal_requested / DNC.

const grantSchema = z.object({
  eventId: z.uuid({ error: 'מזהה לא תקין' }),
  contactId: z.uuid({ error: 'מזהה לא תקין' }),
});

export const grantCallConsentAction = actionClient
  .inputSchema(grantSchema)
  .action(async ({ parsedInput: { eventId, contactId } }) => {
    // Any failure on the way is 'שמירת ההסכמה נכשלה'; outreach being off answers
    // with its own message, after the try (a returnUserError inside it would be
    // caught and replaced).
    let outreachEnabled: boolean;
    try {
      // Authorize FIRST (requireUser + can_access_event; notFound() on deny).
      await requireEventAccess(eventId, 'contacts', 'edit');
      outreachEnabled = await getOutreachEnabled();
      if (outreachEnabled) {
        await recordCallConsent(eventId, contactId);
        await logActivity({
          eventId,
          action: 'consent.call.granted',
          meta: { contactId }, // ids only — no PII
        });
      }
    } catch (err) {
      unstable_rethrow(err); // let notFound()/redirect propagate
      returnUserError('שמירת ההסכמה נכשלה');
    }
    if (!outreachEnabled) returnUserError('פנייה לאורחים אינה מופעלת');

    revalidatePath(`/app/events/${eventId}/guests`);
    return { ok: true };
  });
