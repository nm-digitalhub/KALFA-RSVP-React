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
      // Never reached by these tests; present because the port is required —
      // an optional one would let a document node silently issue nothing.
      ai: { run: async () => ({ text: '', costUsd: null, sessionId: null }) },
      accounting: {
        createDocument: async () => ({
          documentId: 1,
          documentNumber: null,
          customerId: null,
          documentDownloadUrl: null,
        }),
        createCustomer: async () => ({ customerId: 1, customerHistoryUrl: null }),
      },
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
        // Narrowed by the handler even though the config named none of them,
        // and each value is Graph's own default — so this config sends the
        // same mail it sent before the three fields existed.
        contentType: 'Text',
        importance: 'normal',
        saveToSentItems: true,
      },
    });
    expect(result.output).toEqual({ accepted: true });
  });

  it('⚠️ omits an empty optional address rather than passing an empty string', () => {
    // The transport would have to tell '' apart from "absent" otherwise, and
    // the two mean the same thing to an owner who cleared the field.
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>(async () => ({
      status: 202,
    }));

    return handler(
      {
        connectionId: 'connection-1',
        to: 'guest@example.com',
        cc: '   ',
        bcc: '',
        subject: 'נושא',
        body: 'תוכן',
      },
      context(execute),
    ).then(() => {
      const input = execute.mock.calls[0]![0].input as Record<string, unknown>;
      expect(Object.hasOwn(input, 'cc')).toBe(false);
      expect(Object.hasOwn(input, 'bcc')).toBe(false);
      expect(Object.hasOwn(input, 'replyTo')).toBe(false);
    });
  });

  it('forwards every optional Microsoft mail setting the node carries', async () => {
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>(async () => ({
      status: 202,
    }));

    const result = await handler(
      {
        connectionId: 'connection-1',
        to: 'guest@example.com',
        cc: '  manager@example.com  ',
        bcc: 'audit@example.com',
        replyTo: 'support@example.com',
        subject: 'אישור הגעה',
        body: '<b>שלום</b>',
        contentType: 'HTML',
        importance: 'high',
        saveToSentItems: false,
      },
      context(execute),
    );

    expect(execute).toHaveBeenCalledWith({
      provider: 'microsoft',
      connectionId: 'connection-1',
      capability: 'mail.send',
      input: {
        to: 'guest@example.com',
        cc: 'manager@example.com',
        bcc: 'audit@example.com',
        replyTo: 'support@example.com',
        subject: 'אישור הגעה',
        body: '<b>שלום</b>',
        contentType: 'HTML',
        importance: 'high',
        saveToSentItems: false,
      },
    });
    expect(result.output).toEqual({ accepted: true });
  });

  it('⚠️ falls back to Graph\u2019s defaults when a stored value is not one of ours', () => {
    // These fields live in a jsonb column no form re-validates. A number, a null
    // or a value from a newer version must not reach the transport.
    const execute = vi.fn<StepContext['deps']['integrations']['execute']>(async () => ({
      status: 202,
    }));

    return handler(
      {
        connectionId: 'connection-1',
        to: 'guest@example.com',
        subject: 'נושא',
        body: 'תוכן',
        contentType: 'Markdown',
        importance: 7,
        saveToSentItems: 'yes',
      },
      context(execute),
    ).then(() => {
      expect(execute.mock.calls[0]![0].input).toMatchObject({
        contentType: 'Text',
        importance: 'normal',
        saveToSentItems: true,
      });
    });
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
