import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendMessage = vi.fn();
// Only the API transport is mocked (never a real network call). The message
// classes ('whatsapp-api-js/messages') stay REAL so the tests assert the
// actual Cloud API payload shape the SDK builds — not a mock's echo.
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: class {
    sendMessage = sendMessage;
  },
}));

import { sendWhatsAppTemplate, WhatsAppSendError } from './client';

const cfg = { phoneNumberId: 'PNID', accessToken: 'TKN', appSecret: null };

// The seven positional values of the approved contract ({{1}}..{{7}}).
const BODY_PARAMS = [
  'דנה',
  'דוד לוי',
  'שרה כהן',
  'שני',
  '20.07.2026',
  '21:00',
  'אולמי הגן, דרך השלום 10, תל אביב',
];

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

  it('without bodyParams the template goes out BARE — no components key at all', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.bare' }] });

    await sendWhatsAppTemplate(cfg, {
      to: '+972501234567',
      templateName: 'rsvp_invite',
      language: 'he',
    });

    // Exact-shape assertion on the real SDK message object: the serialized
    // payload must be name+language ONLY (pre-binding behavior, unchanged).
    const message = sendMessage.mock.calls[0][2];
    expect(JSON.parse(JSON.stringify(message))).toEqual({
      name: 'rsvp_invite',
      language: { code: 'he', policy: 'deterministic' },
    });
  });

  it('with bodyParams it builds ONE body component whose text parameters keep the {{i}} order', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.456' }] });

    await sendWhatsAppTemplate(cfg, {
      to: '+972501234567',
      templateName: 'kalfa_wedding_invite_v1',
      language: 'he',
      bodyParams: BODY_PARAMS,
    });

    const message = sendMessage.mock.calls[0][2];
    expect(JSON.parse(JSON.stringify(message))).toEqual({
      name: 'kalfa_wedding_invite_v1',
      language: { code: 'he', policy: 'deterministic' },
      components: [
        {
          type: 'body',
          parameters: BODY_PARAMS.map((text) => ({ type: 'text', text })),
        },
      ],
    });
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
