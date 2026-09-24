// `action.start_rsvp_ai_callback` — the step handler. Server side: SDK-free, and
// it imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { requireGuestContext, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as startRsvpAiCallbackDefinition from './definition';

// Starts the existing RSVP voice agent for this run's guest, through the
// dispatcher on `GuestActionsPort`. The node has no configuration of its own —
// the agent, provider, model and knowledge base live outside the diagram — so
// the config is not read.
export const startRsvpAiCallback: StepHandler = async (_config, ctx) => {
  const dispatch = ctx.deps.guests.startRsvpAiCallback;
  if (!dispatch) {
    throw new PermanentNodeExecutionError(
      'voice_agent_not_wired',
      'צומת סוכן הקול אינו מחובר למימוש השרת.',
    );
  }

  const guest = requireGuestContext(ctx, startRsvpAiCallbackDefinition.type);
  const outcome = await dispatch({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId: guest.eventId,
    contactId: guest.contactId,
  });

  if (!outcome.ok) {
    throw new PermanentNodeExecutionError(
      'voice_agent_dispatch_refused',
      `הפעלת שיחת הסוכן נדחתה (${outcome.reason ?? outcome.status}).`,
    );
  }

  return {
    output: {
      started: true,
      status: outcome.status,
      ...(outcome.attemptId ? { attemptId: outcome.attemptId } : {}),
      ...(outcome.callSessionHistoryId !== undefined
        ? { callSessionHistoryId: outcome.callSessionHistoryId }
        : {}),
    },
  };
};
