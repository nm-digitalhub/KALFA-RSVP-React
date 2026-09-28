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

import { sendWhatsAppMarketingTemplate, sendWhatsAppTemplate, sendWhatsAppText, sendWithMetaRetry } from './client';

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

  it('an error Meta flags is_transient stays unknown, with its code', async () => {
    sendMessage.mockResolvedValue({ error: { code: 2, is_transient: true } });
    const r = await sendWhatsAppTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r).toEqual({ kind: 'unknown', reason: 'provider_error', providerCode: '2', retryable: true });
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

  it('any error code without is_transient is a known rejection — no code list', async () => {
    for (const code of [100, 131026, 131047, 131050, 131056, 130429, 131000, 132015, 987654]) {
      sendMessage.mockResolvedValue({ error: { code } });
      const r = await sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' });
      expect(r).toEqual({ kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: String(code) });
    }
    // is_transient: false is Meta saying "not temporary" — still a rejection.
    sendMessage.mockResolvedValue({ error: { code: 131048, is_transient: false } });
    const r = await sendWhatsAppTemplate(cfg, { to: '+972500000000', templateName: 't', language: 'he' });
    expect(r.kind).toBe('definitely_not_sent');
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

  it('an error code in the body is a known rejection that carries the code (131055, 130429)', async () => {
    for (const code of [131055, 130429]) {
      apiFetch.mockResolvedValue({ json: async () => ({ error: { code } }) });
      const r = await sendWhatsAppMarketingTemplate(cfg, {
        to: '+972500000000',
        templateName: 't',
        language: 'he',
      });
      expect(r).toMatchObject({ kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: String(code) });
    }
  });

  it('MM Lite: an is_transient error stays unknown', async () => {
    apiFetch.mockResolvedValue({ json: async () => ({ error: { code: 131000, is_transient: true } }) });
    const r = await sendWhatsAppMarketingTemplate(cfg, {
      to: '+972500000000',
      templateName: 't',
      language: 'he',
    });
    expect(r).toMatchObject({ kind: 'unknown', reason: 'provider_error', providerCode: '131000' });
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

describe("sendWithMetaRetry — Meta's documented retry (is_transient, 4^X seconds)", () => {
  const transient = { kind: 'unknown', reason: 'provider_error', providerCode: '2', retryable: true } as const;
  const accepted = { kind: 'accepted', providerId: 'wamid.ok' } as const;

  function clock() {
    let t = 0;
    const waits: number[] = [];
    return {
      waits,
      now: () => t,
      sleep: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
    };
  }

  it('retries an is_transient error after 1s, 4s, 16s — and stops when it succeeds', async () => {
    const c = clock();
    const send = vi
      .fn()
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce(accepted);
    const out = await sendWithMetaRetry(send, { budgetMs: 21_000, now: c.now, sleep: c.sleep });
    expect(out).toEqual(accepted);
    expect(send).toHaveBeenCalledTimes(3);
    expect(c.waits).toEqual([1_000, 4_000]);
  });

  it('never starts a wait that would end past the budget; returns the last outcome', async () => {
    const c = clock();
    const send = vi.fn().mockResolvedValue(transient);
    const out = await sendWithMetaRetry(send, { budgetMs: 21_000, now: c.now, sleep: c.sleep });
    expect(c.waits).toEqual([1_000, 4_000, 16_000]);
    expect(send).toHaveBeenCalledTimes(4);
    expect(out).toEqual(transient);
  });

  it('budget 0 = one attempt, no retry', async () => {
    const c = clock();
    const send = vi.fn().mockResolvedValue(transient);
    await sendWithMetaRetry(send, { budgetMs: 0, now: c.now, sleep: c.sleep });
    expect(send).toHaveBeenCalledTimes(1);
    expect(c.waits).toEqual([]);
  });

  it.each([
    ['a rejection (no is_transient)', { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '131047' }],
    ['a timeout / no answer ("missed success" is possible)', { kind: 'unknown', reason: 'send_threw' }],
    ['a body with no id', { kind: 'unknown', reason: 'missing_message_id' }],
  ] as const)('never retries %s', async (_label, outcome) => {
    const c = clock();
    const send = vi.fn().mockResolvedValue(outcome);
    await sendWithMetaRetry(send, { budgetMs: 21_000, now: c.now, sleep: c.sleep });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sendWhatsAppText retries only when given a budget', async () => {
    sendMessage.mockResolvedValueOnce({ error: { code: 2, is_transient: true } }).mockResolvedValueOnce({
      messages: [{ id: 'wamid.second' }],
    });
    vi.useFakeTimers();
    try {
      const pending = sendWhatsAppText(cfg, { to: '+972500000000', body: 'x' }, { retryBudgetMs: 21_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ kind: 'accepted', providerId: 'wamid.second' });
    } finally {
      vi.useRealTimers();
    }
    sendMessage.mockResolvedValueOnce({ error: { code: 2, is_transient: true } });
    const once = await sendWhatsAppText(cfg, { to: '+972500000000', body: 'x' });
    expect(once).toMatchObject({ kind: 'unknown', retryable: true });
  });
});
