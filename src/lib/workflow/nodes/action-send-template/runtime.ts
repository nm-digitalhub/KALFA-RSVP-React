// `action.send_template` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from `steps/index`
// (the registry imports this file, so that would be a cycle).
import { readString, requireGuestContext, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as sendTemplateDefinition from './definition';

// An APPROVED WhatsApp template to this run's guest.
//
// ⚠️ THE COMPANION TO `action.send_whatsapp`, and the reason both exist. Free
// text may be sent only inside the 24-hour window a guest's own message opens —
// perfect for answering someone who just wrote, and useless for reaching someone
// who did not. A template may be sent at any time, so this is the ONLY send a
// workflow started by a clock can actually deliver.
//
// Every Meta and consent rule is the campaign path's, reused rather than copied:
// see template-send.ts.
//
// A REFUSAL IS A COMPLETED STEP, not the error branch, whenever the system
// behaved correctly — an opted-out guest, a template not approved for this event
// type, a household with no phone. Routing those to the failure path would send
// a workflow down an error route because the rules worked.
export const sendTemplate: StepHandler = async (config, ctx) => {
  const port = ctx.deps.guests.sendWhatsAppTemplate;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "שליחת תבנית" אינה זמינה בסביבה הזו.',
    );
  }

  // The key is checked against SendTemplateConfig at compile time; the value is
  // still read defensively, because the config is an unvalidated jsonb row.
  const messageKey = readString<sendTemplateDefinition.SendTemplateConfig>(config, 'messageKey').trim();
  if (messageKey === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "שליחת תבנית" לא הוגדר עם תבנית לשליחה.',
    );
  }

  const { eventId, contactId } = requireGuestContext(ctx, sendTemplateDefinition.type);
  const result = await port({ eventId, contactId, messageKey });

  return result.ok
    ? { output: { sent: true, messageKey } }
    : { output: { sent: false, skipped: true, reason: result.reason ?? 'send_failed' } };
};
