// The node-type catalogue: which types exist, and which may begin a flow.
//
// METADATA ONLY, and SDK-free — this module is read by the pg-boss worker,
// which must never load @workflowbuilder/sdk. It imports `./types` and the
// SDK-free `nodes/<name>/definition.ts` of each node that has moved to its own
// folder. The editor's half (property schemas, labels, icons) lives in
// ./schemas.ts or, for a moved node, in its folder's editor files.
//
// Adding a step type in the one-folder-per-node layout: a `nodes/<name>/`
// folder (definition, schema, uischema, defaults, palette item, runtime — see
// plans/node-folders-file-matrix.md), then one entry here, in `NODE_TYPES`,
// `NODE_REQUIRED_FIELDS`, `PALETTE_ITEMS` and `STEP_HANDLERS`, each read from
// the definition. No adapter changes.
import * as aiAgentDefinition from '../nodes/action-ai-agent/definition';
import * as callbackRequestDefinition from '../nodes/action-create-callback-request/definition';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import * as notifyTeamDefinition from '../nodes/action-notify-team/definition';
import * as sendTemplateDefinition from '../nodes/action-send-template/definition';
import * as sendWhatsappDefinition from '../nodes/action-send-whatsapp/definition';
import * as setGuestFieldDefinition from '../nodes/action-set-guest-field/definition';
import * as sumitCreateCustomerDefinition from '../nodes/action-sumit-create-customer/definition';
import * as sumitCreateDocumentDefinition from '../nodes/action-sumit-create-document/definition';
import * as updateGuestStatusDefinition from '../nodes/action-update-guest-status/definition';
import * as webhookDefinition from '../nodes/action-webhook/definition';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import * as switchDefinition from '../nodes/logic-switch/definition';

import { NODE_TYPES, type CatalogueEntry, type KalfaNodeType } from './types';

export const CATALOGUE: readonly CatalogueEntry[] = [
  { type: 'trigger.whatsapp_inbound', isTrigger: true },
  { type: 'trigger.webhook', isTrigger: true },
  { type: 'trigger.schedule', isTrigger: true },
  { type: 'trigger.sumit_card', isTrigger: true },
  { type: conditionDefinition.type, isTrigger: conditionDefinition.isTrigger },
  { type: switchDefinition.type, isTrigger: switchDefinition.isTrigger },
  { type: updateGuestStatusDefinition.type, isTrigger: updateGuestStatusDefinition.isTrigger },
  { type: sendWhatsappDefinition.type, isTrigger: sendWhatsappDefinition.isTrigger },
  { type: microsoftSendEmailDefinition.type, isTrigger: microsoftSendEmailDefinition.isTrigger },
  { type: 'action.start_rsvp_ai_callback', isTrigger: false },
  { type: notifyTeamDefinition.type, isTrigger: notifyTeamDefinition.isTrigger },
  { type: webhookDefinition.type, isTrigger: webhookDefinition.isTrigger },
  { type: setGuestFieldDefinition.type, isTrigger: setGuestFieldDefinition.isTrigger },
  { type: callbackRequestDefinition.type, isTrigger: callbackRequestDefinition.isTrigger },
  { type: 'action.import_guest_list', isTrigger: false },
  { type: 'logic.wait', isTrigger: false },
  { type: sendTemplateDefinition.type, isTrigger: sendTemplateDefinition.isTrigger },
  { type: 'action.start_for_each_guest', isTrigger: false },
  { type: 'action.start_voice_call', isTrigger: false },
  { type: setValueDefinition.type, isTrigger: setValueDefinition.isTrigger },
  { type: sumitCreateDocumentDefinition.type, isTrigger: sumitCreateDocumentDefinition.isTrigger },
  { type: sumitCreateCustomerDefinition.type, isTrigger: sumitCreateCustomerDefinition.isTrigger },
  { type: aiAgentDefinition.type, isTrigger: aiAgentDefinition.isTrigger },
];

// Lookup by the string stored in the diagram. `undefined` is rule 5: an unknown
// type is a validation error, decided by the caller, not silently defaulted here.
const BY_TYPE = new Map<string, CatalogueEntry>(CATALOGUE.map((e) => [e.type, e]));

export function findCatalogueEntry(type: string): CatalogueEntry | undefined {
  return BY_TYPE.get(type);
}

export function isKnownNodeType(type: string): type is KalfaNodeType {
  return BY_TYPE.has(type);
}

/**
 * RULE 1, as a function. The only question the adapter asks about who may start.
 * A type absent from the catalogue is not a trigger and not anything else — it
 * fails validation before this is ever consulted.
 */
export function isTriggerType(type: string): boolean {
  return BY_TYPE.get(type)?.isTrigger === true;
}

// Guards the two lists against drifting apart: NODE_TYPES is what the rest of
// the codebase narrows on, CATALOGUE is what the editor and adapter read.
export const CATALOGUE_COVERS_ALL_TYPES: boolean =
  NODE_TYPES.every((t) => BY_TYPE.has(t)) && CATALOGUE.length === NODE_TYPES.length;
