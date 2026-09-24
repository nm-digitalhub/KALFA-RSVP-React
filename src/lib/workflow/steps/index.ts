// The dispatch table the ActivityRunnerPort uses, and the handlers of the node
// types that have not yet moved to `nodes/<name>/runtime.ts`.
//
// A handler is a pure function of (config, trigger payload, deps). It performs
// its own side effect through the narrow GuestActionsPort and returns a
// NodeExecutionResult. It never claims its own ledger row — that happens one
// layer up, in activity-runner.ts, so the claim/side-effect ordering is written
// once rather than in every handler.
import { SUMIT_HOLDS_FOLDER_ID, sumitHoldCurrencyLabel, sumitHoldStatusLabel } from '@/lib/sumit/hold-status';

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

export type { StepContext, StepHandler, WorkflowTriggerPayload };

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

// An external system calls in and a run starts.
//
// The DYNAMIC trigger: it declares no field list. Whatever JSON the caller sent
// is published as this node's output and is readable anywhere as
// `{{trigger.body.<path>}}`. A new caller with a different shape needs no code
// change, no migration and no new node type — which is the difference between
// this and every other trigger a workflow tool hard-codes.
//
// It performs no side effect. By the time a run exists the request has already
// been received, authenticated by its token and persisted as the trigger payload.
const webhookTrigger: StepHandler = async (_config, ctx) => ({
  output: {
    body: ctx.trigger.body ?? {},
    // ⚠️ PUBLISHED SEPARATELY, AND IT HAS TO BE RETURNED HERE TOO. The query
    // string was added to the trigger payload and to this node's outputSchema on
    // 2026-09-22 — but not to this return, so `{{nodes.<trigger>.query.x}}`
    // resolved to nothing while the picker happily offered it. A declaration is
    // a promise the HANDLER keeps; declaring without returning is the same class
    // of defect as returning without declaring, and the same gate now catches
    // both.
    query: ctx.trigger.query ?? {},
  },
});

// ---------------------------------------------------------------------------
// trigger.sumit_card
// ---------------------------------------------------------------------------

// SUMIT's trigger module told us a card changed. Like every trigger it performs
// no side effect — it publishes what arrived, under names a later step can pick.
//
// The shape is SUMIT's own, as its "פעולות אוטומציה" log shows it:
//
//   { "Folder": 440486517, "EntityID": 632049688, "Type": "CreateOrUpdate",
//     "Properties": { "Billing_Amount": [11.8], "Billing_PaymentSource":
//       [{ "Version": 1, "Status": 0, "SchemaID": …, "ID": …, "Name": "…" }], … } }
//
// Every property is an ARRAY. REFERENCE properties hold objects with a `Name`;
// ENUM properties hold the bare code — measured on this account's live
// releases, `Billing_Status: [3]`, `Billing_Currency: [1]`. Which properties
// arrive is decided by the columns of the VIEW the owner chose in SUMIT. `resolveTemplate` walks a dotted path through arrays as
// well as objects, so `{{nodes.<id>.properties.Billing_Amount.0}}` reaches the
// first element with no flattening of ours.
//
// ⚠️ `null`, NEVER `undefined`, FOR ANYTHING MISSING. A plain `{{…}}` reference
// THROWS on `undefined` and resolves `null` to the text "null" — so a body with a
// field absent cannot fail every step that quotes it. The payload is UNSIGNED,
// which is also why nothing here trusts its types: whatever is not the expected
// shape becomes null rather than a crash.
const sumitCardTrigger: StepHandler = async (_config, ctx) => {
  const body = ctx.trigger.body ?? {};
  const scalar = (value: unknown): string | number | null =>
    typeof value === 'string' || typeof value === 'number' ? value : null;
  const rawProperties = body.Properties;
  // NAMES for the enum codes SUMIT sends bare — only for the frame-holds folder,
  // whose codes we have evidence for; the same `Billing_*` code may mean
  // something else in another folder. `null` otherwise (see the rule above).
  const holdProperties =
    Number(body.Folder) === SUMIT_HOLDS_FOLDER_ID && rawProperties && typeof rawProperties === 'object'
      ? (rawProperties as { Billing_Status?: unknown[]; Billing_Currency?: unknown[] })
      : null;

  return {
    output: {
      folder: scalar(body.Folder),
      entityId: scalar(body.EntityID),
      changeType: typeof body.Type === 'string' ? body.Type : null,
      properties:
        rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
          ? rawProperties
          : {},
      // The whole of it as well, for a field this node does not name.
      body,
      holdStatus: holdProperties ? sumitHoldStatusLabel(holdProperties.Billing_Status?.[0]) : null,
      holdCurrency: holdProperties ? sumitHoldCurrencyLabel(holdProperties.Billing_Currency?.[0]) : null,
    },
  };
};

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
  'trigger.webhook': webhookTrigger,
  [scheduleDefinition.type]: scheduleTrigger,
  'trigger.sumit_card': sumitCardTrigger,
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
