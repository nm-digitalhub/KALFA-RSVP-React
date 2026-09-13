import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { GRAPH_API_VERSION } from './graph-version';
import {
  getAppSubscriptions,
  readWhatsAppSubscription,
  subscribeWhatsAppWebhook,
  WHATSAPP_WEBHOOK_FIELDS,
  WHATSAPP_WEBHOOK_TOPIC,
} from './subscriptions';

// The check that would have caught a five-day total inbound outage.
//
// MEASURED 2026-09-13: the app's only subscription was a stray `catalog` topic;
// `whatsapp_business_account` was gone and Meta had delivered nothing since
// 2026-09-08. The token and the phone-number node — the only things the hourly
// check probed — were healthy the entire time.

const APP_ID = '1234567890123456';
const APP_SECRET = 'APP-SECRET-DO-NOT-LEAK';
const VERIFY = 'VERIFY-TOKEN-DO-NOT-LEAK';
const CREDS = { appId: APP_ID, appSecret: APP_SECRET };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('readWhatsAppSubscription — the four states', () => {
  const sub = (fields: string[], active = true) => [
    { topic: 'catalog', fields: [], active: true },
    { topic: WHATSAPP_WEBHOOK_TOPIC, fields, active },
  ];

  it('the exact live failure: only a stray catalog topic', () => {
    // This is the real listing from the outage, not an invented one.
    expect(readWhatsAppSubscription([{ topic: 'catalog', fields: [], active: true }])).toEqual({
      kind: 'absent',
    });
  });

  it('an empty listing is absent, not ok', () => {
    expect(readWhatsAppSubscription([])).toEqual({ kind: 'absent' });
  });

  it('all required fields present is ok', () => {
    expect(readWhatsAppSubscription(sub([...WHATSAPP_WEBHOOK_FIELDS]))).toMatchObject({
      kind: 'ok',
    });
  });

  it('extra fields beyond ours are still ok — we do not own the whole list', () => {
    expect(
      readWhatsAppSubscription(sub([...WHATSAPP_WEBHOOK_FIELDS, 'account_update'])),
    ).toMatchObject({ kind: 'ok' });
  });

  it('a subscription MISSING messages is reported with the missing field named', () => {
    // Subscribed but useless: the topic exists and the one field that carries
    // inbound traffic is not on it.
    const r = readWhatsAppSubscription(sub(['message_template_status_update']));
    expect(r).toMatchObject({ kind: 'missing_fields', missing: ['messages'] });
  });

  it('inactive is its OWN state, not folded into absent', () => {
    // Meta disabled it. Different cause, different sentence to a human.
    expect(readWhatsAppSubscription(sub([...WHATSAPP_WEBHOOK_FIELDS], false))).toEqual({
      kind: 'inactive',
    });
  });
});

describe('getAppSubscriptions', () => {
  it('uses the app access token, not the WhatsApp token', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [] }));
    await getAppSubscriptions(CREDS);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe(`/${GRAPH_API_VERSION}/${APP_ID}/subscriptions`);
    expect(url.searchParams.get('access_token')).toBe(`${APP_ID}|${APP_SECRET}`);
  });

  it('normalises fields given as objects', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        data: [{ object: WHATSAPP_WEBHOOK_TOPIC, fields: [{ name: 'messages' }], active: true }],
      }),
    );
    expect((await getAppSubscriptions(CREDS))[0]?.fields).toEqual(['messages']);
  });

  it('normalises fields given as bare strings', async () => {
    // Graph returns both shapes depending on version; neither is assumed.
    fetchSpy.mockResolvedValue(
      jsonResponse({ data: [{ object: WHATSAPP_WEBHOOK_TOPIC, fields: ['messages'] }] }),
    );
    expect((await getAppSubscriptions(CREDS))[0]?.fields).toEqual(['messages']);
  });

  it('treats a row with no `active` as active — absence is not disabled', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ data: [{ object: WHATSAPP_WEBHOOK_TOPIC, fields: ['messages'] }] }),
    );
    expect((await getAppSubscriptions(CREDS))[0]?.active).toBe(true);
  });

  it('never puts the app secret in a thrown message', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: { message: `bad ${APP_SECRET}` } }, false, 400),
    );
    const err = await getAppSubscriptions(CREDS).catch((e: Error) => e.message);
    expect(String(err)).toContain('HTTP 400');
    expect(String(err)).not.toContain(APP_SECRET);
  });
});

describe('subscribeWhatsAppWebhook', () => {
  const input = {
    ...CREDS,
    callbackUrl: 'https://beta.kalfa.me/api/webhooks/whatsapp',
    verifyToken: VERIFY,
  };

  it('POSTs the whatsapp topic with our handled fields', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true }));
    await subscribeWhatsAppWebhook(input);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(`/${APP_ID}/subscriptions`);
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    // The value the docs claim is not allowed for this edge. It is.
    expect(body.get('object')).toBe('whatsapp_business_account');
    expect(body.get('fields')).toBe(WHATSAPP_WEBHOOK_FIELDS.join(','));
    expect(body.get('callback_url')).toBe(input.callbackUrl);
    expect(body.get('verify_token')).toBe(VERIFY);
  });

  it('treats a 200 WITHOUT success:true as a failure', async () => {
    // Graph answers 200 with an error body often enough that status alone is not
    // evidence the subscription landed.
    fetchSpy.mockResolvedValue(jsonResponse({ error: { code: 200 } }));
    await expect(subscribeWhatsAppWebhook(input)).rejects.toThrow(/subscribe failed/);
  });

  it('reports the error CODE and never the message', async () => {
    // Meta's error text echoes the parameters we just sent — verify_token included.
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: { code: 100, message: `bad ${VERIFY}` } }, false, 400),
    );
    const err = await subscribeWhatsAppWebhook(input).catch((e: Error) => e.message);
    expect(String(err)).toContain('code 100');
    expect(String(err)).not.toContain(VERIFY);
    expect(String(err)).not.toContain(APP_SECRET);
  });

  it('does not touch any other topic', async () => {
    // The stray `catalog` subscription is left exactly as it is — removing it is a
    // judgement nobody has made.
    fetchSpy.mockResolvedValue(jsonResponse({ success: true }));
    await subscribeWhatsAppWebhook(input);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
