'use client';

// The editor's half of the catalogue: the palette. What each node type looks
// like in the palette and in the properties panel is declared in its node
// folder's editor files (`nodes/<name>/`); this module assembles them into
// `PALETTE_ITEMS` and fills the live lists in (`buildPaletteItems`).
//
// CLIENT ONLY. `sharedProperties` and `getScope` are runtime values, so this
// module loads @workflowbuilder/sdk — and with it the module-level
// `immer.setAutoFreeze(false)` and `i18next.init`. The worker reads ./nodes.ts,
// which imports nothing.
//
// Written against the SDK's own vocabulary, verified against
// `dist/index.d.ts` and against how the reference app's own nodes are built
// (apps/demo/src/app/data/nodes/delay/{schema,uischema,select-options}.ts):
//
//   * `...sharedProperties` supplies `label` and `description`, which
//     `NodePropertiesSchema` REQUIRES on every node. Hand-rolling them and
//     omitting `description` is a contract violation that only a `satisfies`
//     catches.
//   * A select is `options: [{ label, value, icon? }]` on the FIELD, plus
//     `{ type: 'Select', scope }` in the uischema. There is no `oneOf`, no
//     `enum`, and no `title` in `FieldSchema` — those are generic JSONForms
//     conventions this SDK does not use.
//   * Visible text lives in the UISCHEMA (`label`, `placeholder`, and
//     `{ type: 'Label', text }`), never in the JSON schema.
//   * Scopes come from `getScope<Schema>('properties.x')` — a typed path, not a
//     hand-written `#/properties/x` string.
//
// Every entry ends in `satisfies NodeSchema` / typed as `PaletteItem`, so a
// mistake here is a compile error rather than an empty properties panel.
import type { PaletteItem, UISchema } from '@workflowbuilder/sdk';

import { NODE_RUN_FORMAT } from './ui-formats';

import { aiAgentPaletteItem } from '../nodes/action-ai-agent/action-ai-agent';
import { callbackRequestPaletteItem } from '../nodes/action-create-callback-request/action-create-callback-request';
import { importGuestListPaletteItem } from '../nodes/action-import-guest-list/action-import-guest-list';
import { microsoftSendEmailPaletteItem } from '../nodes/action-microsoft-send-email/action-microsoft-send-email';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import {
  microsoftSendEmailSchemaFor,
  type MicrosoftConnectionOption,
} from '../nodes/action-microsoft-send-email/schema';
import { notifyTeamPaletteItem } from '../nodes/action-notify-team/action-notify-team';
import { sendTemplatePaletteItem } from '../nodes/action-send-template/action-send-template';
import { sendWhatsappPaletteItem } from '../nodes/action-send-whatsapp/action-send-whatsapp';
import { setGuestFieldPaletteItem } from '../nodes/action-set-guest-field/action-set-guest-field';
import { forEachGuestPaletteItem } from '../nodes/action-start-for-each-guest/action-start-for-each-guest';
import { startRsvpAiCallbackPaletteItem } from '../nodes/action-start-rsvp-ai-callback/action-start-rsvp-ai-callback';
import { voiceCallPaletteItem } from '../nodes/action-start-voice-call/action-start-voice-call';
import * as startVoiceCallDefinition from '../nodes/action-start-voice-call/definition';
import {
  voiceCallSchemaFor,
  type VoiceDialOption,
  type VoicePurposeOption,
} from '../nodes/action-start-voice-call/schema';
import { sumitCreateCustomerPaletteItem } from '../nodes/action-sumit-create-customer/action-sumit-create-customer';
import { sumitCreateDocumentPaletteItem } from '../nodes/action-sumit-create-document/action-sumit-create-document';
import { updateGuestStatusPaletteItem } from '../nodes/action-update-guest-status/action-update-guest-status';
import { webhookPaletteItem } from '../nodes/action-webhook/action-webhook';
import { conditionPaletteItem } from '../nodes/logic-condition/logic-condition';
import { setValuePaletteItem } from '../nodes/logic-set-value/logic-set-value';
import { switchPaletteItem } from '../nodes/logic-switch/logic-switch';
import { waitPaletteItem } from '../nodes/logic-wait/logic-wait';
import { schedulePaletteItem } from '../nodes/trigger-schedule/trigger-schedule';
import * as sumitCardTriggerDefinition from '../nodes/trigger-sumit-card/definition';
import { sumitCardTriggerPaletteItem } from '../nodes/trigger-sumit-card/trigger-sumit-card';
import { webhookTriggerPaletteItem } from '../nodes/trigger-webhook/trigger-webhook';
import * as whatsappInboundDefinition from '../nodes/trigger-whatsapp-inbound/definition';
import {
  whatsappInboundSchemaFor,
  type WhatsAppNumberOption,
} from '../nodes/trigger-whatsapp-inbound/schema';
import { whatsappInboundPaletteItem } from '../nodes/trigger-whatsapp-inbound/trigger-whatsapp-inbound';

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

