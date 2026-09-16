import { IntegrationRuntimeError } from '../errors';
import type { Capability, ProviderRequest } from '../provider';

export const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com';

export type MicrosoftSendMailInput = {
  to: string;
  subject: string;
  body: string;
};

export function microsoftGraphRequest(
  capability: Capability,
  input: unknown,
): ProviderRequest {
  if (capability !== 'mail.send') {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_capability_unsupported',
      `Microsoft Graph operation "${capability}" is not implemented.`,
    );
  }

  const mail = readSendMailInput(input);
  return {
    url: new URL('/v1.0/me/sendMail', MICROSOFT_GRAPH_ORIGIN),
    init: {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: {
            contentType: 'Text',
            content: mail.body,
          },
          toRecipients: [
            {
              emailAddress: {
                address: mail.to,
              },
            },
          ],
        },
      }),
    },
  };
}

function readSendMailInput(input: unknown): MicrosoftSendMailInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidInput();
  }

  const record = input as Record<string, unknown>;
  const to = typeof record.to === 'string' ? record.to.trim() : '';
  const subject = typeof record.subject === 'string' ? record.subject.trim() : '';
  const body = typeof record.body === 'string' ? record.body : '';

  if (!to || !subject || !body.trim()) throw invalidInput();
  return { to, subject, body };
}

function invalidInput(): IntegrationRuntimeError {
  return new IntegrationRuntimeError(
    'permanent',
    'integration_input_invalid',
    'Microsoft mail.send requires a recipient, subject and body.',
  );
}
