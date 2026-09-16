import { describe, expect, it } from 'vitest';

import { buildPaletteItems, PALETTE_ITEMS } from './schemas';
import { INTEGRATION_CONNECTION_FORMAT } from './ui-formats';

function microsoftItem(items: ReturnType<typeof buildPaletteItems>) {
  return items.find((item) => item.type === 'action.microsoft_send_email')!;
}

describe('action.microsoft_send_email — live connection schema', () => {
  it('uses the SDK Select control for connectionId', () => {
    const item = microsoftItem(buildPaletteItems());
    const elements = (
      item.uischema as { elements?: Array<{ type?: string; scope?: string }> }
    ).elements;
    const control = elements?.find((element) =>
      element.scope?.endsWith('connectionId'),
    );

    expect(control?.type).toBe('Select');
    expect(
      (
        control as {
          options?: Record<string, unknown>;
        }
      )?.options,
    ).toEqual({
      format: INTEGRATION_CONNECTION_FORMAT,
      provider: 'microsoft',
      capability: 'mail.send',
    });
  });

  it('offers the supplied labels while persisting connection UUIDs as values', () => {
    const connections = [
      { label: 'תיבת מכירות', value: '11111111-1111-4111-8111-111111111111' },
      { label: 'תיבת תמיכה', value: '22222222-2222-4222-8222-222222222222' },
    ];
    const item = microsoftItem(buildPaletteItems([], [], [], [], [], connections));
    const schema = item.schema as {
      properties: Record<string, { options?: typeof connections }>;
    };

    expect(schema.properties.connectionId?.options).toEqual(connections);
    expect(item.defaultPropertiesData?.connectionId).toBe('');
  });

  it('clones only the Microsoft schema and leaves the module palette untouched', () => {
    const built = buildPaletteItems([], [], [], [], [], [
      { label: 'תיבה', value: '11111111-1111-4111-8111-111111111111' },
    ]);
    const baseMicrosoft = PALETTE_ITEMS.find(
      (item) => item.type === 'action.microsoft_send_email',
    )!;

    expect(microsoftItem(built)).not.toBe(baseMicrosoft);
    expect(microsoftItem(built).schema).not.toBe(baseMicrosoft.schema);
    expect(
      (baseMicrosoft.schema as {
        properties: Record<string, { options?: unknown }>;
      }).properties.connectionId?.options,
    ).toBeUndefined();

    const rebuiltTypes = new Set([
      'trigger.whatsapp_inbound',
      'action.start_voice_call',
      'action.microsoft_send_email',
    ]);
    for (const item of built.filter((candidate) => !rebuiltTypes.has(candidate.type))) {
      expect(item).toBe(PALETTE_ITEMS.find((base) => base.type === item.type));
    }
  });
});
