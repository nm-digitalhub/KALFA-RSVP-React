'use client';

// Starter diagrams for the editor's template selector.
//
// ONE FILE PER TEMPLATE in this folder, each exporting its `TemplateModel`; this
// index only fixes the order the selector shows them in. The two handle ids they
// all wire edges with live in `./shared.ts`.
//
// CLIENT ONLY, for the same reason as ../schemas.ts: `TemplateModel` is a type,
// but this module sits beside the palette and is imported only by the editor.
// Every template file is 'use client' for the same reason.
//
// WHY THE `type` FIELD IS SPELLED OUT ON EVERY NODE
//
// A node dropped from the palette gets its React Flow type computed:
// `jb(paletteType, templateType, customTemplates)` runs inside the SDK's
// add-node handler and resolves `templateType` to 'start-node' /
// 'decision-node' / 'node'. A node loaded from a TEMPLATE takes a different
// path — `setDiagramModel` maps the nodes through `ja` (which only annotates
// validation errors) and `v1`, then writes them to the store as they are. It
// never calls `jb`. Verified against dist/index-CEBfv0NZ.js at 2.3.0.
//
// So a template that left `type: 'node'` on the condition in
// `./rsvp-by-keyword.ts` would load a node with the DEFAULT body: one bare
// `source` handle, no branch rows, and that file's two branch edges pointing at
// handles that are not on it. The template has to carry
// what the palette would have computed.
//
// WHY BOTH BRANCHES ARE WIRED
//
// Not tidiness. `propagate` in the vendored runner returns a dead end whenever
// a node names a port and no outgoing edge carries it, and a dead end ends the
// run `execution_incomplete`. Our condition ALWAYS names one of its two ports,
// so a diagram with only the "yes" branch drawn reports incomplete on every
// message that says no — while having done exactly what the owner intended.
// The first thing an owner sees should not teach that shape.
import type { TemplateModel } from '@workflowbuilder/sdk';

import { configuredPurposeCallTemplate } from './configured-purpose-call';
import { delayedNudgeTemplate } from './delayed-nudge';
import { guestListImportTemplate } from './guest-list-import';
import { perGuestReminderTemplate } from './per-guest-reminder';
import { rsvpAiVoiceCallbackTemplate } from './rsvp-ai-voice-callback';
import { rsvpByKeywordTemplate } from './rsvp-by-keyword';
import { rsvpFullRoutingTemplate } from './rsvp-full-routing';
import { rsvpWithReplyTemplate } from './rsvp-with-reply';
import { sumitCustomerThenDocumentTemplate } from './sumit-customer-then-document';
import { sumitHoldChangedTemplate } from './sumit-hold-changed';
import { sumitReceiptOnWebhookTemplate } from './sumit-receipt-on-webhook';
import { voiceCallWithOutcomeTemplate } from './voice-call-with-outcome';
import { weeklyPendingSweepTemplate } from './weekly-pending-sweep';

/**
 * Built at MODULE SCOPE, the same requirement as `PALETTE_ITEMS`: upstream
 * documents `diagramTemplates` as needing a stable reference, and a fresh array
 * each render would remount the selector.
 */
export const DIAGRAM_TEMPLATES: TemplateModel[] = [
  rsvpByKeywordTemplate,
  rsvpWithReplyTemplate,
  rsvpAiVoiceCallbackTemplate,
  rsvpFullRoutingTemplate,
  guestListImportTemplate,
  delayedNudgeTemplate,
  weeklyPendingSweepTemplate,
  perGuestReminderTemplate,
  voiceCallWithOutcomeTemplate,
  configuredPurposeCallTemplate,
  sumitReceiptOnWebhookTemplate,
  sumitCustomerThenDocumentTemplate,
  sumitHoldChangedTemplate,
];
