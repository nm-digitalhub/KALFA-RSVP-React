import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendMessage = vi.fn();
// Class-based mocks: the SDK exports are constructors (`new WhatsAppAPI()`,
// `new Template()`), and an arrow mockImplementation can't be `new`ed.
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: class {
    sendMessage = sendMessage;
  },
}));
vi.mock('whatsapp-api-js/messages', () => ({
  Template: class {
    name: string;
    language: unknown;
    constructor(name: string, language: unknown) {
      this.name = name;
      this.language = language;
    }
  },
  Language: class {
    code: string;
    constructor(code: string) {
      this.code = code;
    }
  },
}));

import { sendWhatsAppTemplate, WhatsAppSendError } from './client';

const cfg = { phoneNumberId: 'PNID', accessToken: 'TKN', appSecret: null };

afterEach(() => vi.clearAllMocks());

describe('sendWhatsAppTemplate', () => {
  it('sends the approved template to the recipient and returns the provider message id', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.123' }] });

    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972501234567',
      templateName: 'rsvp_invite',
      language: 'he',
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'PNID',
      '+972501234567',
      expect.objectContaining({ name: 'rsvp_invite' }),
    );
    expect(r.providerId).toBe('wamid.123');
  });

  it('throws WhatsAppSendError when the API errors', async () => {
    sendMessage.mockRejectedValue(new Error('meta down'));
    await expect(
      sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' }),
    ).rejects.toBeInstanceOf(WhatsAppSendError);
  });

  it('throws WhatsAppSendError when no message id is returned', async () => {
    sendMessage.mockResolvedValue({ messages: [] });
    await expect(
      sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' }),
    ).rejects.toBeInstanceOf(WhatsAppSendError);
  });
});
