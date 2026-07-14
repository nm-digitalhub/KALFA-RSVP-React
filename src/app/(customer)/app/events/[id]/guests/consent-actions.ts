'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

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

export type GrantCallConsentResult = { ok: true } | { ok: false; error: string };

const grantSchema = z.object({ eventId: z.uuid(), contactId: z.uuid() });

export async function grantCallConsentAction(
  eventId: string,
  contactId: string,
): Promise<GrantCallConsentResult> {
  const parsed = grantSchema.safeParse({ eventId, contactId });
  if (!parsed.success) {
    return { ok: false, error: 'מזהה לא תקין' };
  }

  try {
    // Authorize FIRST (requireUser + can_access_event; notFound() on deny).
    await requireEventAccess(parsed.data.eventId, 'contacts', 'edit');
    if (!(await getOutreachEnabled())) {
      return { ok: false, error: 'פנייה לאורחים אינה מופעלת' };
    }
    await recordCallConsent(parsed.data.eventId, parsed.data.contactId);
    await logActivity({
      eventId: parsed.data.eventId,
      action: 'consent.call.granted',
      meta: { contactId: parsed.data.contactId }, // ids only — no PII
    });
  } catch (err) {
    unstable_rethrow(err); // let notFound()/redirect propagate
    return { ok: false, error: 'שמירת ההסכמה נכשלה' };
  }

  revalidatePath(`/app/events/${parsed.data.eventId}/guests`);
  return { ok: true };
}
