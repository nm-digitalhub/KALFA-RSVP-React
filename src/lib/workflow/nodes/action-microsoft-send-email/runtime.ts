// `action.microsoft_send_email` — the step handler. Server side: SDK-free, and it
// imports the shared step contract from `steps/shared`, never from `steps/index`
// (the registry imports this file, so that would be a cycle).
import { readIntegrationRuntimeError } from '@/lib/integrations/errors';

import { readString, type StepHandler } from '../../steps/shared';
import {
  PermanentNodeExecutionError,
  TransientNodeExecutionError,
} from '../../vendor/workflowbuilder/execution-core/errors';

import type {
  MicrosoftMailContentType,
  MicrosoftMailImportance,
  MicrosoftSendEmailConfig,
} from './definition';

export const microsoftSendEmail: StepHandler = async (config, ctx) => {
  // The keys are checked against MicrosoftSendEmailConfig at compile time; the
  // values are still read defensively, because the config is an unvalidated
  // jsonb row.
  const connectionId = readString<MicrosoftSendEmailConfig>(config, 'connectionId').trim();
  const to = readString<MicrosoftSendEmailConfig>(config, 'to').trim();
  const cc = readString<MicrosoftSendEmailConfig>(config, 'cc').trim();
  const bcc = readString<MicrosoftSendEmailConfig>(config, 'bcc').trim();
  const replyTo = readString<MicrosoftSendEmailConfig>(config, 'replyTo').trim();
  const subject = readString<MicrosoftSendEmailConfig>(config, 'subject').trim();
  const body = readString<MicrosoftSendEmailConfig>(config, 'body');

  // Narrowed here rather than passed through, so a jsonb row holding a number,
  // a null or a value from a newer version cannot reach the transport. Each
  // fallback is Graph's own default, which is what an absent field has always
  // meant.
  const contentType: MicrosoftMailContentType =
    readString<MicrosoftSendEmailConfig>(config, 'contentType').trim() === 'HTML' ? 'HTML' : 'Text';

  const rawImportance = readString<MicrosoftSendEmailConfig>(config, 'importance').trim();
  const importance: MicrosoftMailImportance =
    rawImportance === 'high' || rawImportance === 'low' ? rawImportance : 'normal';

  const saveToSentItems =
    typeof config.saveToSentItems === 'boolean' ? config.saveToSentItems : true;

  // The same four fields as before. `cc`, `bcc` and `replyTo` are deliberately
  // NOT required: a mail with no carbon copy is an ordinary mail.
  if (!connectionId || !to || !subject || !body.trim()) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "שליחת דוא״ל ב-Microsoft 365" חסר חיבור, נמען, נושא או תוכן.',
    );
  }

  try {
    await ctx.deps.integrations.execute({
      provider: 'microsoft',
      connectionId,
      capability: 'mail.send',
      // The optional ADDRESS fields are omitted when empty rather than sent as
      // '', so the transport never has to tell "no carbon copy" apart from
      // "a carbon copy that resolved to nothing".
      input: {
        to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(replyTo ? { replyTo } : {}),
        subject,
        body,
        contentType,
        importance,
        saveToSentItems,
      },
    });
  } catch (error) {
    const integrationError = readIntegrationRuntimeError(error);
    if (!integrationError) throw error;

    const ErrorType =
      integrationError.classification === 'transient'
        ? TransientNodeExecutionError
        : PermanentNodeExecutionError;
    throw new ErrorType(integrationError.code, integrationError.message, { cause: error });
  }

  // Microsoft Graph sendMail returns 202 with no response body. `accepted` means
  // Graph accepted the request; it is deliberately not a delivery receipt.
  return { output: { accepted: true } };
};
