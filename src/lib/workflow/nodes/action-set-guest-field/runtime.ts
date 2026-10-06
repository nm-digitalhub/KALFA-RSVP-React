// `action.set_guest_field` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from `steps/index`
// (the registry imports this file, so that would be a cycle).
import { readEnum, readString, requireGuestContext, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as setGuestFieldDefinition from './definition';
import { GUEST_FIELDS, type SetGuestFieldConfig } from './definition';

// Write ONE field on the guest behind this run's contact.
//
// The narrowest possible write, and that is the design: `GUEST_FIELDS` names the
// three columns a workflow may touch, and status and the headcount are not among
// them — they belong to `submit_rsvp`, which keeps their numbers consistent with
// each other.
//
// ריבוי-אורחים: a phone may back several guests, and "whose meal preference?" has
// no answer. Reported as a COMPLETED step with `skipped: true`, not a failure —
// the same shape `action.update_guest_status` uses, because nothing went wrong
// and there was simply nothing unambiguous to do.
export const setGuestField: StepHandler = async (config, ctx) => {
  const field = readEnum(config, 'field', GUEST_FIELDS, setGuestFieldDefinition.type);
  // Already resolved: `resolveConfigTemplates` walked the config first, so this
  // can legitimately be the guest's own words via `{{trigger.message_text}}`.
  //
  // The key is checked against SetGuestFieldConfig at compile time; the value is
  // still read defensively, because the config is an unvalidated jsonb row.
  const value = readString<SetGuestFieldConfig>(config, 'value');

  const write = ctx.deps.guests.setGuestField;
  if (!write) {
    // A port that predates the node. Fail CLOSED and loudly rather than
    // reporting a write that never happened as success.
    throw new PermanentNodeExecutionError(
      'unsupported',
      'עדכון שדה אורח אינו זמין בהרצה הזו.',
    );
  }

  const guest = requireGuestContext(ctx, setGuestFieldDefinition.type);
  const result = await write({
    eventId: guest.eventId,
    contactId: guest.contactId,
    field,
    value,
  });

  return result.ok
    ? { output: { updated: true, field, guestId: result.guestId ?? null } }
    : {
        output: { updated: false, skipped: true, field, reason: result.reason ?? null },
      };
};
