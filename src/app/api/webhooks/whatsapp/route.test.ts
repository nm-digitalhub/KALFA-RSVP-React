import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn() }));

import { POST } from './route';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import {
  insertWebhookEvents,
  type WebhookInboxInsert,
} from '@/lib/data/webhooks';

// The HMAC signature IS the auth. The library verifies over escapeUnicode(raw)
// (non-ASCII → \uXXXX, mirroring Meta's ASCII-safe JSON), so the signer must too.
const APP_SECRET = 'test-app-secret';

function escapeUnicode(str: string): string {
  return str.replace(
    /[^\0-~]/g,
    (ch) => '\\u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4),
  );
}

function sign(raw: string): string {
  return (
    'sha256=' +
    createHmac('sha256', APP_SECRET).update(escapeUnicode(raw)).digest('hex')
  );
}

function request(raw: string, signature: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return new Request('https://kalfa.test/api/webhooks/whatsapp', {
    method: 'POST',
    headers,
    body: raw,
  }) as unknown as NextRequest;
}

function signed(payload: unknown): NextRequest {
  const raw = JSON.stringify(payload);
  return request(raw, sign(raw));
}

// Full Meta `messages`-field delivery, the shape the library's verifier + the
// route's typed iterator expect.
function delivery(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000000',
                phone_number_id: 'p1',
              },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function rowsArg(): WebhookInboxInsert[] {
  return vi.mocked(insertWebhookEvents).mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutreachEnabled).mockResolvedValue(true);
  vi.mocked(getWhatsAppConfig).mockResolvedValue({
    phoneNumberId: 'p1',
    wabaId: null,
    accessToken: 't1',
    appSecret: APP_SECRET,
    verifyToken: null,
  });
  vi.mocked(insertWebhookEvents).mockResolvedValue();
});

describe('POST /api/webhooks/whatsapp — persist-then-process intake', () => {
  it('persists an inbound message (dedupe key, context, phone id) and returns 200', async () => {
    const res = await POST(
      signed(
        delivery({
          contacts: [{ profile: { name: 'X' }, wa_id: '972501234567' }],
          messages: [
            {
              id: 'wamid.in',
              from: '972501234567',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'אני מגיע' },
              context: { id: 'wamid.out' },
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(insertWebhookEvents).toHaveBeenCalledTimes(1);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'whatsapp',
      event_kind: 'message',
      dedupe_key: 'wa-msg:wamid.in',
      message_id: 'wamid.in',
      context_message_id: 'wamid.out',
      phone_number_id: 'p1',
    });
  });

  it('persists EVERY status in a batched delivery (does not drop after the first)', async () => {
    const res = await POST(
      signed(
        delivery({
          statuses: [
            {
              id: 'wamid.a',
              status: 'delivered',
              timestamp: '1700000000',
              recipient_id: '972501234567',
            },
            {
              id: 'wamid.b',
              status: 'read',
              timestamp: '1700000001',
              recipient_id: '972500000000',
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupe_key)).toEqual([
      'wa-status:wamid.a:delivered',
      'wa-status:wamid.b:read',
    ]);
    expect(rows.every((r) => r.event_kind === 'status')).toBe(true);
  });

  it('persists EVERY message in a multi-message value (does not drop after the first)', async () => {
    const res = await POST(
      signed(
        delivery({
          messages: [
            { id: 'wamid.m1', from: '972501234567', timestamp: '1700000000', type: 'text', text: { body: 'כן' } },
            { id: 'wamid.m2', from: '972500000000', timestamp: '1700000001', type: 'text', text: { body: 'לא' } },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupe_key)).toEqual([
      'wa-msg:wamid.m1',
      'wa-msg:wamid.m2',
    ]);
    expect(rows.every((r) => r.event_kind === 'message')).toBe(true);
  });

  it('persists one row per event across multiple entries and changes in a delivery', async () => {
    const value = (extra: Record<string, unknown>) => ({
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: 'p1' },
      ...extra,
    });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            { field: 'messages', value: value({ messages: [{ id: 'wamid.e1', from: '1', timestamp: '1700000000', type: 'text', text: { body: 'a' } }] }) },
            { field: 'messages', value: value({ statuses: [{ id: 'wamid.s1', status: 'delivered', timestamp: '1700000001', recipient_id: '1' }] }) },
          ],
        },
        {
          id: 'waba-2',
          changes: [
            { field: 'messages', value: value({ messages: [{ id: 'wamid.e2', from: '2', timestamp: '1700000002', type: 'text', text: { body: 'b' } }] }) },
          ],
        },
      ],
    };

    const res = await POST(signed(payload));

    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dedupe_key)).toEqual([
      'wa-msg:wamid.e1',
      'wa-status:wamid.s1:delivered',
      'wa-msg:wamid.e2',
    ]);
  });

  it('returns 200 and writes nothing when outreach is disabled', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(false);
    const res = await POST(
      signed(delivery({ messages: [{ id: 'wamid.x', from: '1', type: 'text' }] })),
    );
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('returns 200 and writes nothing when no app secret is configured', async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({
      phoneNumberId: 'p1',
      wabaId: null,
      accessToken: 't1',
      appSecret: null,
      verifyToken: null,
    });
    const res = await POST(
      signed(delivery({ messages: [{ id: 'wamid.x', from: '1', type: 'text' }] })),
    );
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 401 and writes nothing', async () => {
    const raw = JSON.stringify(
      delivery({ messages: [{ id: 'wamid.x', from: '1', type: 'text' }] }),
    );
    const res = await POST(request(raw, 'sha256=deadbeef'));
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('rejects a missing signature with 401 and writes nothing', async () => {
    const raw = JSON.stringify(
      delivery({ messages: [{ id: 'wamid.x', from: '1', type: 'text' }] }),
    );
    const res = await POST(request(raw, null));
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('returns 400 on a correctly signed but malformed body', async () => {
    const raw = 'not-json';
    const res = await POST(request(raw, sign(raw)));
    expect(res.status).toBe(400);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
});
