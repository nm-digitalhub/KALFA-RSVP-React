// One handler per node type, and the dispatch table the ActivityRunnerPort uses.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { RSVP_STATUSES, type RsvpStatus } from '@/lib/constants';

import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  type ConditionField,
  type ConditionOperator,
  type KalfaNodeType,
} from '../catalogue/types';
import type { GuestActionsPort } from '../engine/ports';
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';
import type { NodeExecutionResult } from '../vendor/workflowbuilder/execution-core/ports/activity-runner.port';

// ---------------------------------------------------------------------------
// The trigger payload a run carries
// ---------------------------------------------------------------------------

// What the webhook drain hands a run. Narrow and explicit: the condition node's
// readable fields (CONDITION_FIELDS) are exactly the keys here, so the two
// cannot drift without a type error.
export type WorkflowTriggerPayload = {
  eventId: string;
  contactId: string;
  message_text: string;
  button_payload: string;
};

export type StepContext = {
  trigger: WorkflowTriggerPayload;
  deps: { guests: GuestActionsPort };
};

export type StepHandler = (
  config: Record<string, unknown>,
  ctx: StepContext,
) => Promise<NodeExecutionResult>;

// ---------------------------------------------------------------------------
// Config readers
// ---------------------------------------------------------------------------

// A node's config reached us through the editor and a jsonb column. The property
// SCHEMA constrains what the form can produce; it constrains nothing about what
// is in the row. These readers are the narrowing, and a bad value is a
// PermanentNodeExecutionError — it will fail identically on every retry, so the
// engine must not spend three attempts discovering that.
function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function readEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  nodeType: KalfaNodeType,
): T {
  const value = config[key];
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new PermanentNodeExecutionError(
    'invalid_config',
    `הצעד "${nodeType}" הוגדר עם ערך לא חוקי בשדה "${key}".`,
  );
}

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

// The entry node. It performs no side effect: by the time a run exists the
// message has already arrived and been persisted. Its job is to publish the
// payload as this node's output, so the rest of the graph reads it the same way
// it reads any other node's result.
//
// The `keyword` filter is applied at ENQUEUE time, not here — a run that should
// not have started must not exist at all, rather than start and immediately stop
// (which would leave a run row implying something happened). See
// matchesTrigger in ../trigger.ts.
const whatsappInbound: StepHandler = async (_config, ctx) => ({
  output: {
    message_text: ctx.trigger.message_text,
    button_payload: ctx.trigger.button_payload,
  },
});

// ---------------------------------------------------------------------------
// logic.condition
// ---------------------------------------------------------------------------

export function evaluateCondition(
  field: ConditionField,
  operator: ConditionOperator,
  operand: string,
  trigger: WorkflowTriggerPayload,
): boolean {
  const actual = trigger[field] ?? '';
  switch (operator) {
    case 'contains':
      // Case-insensitive: Hebrew has no case, but a keyword may be Latin
      // ("YES", "ok") and an owner typing one should not have to match the
      // guest's shift key.
      return operand !== '' && actual.toLowerCase().includes(operand.toLowerCase());
    case 'equals':
      return actual.trim() === operand.trim();
    case 'not_equals':
      return actual.trim() !== operand.trim();
    case 'is_empty':
      return actual.trim() === '';
  }
}

// Branches by naming a port. `isEdgeLive` in the runner fires the outgoing edge
// whose `sourceHandle` matches, and prunes the rest — so the editor's two
// branches must be drawn with handles 'true' and 'false'.
//
// Naming a port is a promise of a live route: if no edge carries that handle the
// run ends `incomplete` with a DeadEnd naming this node. That is the intended
// reading — a condition wired to only one branch genuinely has a dead end on the
// other — and it surfaces to the owner instead of passing silently.
const condition: StepHandler = async (config, ctx) => {
  const field = readEnum(config, 'field', CONDITION_FIELDS, 'logic.condition');
  const operator = readEnum(config, 'operator', CONDITION_OPERATORS, 'logic.condition');
  const operand = readString(config, 'value');

  const result = evaluateCondition(field, operator, operand, ctx.trigger);
  return { output: { result }, nextPort: result ? 'true' : 'false' };
};

// ---------------------------------------------------------------------------
// action.update_guest_status
// ---------------------------------------------------------------------------

// The first real side effect, and deliberately one that sends nothing outward:
// it changes a row we own. `send_whatsapp` is the next node, once this chain is
// proven end to end.
const updateGuestStatus: StepHandler = async (config, ctx) => {
  const status: RsvpStatus = readEnum(
    config,
    'status',
    RSVP_STATUSES,
    'action.update_guest_status',
  );

  const guests = await ctx.deps.guests.getGuestsForContact(
    ctx.trigger.eventId,
    ctx.trigger.contactId,
  );

  // ריבוי-אורחים: a phone may back several guests, and "who did this message
  // mean?" has no answer. The inbound webhook refuses to guess (C9 in
  // webhook-processing.ts) and so does this: the same rule, because it is a rule
  // about shared phones, not about which code path arrived at it. Reported as a
  // completed step with `skipped: true` rather than a failure — nothing went
  // wrong, there was simply nothing unambiguous to do.
  if (guests.length !== 1) {
    return {
      output: {
        skipped: true,
        reason: guests.length === 0 ? 'no_guest_for_contact' : 'ambiguous_contact',
        guestCount: guests.length,
      },
    };
  }

  const guest = guests[0]!;

  // Through submit_rsvp, the same atomic gate the public form uses — it enforces
  // token validity, event status and revocation. `attending` requires at least
  // one attendee (the RPC rejects zero), so it defaults to a single adult and
  // the guest refines the count via their link; declined/maybe carry none.
  const outcome = await ctx.deps.guests.submitRsvp(guest.rsvp_token, {
    status,
    adults: status === 'attending' ? 1 : 0,
    kids: 0,
  });

  if (!outcome.ok) {
    // A refused RSVP is a real failure of this step — the owner drew a graph
    // that promised to set a status and it did not get set. Permanent: a
    // revoked token or a closed event will refuse every retry identically.
    throw new PermanentNodeExecutionError(
      'rsvp_rejected',
      `עדכון סטטוס האורח נדחה (${outcome.reason ?? 'לא ידוע'}).`,
    );
  }

  await ctx.deps.guests.recordRsvpFromWhatsapp(ctx.trigger.eventId, guest.id, status);

  return { output: { guestId: guest.id, status } };
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Total over KalfaNodeType: adding a type to the catalogue without a handler is
// a compile error, not a run-time surprise.
export const STEP_HANDLERS: Record<KalfaNodeType, StepHandler> = {
  'trigger.whatsapp_inbound': whatsappInbound,
  'logic.condition': condition,
  'action.update_guest_status': updateGuestStatus,
};
