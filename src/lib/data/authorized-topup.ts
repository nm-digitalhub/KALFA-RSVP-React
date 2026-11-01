import 'server-only';

import { deriveContacts } from '@/lib/data/derive-contacts';
import { fillAuthorizedSet } from '@/lib/data/authorized-fill';
import { createAdminClient } from '@/lib/supabase/admin';

// The worker's repair of a package campaign's outreach list (package-outreach-admission-safety, design D2), run on
// every arm tick before seedOutreachState. A guest normally reaches the list the moment it is added
// (reconcileCampaignSetForContact); this brings in any guest that did not — a contact link that failed, an admission
// that failed or was switched off — in order of addition and within the quota. It reads no switch.
//
// Request-free (admin client): the worker has no user session, which is why buildContactsForEvent and linkGuestContact
// (both behind requireEventAccess) cannot serve it.

// Links the event's guests that have a valid phone but no contact: upserts each phone's contact (UNIQUE event_id +
// normalized_phone, so idempotent) and sets guests.contact_id — only where it is still null, so it never clears or
// replaces a link. A guest without a valid phone stays unlinked. Returns how many guests it linked.
export async function repairGuestContactLinks(eventId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: guests, error } = await admin
    .from('guests')
    .select('id, phone')
    .eq('event_id', eventId)
    .is('contact_id', null)
    .order('seq', { ascending: true });
  if (error) throw new Error('טעינת המוזמנים ללא איש קשר נכשלה', { cause: error });

  const derived = deriveContacts(guests ?? []);
  if (derived.uniquePhones.length === 0) return 0;

  const phoneToContactId = new Map<string, string>();
  for (const phone of derived.uniquePhones) {
    const { data: row, error: upErr } = await admin
      .from('contacts')
      .upsert({ event_id: eventId, normalized_phone: phone }, { onConflict: 'event_id,normalized_phone' })
      .select('id')
      .single();
    if (upErr || !row) throw new Error('יצירת איש הקשר נכשלה', { cause: upErr });
    phoneToContactId.set(phone, row.id);
  }

  let linked = 0;
  for (const [guestId, e164] of derived.guestToPhone) {
    const contactId = e164 ? phoneToContactId.get(e164) : undefined;
    if (!contactId) continue;
    const { error: linkErr } = await admin
      .from('guests')
      .update({ contact_id: contactId })
      .eq('id', guestId)
      .eq('event_id', eventId)
      .is('contact_id', null);
    if (linkErr) throw new Error('קישור המוזמן לאיש הקשר נכשל', { cause: linkErr });
    linked++;
  }
  return linked;
}

// One arm-tick repair of a running package campaign: the links, then the fill (fill_authorized_set, actor
// 'arm_topup'), which admits the waiting guests by order of addition up to the quota. Each step is logged and the
// next one still runs when it fails; it never throws, so a failure does not stop the tick (ids only, no guest data).
export async function topUpPackageList(eventId: string, campaignId: string): Promise<void> {
  try {
    await repairGuestContactLinks(eventId);
  } catch (err) {
    console.error(
      `[arm-topup] link repair failed (event=${eventId} campaign=${campaignId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await fillAuthorizedSet(eventId, campaignId, 'arm_topup');
  } catch (err) {
    console.error(
      `[arm-topup] fill failed (event=${eventId} campaign=${campaignId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
