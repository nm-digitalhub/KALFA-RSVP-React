import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendMessage = vi.fn();
// The MM Lite escape hatch — spied so tests assert the exact URL + body sent
// to `/marketing_messages` (there is no native SDK method to call instead).
const apiFetch = vi.fn();
// Only the API transport is mocked (never a real network call). The message
// classes ('whatsapp-api-js/messages') stay REAL so the tests assert the
// actual Cloud API payload shape the SDK builds — not a mock's echo.
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: class {
    sendMessage = sendMessage;
    $$apiFetch$$ = apiFetch;
  },
}));

import { sendWhatsAppMarketingTemplate, sendWhatsAppTemplate } from './client';

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
    expect(r).toEqual({ kind: 'accepted', providerId: 'wamid.123' });
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

  it('injects RSVP quick-reply payloads as quick_reply button components, index 0..2', async () => {
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.rsvp' }] });

    await sendWhatsAppTemplate(cfg, {
      to: '+972501234567',
      templateName: 'kalfa_brit_invite_trad_v1',
      language: 'he',
      bodyParams: BODY_PARAMS,
      rsvpButtonPayloads: ['rsvp_attending', 'rsvp_declined', 'rsvp_maybe'],
    });

    // Exact Cloud API shape the SDK builds: body + one quick_reply button per
    // payload, index by constructor order — so a tap returns button.payload='rsvp_*'.
    const message = sendMessage.mock.calls[0][2];
    expect(JSON.parse(JSON.stringify(message))).toEqual({
      name: 'kalfa_brit_invite_trad_v1',
      language: { code: 'he', policy: 'deterministic' },
      components: [
        { type: 'body', parameters: BODY_PARAMS.map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'rsvp_attending' }] },
        { type: 'button', sub_type: 'quick_reply', index: 1, parameters: [{ type: 'payload', payload: 'rsvp_declined' }] },
        { type: 'button', sub_type: 'quick_reply', index: 2, parameters: [{ type: 'payload', payload: 'rsvp_maybe' }] },
      ],
    });
  });

  it('fail-closed: a URL button + RSVP payloads is refused, never sent (index conflict)', async () => {
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972501234567',
      templateName: 'kalfa_event_gift_v1',
      language: 'he',
      urlButtonParam: 'giftToken',
      rsvpButtonPayloads: ['rsvp_attending', 'rsvp_declined', 'rsvp_maybe'],
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' });
  });

  it('classifies a thrown send (network/timeout) as unknown — never a resend', async () => {
    sendMessage.mockRejectedValue(new Error('meta down'));
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('unknown');
  });

  it('classifies a missing message id as unknown', async () => {
    sendMessage.mockResolvedValue({ messages: [] });
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('unknown');
  });

  it('maps a verified 4xx provider error code to definitely_not_sent', async () => {
    sendMessage.mockResolvedValue({ error: { code: 131026 } });
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('definitely_not_sent');
  });

  it('maps an unmapped provider error code to unknown (conservative)', async () => {
    sendMessage.mockResolvedValue({ error: { code: 500 } });
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('unknown');
  });

  it('carries the provider code (never PII) on a definitely_not_sent classification', async () => {
    sendMessage.mockResolvedValue({ error: { code: 132001 } }); // template not approved
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r).toEqual({
      kind: 'definitely_not_sent',
      reason: 'provider_rejected',
      providerCode: '132001',
    });
  });

  it('classifies a thrown 5xx (httpStatus) as unknown and preserves the status number', async () => {
    // A gateway 5xx arrives as a throw; delivery is UNCERTAIN → unknown, never a
    // resend. Only a provider error CODE in the body is a "definite" signal.
    sendMessage.mockRejectedValue(Object.assign(new Error('bad gateway'), { httpStatus: 503 }));
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r).toEqual({ kind: 'unknown', reason: 'send_threw', providerStatus: 503 });
  });

  it('every verified 4xx code maps to definitely_not_sent; a neighbour code stays unknown', async () => {
    const definite = [100, 131008, 131026, 131047, 132000, 132001, 132015, 132016];
    for (const code of definite) {
      sendMessage.mockResolvedValue({ error: { code } });
      const r = await sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' });
      expect(r.kind).toBe('definitely_not_sent');
    }
    // 131050 is NOT in the verified set → conservative unknown (one advance-skip,
    // never a wrong "definite" that would cost a resend).
    sendMessage.mockResolvedValue({ error: { code: 131050 } });
    const r = await sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' });
    expect(r.kind).toBe('unknown');
  });
});

// MM Lite — MARKETING-category templates (thankyou etc.) route here instead
// of sendWhatsAppTemplate. There is no native SDK method for
// `/marketing_messages`, so this exercises the library's documented escape
// hatch ($$apiFetch$$) directly — asserting the URL + exact body shape is the
// only way to verify the routing is correct (there's no `sendMessage`-level
// call to inspect).
describe('sendWhatsAppMarketingTemplate', () => {
  it('POSTs to /marketing_messages with product_policy CLOUD_API_FALLBACK and returns the provider message id', async () => {
    apiFetch.mockResolvedValue({ json: async () => ({ messages: [{ id: 'wamid.mm1' }] }) });

    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972501234567',
      templateName: 'kalfa_thankyou_v1',
      language: 'he',
      bodyParams: ['חתונה', 'דוד לוי ו־שרה כהן'],
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, options] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/PNID\/marketing_messages$/);
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+972501234567',
      type: 'template',
      template: {
        name: 'kalfa_thankyou_v1',
        language: { code: 'he', policy: 'deterministic' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'חתונה' },
              { type: 'text', text: 'דוד לוי ו־שרה כהן' },
            ],
          },
        ],
      },
      product_policy: 'CLOUD_API_FALLBACK',
    });
    expect(r).toEqual({ kind: 'accepted', providerId: 'wamid.mm1' });
  });

  it('parses the raw fetch Response ($$apiFetch$$ does not resolve the body like sendMessage does)', async () => {
    const json = vi.fn().mockResolvedValue({ error: { code: 131026 } });
    apiFetch.mockResolvedValue({ json });

    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });

    expect(json).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('definitely_not_sent');
  });

  it('classifies MM Lite ineligibility (131055) as unknown, not definitely_not_sent', async () => {
    apiFetch.mockResolvedValue({ json: async () => ({ error: { code: 131055 } }) });
    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('unknown');
  });

  it('fail-closed: a URL button + RSVP payloads is refused before any provider call', async () => {
    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972501234567',
      templateName: 'kalfa_event_gift_v1',
      language: 'he',
      urlButtonParam: 'giftToken',
      rsvpButtonPayloads: ['rsvp_attending', 'rsvp_declined', 'rsvp_maybe'],
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' });
  });

  it('classifies a thrown fetch (network/timeout) as unknown', async () => {
    apiFetch.mockRejectedValue(new Error('meta down'));
    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r.kind).toBe('unknown');
  });
});
