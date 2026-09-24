// The dispatch table the ActivityRunnerPort uses, and the handlers of the node
// types that have not yet moved to `nodes/<name>/runtime.ts`.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { type KalfaNodeType } from '../catalogue/types';

// The shared step contract lives in ./shared so node runtimes can import it
// without importing this registry. Re-exported for every existing caller.
import {
  type StepContext,
  type StepHandler,
  type WorkflowTriggerPayload,
} from './shared';
import * as aiAgentDefinition from '../nodes/action-ai-agent/definition';
import { aiAgent } from '../nodes/action-ai-agent/runtime';
import * as callbackRequestDefinition from '../nodes/action-create-callback-request/definition';
import { createCallbackRequest } from '../nodes/action-create-callback-request/runtime';
import * as importGuestListDefinition from '../nodes/action-import-guest-list/definition';
import { importGuestList } from '../nodes/action-import-guest-list/runtime';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import { microsoftSendEmail } from '../nodes/action-microsoft-send-email/runtime';
import * as notifyTeamDefinition from '../nodes/action-notify-team/definition';
import { notifyTeam } from '../nodes/action-notify-team/runtime';
import * as sendTemplateDefinition from '../nodes/action-send-template/definition';
import { sendTemplate } from '../nodes/action-send-template/runtime';
import * as sendWhatsappDefinition from '../nodes/action-send-whatsapp/definition';
import { sendWhatsapp } from '../nodes/action-send-whatsapp/runtime';
import * as setGuestFieldDefinition from '../nodes/action-set-guest-field/definition';
import { setGuestField } from '../nodes/action-set-guest-field/runtime';
import * as startForEachGuestDefinition from '../nodes/action-start-for-each-guest/definition';
import { startForEachGuest } from '../nodes/action-start-for-each-guest/runtime';
import * as startRsvpAiCallbackDefinition from '../nodes/action-start-rsvp-ai-callback/definition';
import { startRsvpAiCallback } from '../nodes/action-start-rsvp-ai-callback/runtime';
import * as startVoiceCallDefinition from '../nodes/action-start-voice-call/definition';
import { startVoiceCall } from '../nodes/action-start-voice-call/runtime';
import * as sumitCreateCustomerDefinition from '../nodes/action-sumit-create-customer/definition';
import { sumitCreateCustomer } from '../nodes/action-sumit-create-customer/runtime';
import * as sumitCreateDocumentDefinition from '../nodes/action-sumit-create-document/definition';
import { sumitCreateDocument } from '../nodes/action-sumit-create-document/runtime';
import * as updateGuestStatusDefinition from '../nodes/action-update-guest-status/definition';
import { updateGuestStatus } from '../nodes/action-update-guest-status/runtime';
import * as webhookDefinition from '../nodes/action-webhook/definition';
import { webhook } from '../nodes/action-webhook/runtime';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import { condition } from '../nodes/logic-condition/runtime';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import { setValue } from '../nodes/logic-set-value/runtime';
import * as switchDefinition from '../nodes/logic-switch/definition';
import { switchNode } from '../nodes/logic-switch/runtime';
import * as waitDefinition from '../nodes/logic-wait/definition';
import { waitNode } from '../nodes/logic-wait/runtime';
import * as scheduleDefinition from '../nodes/trigger-schedule/definition';
import { scheduleTrigger } from '../nodes/trigger-schedule/runtime';
import * as sumitCardTriggerDefinition from '../nodes/trigger-sumit-card/definition';
import { sumitCardTrigger } from '../nodes/trigger-sumit-card/runtime';
import * as webhookTriggerDefinition from '../nodes/trigger-webhook/definition';
import { webhookTrigger } from '../nodes/trigger-webhook/runtime';

export type { StepContext, StepHandler, WorkflowTriggerPayload };

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

// The handler lives in `nodes/trigger-webhook/runtime.ts`.

// ---------------------------------------------------------------------------
// trigger.sumit_card
// ---------------------------------------------------------------------------

// The handler lives in `nodes/trigger-sumit-card/runtime.ts`.

// ---------------------------------------------------------------------------
// trigger.schedule
// ---------------------------------------------------------------------------

// The handler lives in `nodes/trigger-schedule/runtime.ts`.

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
// logic.switch
// ---------------------------------------------------------------------------

// The handler and its branch evaluators live in `nodes/logic-switch/runtime.ts`.
// The evaluators are re-exported for every existing caller of this module.
export { evaluateSwitchBranch, evaluateSwitchCondition } from '../nodes/logic-switch/runtime';

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Total over KalfaNodeType: adding a type to the catalogue without a handler is
// a compile error, not a run-time surprise.
// ---------------------------------------------------------------------------
// logic.wait — the run parks here and comes back later
// ---------------------------------------------------------------------------

// The handler, its units and its ceiling live in `nodes/logic-wait/runtime.ts`.
// The park signal is shared engine code — see ../engine/wait-signal.ts.
// Re-exported for every existing caller of this module.
export { WORKFLOW_WAIT_CODE, WorkflowWaitSignal, readWaitSignal, type WaitVerifier } from '../engine/wait-signal';

// ---------------------------------------------------------------------------
// action.start_for_each_guest
// ---------------------------------------------------------------------------

// The handler, and the depth cap it enforces, live in
// `nodes/action-start-for-each-guest/`.

export const STEP_HANDLERS: Record<KalfaNodeType, StepHandler> = {
  'trigger.whatsapp_inbound': whatsappInbound,
  [webhookTriggerDefinition.type]: webhookTrigger,
  [scheduleDefinition.type]: scheduleTrigger,
  [sumitCardTriggerDefinition.type]: sumitCardTrigger,
  [conditionDefinition.type]: condition,
  [switchDefinition.type]: switchNode,
  [updateGuestStatusDefinition.type]: updateGuestStatus,
  [sendWhatsappDefinition.type]: sendWhatsapp,
  [microsoftSendEmailDefinition.type]: microsoftSendEmail,
  [startRsvpAiCallbackDefinition.type]: startRsvpAiCallback,
  [startVoiceCallDefinition.type]: startVoiceCall,
  [notifyTeamDefinition.type]: notifyTeam,
  [webhookDefinition.type]: webhook,
  [setGuestFieldDefinition.type]: setGuestField,
  [callbackRequestDefinition.type]: createCallbackRequest,
  [importGuestListDefinition.type]: importGuestList,
  [waitDefinition.type]: waitNode,
  [sendTemplateDefinition.type]: sendTemplate,
  [startForEachGuestDefinition.type]: startForEachGuest,
  [setValueDefinition.type]: setValue,
  [sumitCreateDocumentDefinition.type]: sumitCreateDocument,
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomer,
  [aiAgentDefinition.type]: aiAgent,
};