// Its schema, the number-aware factory `whatsappInboundSchemaFor`, uischema and
// palette entry live in `nodes/trigger-whatsapp-inbound/`, and its config and
// message kinds in that folder's `definition.ts`. The number option type is
// re-exported for the editor, which passes the live numbers in.
export type { WhatsAppNumberOption };

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

// Its schema, method options, uischema and palette entry live in
// `nodes/trigger-webhook/`, and its config in that folder's `definition.ts`.

// ---------------------------------------------------------------------------
// trigger.sumit_card
// ---------------------------------------------------------------------------

// Its schema, uischema and palette entry live in `nodes/trigger-sumit-card/`,
// and its config and output fields in that folder's `definition.ts` — an
// SDK-free file, so server code can read the output fields too. They are
// re-exported here for the editor, which reads them from this module.
export {
  SUMIT_CARD_BASE_OUTPUT,
  SUMIT_HOLD_FIELDS_OUTPUT,
  type SumitCardOutput,
  type SumitCardOutputField,
} from '../nodes/trigger-sumit-card/definition';

// ---------------------------------------------------------------------------
// action.microsoft_send_email
// ---------------------------------------------------------------------------

// Its schema, the connection-aware `microsoftSendEmailSchemaFor` and the option
// shape live in `nodes/action-microsoft-send-email/schema.ts`. The option type is
// re-exported for the editor, which passes the live connections in.
export type { MicrosoftConnectionOption };

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// trigger.schedule
// ---------------------------------------------------------------------------

// Its schema, day options, uischema and palette entry live in
// `nodes/trigger-schedule/`, and its config in that folder's `definition.ts`.


// ---------------------------------------------------------------------------
// action.send_template
// ---------------------------------------------------------------------------

// Its schema, uischema and palette entry live in `nodes/action-send-template/`,
// and the message keys it offers in that folder's `definition.ts`. The bare keys
// are re-exported for the export check (`export-diagram.tsx`), which reads them
// from here.
export { TEMPLATE_KEYS } from '../nodes/action-send-template/definition';

// ---------------------------------------------------------------------------
// action.start_for_each_guest
// ---------------------------------------------------------------------------

// Its schema, uischema and palette entry live in
// `nodes/action-start-for-each-guest/`, and its config, caps and ranges in that
// folder's `definition.ts`.

/**
 * Built at MODULE SCOPE.
 *
 * `<WorkflowBuilder.Root nodeTypes={…} />` wants a stable reference: an array
 * rebuilt each render re-renders the palette on every diagram change, which on a
 * large graph is the difference between a canvas that drags and one that
 * stutters. This is static data, so there is nothing to recompute anyway.
 *
 * EVERY entry carries an `outputSchema`, which is what puts a node into the
 * variable picker's suggestion list. An earlier note here said the opposite —
 * "omitted deliberately, until a template resolver exists". That resolver is
 * `resolve-template.ts`: vendored, wired into `activity-runner.ts`, and proven
 * on the `nodes.` namespace by `references.test.ts`. The note described a state
 * that had already ended.
 */

