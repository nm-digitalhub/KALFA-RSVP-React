import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The "seat" gate of the contact-quota package model (plan
// docs/superpowers/plans/2026-09-30-contact-quota-package.md §4.1, step 2).
//
// A campaign with a quota may approach only the contacts that hold a seat, and a
// seat is membership of the campaign's authorized list (campaign_authorized_contacts).
// The list itself is what the campaign send path and the outreach engine already read, so
// they need no check. This function is for every path that does NOT go through that list:
// workflow template sends and AI calls.
//
// A campaign WITHOUT a quota (contact_quota IS NULL) is not subject to the model at all:
// everything is allowed, which is what every campaign does today.
//
// Service-role + request-free: it runs from the pg-boss worker as well as from the web
// tier, so it must not touch cookies or a user session. The CALLER authorizes the contact.

export type SeatCheck = { allowed: true } | { allowed: false; reason: 'waiting_for_quota' };

/**
 * May this campaign approach this contact?
 *
 * Throws on a real read error, like the other worker-side reads (a transient database
 * failure must retry, not silently allow or silently refuse).
 */
export async function checkContactSeat(campaignId: string, contactId: string): Promise<SeatCheck> {
  const admin = createAdminClient();

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('contact_quota')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('בדיקת מכסת אנשי הקשר נכשלה');
  // No such campaign, or no quota: the package model does not apply here.
  if (!campaign || campaign.contact_quota === null) return { allowed: true };

  const { data: seat, error: seatError } = await admin
    .from('campaign_authorized_contacts')
    .select('contact_id')
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .limit(1)
    .maybeSingle();
  if (seatError) throw new Error('בדיקת מכסת אנשי הקשר נכשלה');

  return seat ? { allowed: true } : { allowed: false, reason: 'waiting_for_quota' };
}
