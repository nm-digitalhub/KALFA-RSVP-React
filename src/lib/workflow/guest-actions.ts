import 'server-only';

// GuestActionsPort over the functions that already exist.
//
// Every operation here is a call into an existing module, never a new query. The
// RSVP write in particular goes through `submitRsvp` — the same atomic
// `submit_rsvp` RPC the public form and the inbound webhook use — so token
// validity, event status and revocation are enforced by the one gate rather than
// re-implemented for automation. A workflow can do nothing to a guest that a
// person could not already do through a supported path.
import { getGuestsForContact, recordRsvpFromWhatsapp } from '@/lib/data/interactions';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { submitRsvp } from '@/lib/data/rsvp';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/whatsapp/client';

import type { GuestActionsPort } from './engine/ports';
import { dispatchWorkflowRsvpAiCallback } from './voice-agent-actions';

export function createGuestActions(): GuestActionsPort {
  return {
    async startRsvpAiCallback(input) {
      return dispatchWorkflowRsvpAiCallback(input);
    },

    async getGuestsForContact(eventId, contactId) {
      // `full_name` is dropped here deliberately: the port's shape is the whole
      // set of guest data a step handler can reach, and a handler has no reason
      // to hold a name.
      const guests = await getGuestsForContact(eventId, contactId);
      return guests.map((g) => ({ id: g.id, rsvp_token: g.rsvp_token }));
    },

    async sendWhatsAppReply(contactId, body) {
      // Three reasons a send does not happen, each named rather than thrown:
      // the handler reports them as a completed-but-skipped step so the owner
      // reads WHY in the run log instead of seeing a bare failure.
      const config = await getWhatsAppConfig();
      if (!config) return { ok: false, reason: 'whatsapp_not_configured' };

      const { data } = await createAdminClient()
        .from('contacts')
        .select('normalized_phone')
        .eq('id', contactId)
        .maybeSingle();
      const phone = data?.normalized_phone;
      if (!phone) return { ok: false, reason: 'no_phone_for_contact' };

      const outcome = await sendWhatsAppText(config, { to: phone, body });
      // `sendWhatsAppText` classifies rather than throws, so the delivery
      // verdict arrives as a value. 'accepted' is Meta taking the message —
      // not delivery, and never read receipt.
      return outcome.kind === 'accepted'
        ? { ok: true }
        : { ok: false, reason: outcome.kind };
    },

    async submitRsvp(token, input) {
      const outcome = await submitRsvp(token, {
        status: input.status,
        adults: input.adults,
        kids: input.kids,
      });
      // `unchanged: true` is still `ok` — the RPC is idempotent, and setting the
      // same status twice really is success. That property is what makes this
      // action safe to replay after a lease reclaim (see STEP_LEASE_MS).
      return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
    },

    recordRsvpFromWhatsapp,
  };
}
