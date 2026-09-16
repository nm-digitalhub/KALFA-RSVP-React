import { describe, expect, it, vi } from 'vitest';

import { IntegrationRuntimeError } from '@/lib/integrations/errors';

import { STEP_HANDLERS, type StepContext } from './index';

const handler = STEP_HANDLERS['action.microsoft_send_email'];

function context(execute: StepContext['deps']['integrations']['execute']): StepContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    deps: {
      guests: {} as StepContext['deps']['guests'],
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {} as StepContext['deps']['webhook'],
      integrations: { execute },
    },
  };
}

describe('action.microsoft_send_email', () => {
  it('executes mail.send through the selected Microsoft connection and normalizes the output', async () => {
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>(async () => ({
      status: 202,
    }));

    const result = await handler(
      {
        connectionId: '  connection-1  ',
        to: '  guest@example.com  ',
        subject: '  אישור הגעה  ',
        body: 'שלום דנה',
      },
      context(execute),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      provider: 'microsoft',
      connectionId: 'connection-1',
      capability: 'mail.send',
      input: {
        to: 'guest@example.com',
        subject: 'אישור הגעה',
        body: 'שלום דנה',
      },
    });
    expect(result.output).toEqual({ accepted: true });
  });

  it('fails permanently before the port when required config is missing', async () => {
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>();

    await expect(
      handler(
        { connectionId: 'connection-1', to: '', subject: 'נושא', body: 'תוכן' },
        context(execute),
      ),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only body before the port', async () => {
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>();

    await expect(
      handler(
        { connectionId: 'connection-1', to: 'x@example.com', subject: 'נושא', body: '   ' },
        context(execute),
      ),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves structured integration errors at the workflow boundary', async () => {
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>(async () => {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_rate_limited',
        'Microsoft Graph throttled the request.',
      );
    });

    await expect(
      handler(
        { connectionId: 'connection-1', to: 'x@example.com', subject: 'נושא', body: 'תוכן' },
        context(execute),
      ),
    ).rejects.toMatchObject({
      code: 'integration_rate_limited',
      classification: 'transient',
    });
  });
});
