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
import { submitRsvp } from '@/lib/data/rsvp';

import type { GuestActionsPort } from './engine/ports';

export function createGuestActions(): GuestActionsPort {
  return {
    async getGuestsForContact(eventId, contactId) {
      // `full_name` is dropped here deliberately: the port's shape is the whole
      // set of guest data a step handler can reach, and a handler has no reason
      // to hold a name.
      const guests = await getGuestsForContact(eventId, contactId);
      return guests.map((g) => ({ id: g.id, rsvp_token: g.rsvp_token }));
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