// ---------------------------------------------------------------------------
// action.start_voice_call
// ---------------------------------------------------------------------------

// Its schema, the live-list factory `voiceCallSchemaFor` and the two option
// shapes live in `nodes/action-start-voice-call/schema.ts`. The option types are
// re-exported for the editor, which passes the live lists in.
export type { VoiceDialOption, VoicePurposeOption };

/**
 * The read-only run report, drawn by `node-run-control.tsx`.
 *
 * ⚠️ A `Label` AND NOT A CONTROL, because it edits nothing. The SDK's UISchema
 * union is CLOSED — `UISchemaControlElement | UISchemaLayoutElement |
 * LabelElement | RichTextElement` — so "render my component here" has to be an
 * existing element carrying `options.format`, which is the same contract the
 * other four custom renderers in this file use. `text` is required by the type
 * and never drawn: the renderer replaces the element outright.
 */
const NODE_RUN_ELEMENT: UISchema = {
  type: 'Label',
  text: 'הרצה',
  options: { format: NODE_RUN_FORMAT },
};

/**
 * Put the run report at the top of a node's properties panel.
 *
 * ⚠️ HERE AND NOT IN THE NINETEEN UISCHEMAS, because it is not a property of any
 * node — it is the editor reporting on a run. One place also means a node type
 * added later gets it without anyone remembering to.
 *
 * ⚠️ AND HERE RATHER THAN ON `PALETTE_ITEMS` ITSELF. That array is also read by
 * `normalizeLegacyProperties` and by the tests that police container choice;
 * neither has any business seeing an element that exists only for the editor's
 * live view. `nodeTypes` is the only consumer that needs it, and this function
 * is what builds it.
 *
 * ⚠️ FIRST, matching where the vendor puts `globalControls` in their own nodes.
 * It is also what an owner opening a node DURING a run came to read; the
 * settings are still one line below, and the control renders nothing at all
 * when no run is on the canvas.
 */
function withNodeRunControl(item: PaletteItem): PaletteItem {
  const { uischema } = item;
  // `uischema` is OPTIONAL on the vendor's `NodeDefinition`, and every entry
  // here is a VerticalLayout. Both checks are cheaper than a crash if one ever
  // is not — a node whose panel simply lacks the report is a far better failure
  // than a panel that does not render.
  if (!uischema || !('elements' in uischema) || !Array.isArray(uischema.elements)) return item;
  return {
    ...item,
    uischema: { ...uischema, elements: [NODE_RUN_ELEMENT, ...uischema.elements] },
  };
}

/**
 * The palette, built for a given set of WhatsApp numbers.
 *
 * A FACTORY and not a const, because one entry's dropdown is a live list: the
 * account's numbers are rows in `provider_numbers` and change without a deploy.
 *
 * ⚠️ THE SDK REQUIRES A STABLE REFERENCE for `nodeTypes` ("declare at module
 * scope or memoize" — README). A fresh array each render would re-register the
 * palette on every keystroke. The editor therefore calls this inside `useMemo`;
 * calling it in a render body would be the bug this note exists to prevent.
 */
export function buildPaletteItems(
  numbers: readonly WhatsAppNumberOption[] = [],
  /**
   * The configured voice agents, for `action.start_voice_call`'s dropdown.
   *
   * Empty means the node offers nothing to pick — which is the honest state
   * when no purpose has been set up, and the handler refuses a blank anyway.
   */
  voicePurposes: readonly VoicePurposeOption[] = [],
  /**
   * The dial parameters the call node may be pointed at, both live lists.
   *
   * Empty is a legitimate state for either: an account with no synced number,
   * or a Voximplant read that failed or was never asked for. The node then
   * offers only its blank default, which is the behaviour that shipped before
   * these fields existed — never a broken control.
   */
  voiceCallerIds: readonly VoiceDialOption[] = [],
  voiceRules: readonly VoiceDialOption[] = [],
  voiceAgents: readonly VoiceDialOption[] = [],
  microsoftConnections: readonly MicrosoftConnectionOption[] = [],
  /**
   * The SUMIT trigger's fields as THIS workflow's latest SUMIT call carried
   * them — see `sumitCardOutputFromSample`. `null` keeps the fixed list, which
   * is the state of any workflow SUMIT has not called yet.
   */
  sumitCardOutput: sumitCardTriggerDefinition.SumitCardOutput | null = null,
): PaletteItem[] {
  return PALETTE_ITEMS.map((item) => {
    if (item.type === sumitCardTriggerDefinition.type && sumitCardOutput) {
      return withNodeRunControl({ ...item, outputSchema: { type: 'default', properties: sumitCardOutput } });
    }
    if (item.type === whatsappInboundDefinition.type) {
      return withNodeRunControl({ ...item, schema: whatsappInboundSchemaFor(numbers) });
    }
    if (item.type === startVoiceCallDefinition.type) {
      return withNodeRunControl({
        ...item,
        schema: voiceCallSchemaFor(voicePurposes, voiceCallerIds, voiceRules, voiceAgents),
      });
    }
    if (item.type === microsoftSendEmailDefinition.type) {
      return withNodeRunControl({
        ...item,
        schema: microsoftSendEmailSchemaFor(microsoftConnections),
      });
    }
    return withNodeRunControl(item);
  });
}

/**
 * The palette with NO numbers offered — the dropdown shows only "כל המספרים".
 *
 * Kept as the base the factory rewrites one entry of, so every other node type
 * is declared exactly once. It is also what the tests and the i18n audit read.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  // Moved to its own folder — see nodes/action-sumit-create-document/.
  sumitCreateDocumentPaletteItem,
  // Moved to its own folder — see nodes/action-sumit-create-customer/.
  sumitCreateCustomerPaletteItem,
  // Moved to its own folder — see nodes/action-ai-agent/.
  aiAgentPaletteItem,
  // Moved to its own folder — see nodes/action-start-voice-call/.
  voiceCallPaletteItem,
  // Moved to its own folder — see nodes/trigger-whatsapp-inbound/.
  whatsappInboundPaletteItem,
  // Moved to its own folder — see nodes/trigger-webhook/.
  webhookTriggerPaletteItem,
  // Moved to its own folder — see nodes/trigger-schedule/.
  schedulePaletteItem,
  // Moved to its own folder — see nodes/trigger-sumit-card/.
  sumitCardTriggerPaletteItem,
  // Moved to its own folder — see nodes/logic-condition/.
  conditionPaletteItem,
  // Moved to its own folder — see nodes/logic-switch/.
  switchPaletteItem,
  // Moved to its own folder — see nodes/action-update-guest-status/.
  updateGuestStatusPaletteItem,
  // Moved to its own folder — see nodes/action-send-whatsapp/.
  sendWhatsappPaletteItem,
  // Moved to its own folder — see nodes/action-microsoft-send-email/.
  microsoftSendEmailPaletteItem,
  // Moved to its own folder — see nodes/action-start-rsvp-ai-callback/.
  startRsvpAiCallbackPaletteItem,
  // Moved to its own folder — see nodes/action-notify-team/.
  notifyTeamPaletteItem,
  // Moved to its own folder — see nodes/action-set-guest-field/.
  setGuestFieldPaletteItem,
  // Moved to its own folder — see nodes/action-create-callback-request/.
  callbackRequestPaletteItem,
  // Moved to its own folder — see nodes/action-webhook/.
  webhookPaletteItem,
  // Moved to its own folder — see nodes/action-import-guest-list/.
  importGuestListPaletteItem,
  // Moved to its own folder — see nodes/logic-wait/.
  waitPaletteItem,
  // Moved to its own folder — see nodes/action-send-template/.
  sendTemplatePaletteItem,
  // Moved to its own folder — see nodes/action-start-for-each-guest/.
  forEachGuestPaletteItem,
  // Moved to its own folder — see nodes/logic-set-value/.
  setValuePaletteItem,
];
