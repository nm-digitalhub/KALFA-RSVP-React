import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({
  insertWebhookEvents: vi.fn(),
  insertWebhookDelivery: vi.fn(),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
// Owner agent (stage 4): the route now also reads its routing through the
// service-role client and may enqueue. Both are faked; the default state is the
// migration's own default — no number chosen — so every test above this block
// runs against the feature UNCONFIGURED, which is exactly "today".
const ownerAgentFake = vi.hoisted(() => ({
  admin: null as unknown as import('@/test/owner-agent-fake-admin').FakeAdmin,
}));
const ownerAgentSend = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ownerAgentFake.admin.client),
}));
vi.mock('@/lib/queue/web-sender', () => ({
  getWebJobSender: vi.fn(async () => ({ send: ownerAgentSend })),
}));

import { POST } from './route';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import {
  insertWebhookDelivery,
  insertWebhookEvents,
  type WebhookInboxInsert,
} from '@/lib/data/webhooks';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES } from '@/lib/queue/queues';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';
import {
  createFakeAdmin,
  unconfiguredState,
  type FakeAdminState,
} from '@/test/owner-agent-fake-admin';

ownerAgentFake.admin = createFakeAdmin();

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
  vi.mocked(insertWebhookDelivery).mockResolvedValue('del-1');
});

// Owner agent: back to "unconfigured" before every test, whatever the last one set.
beforeEach(() => {
  ownerAgentFake.admin.reset(unconfiguredState());
  ownerAgentSend.mockResolvedValue('job-id');
  __resetRateLimitStateForTests();
});

describe('POST /api/webhooks/whatsapp — the verified envelope is stored verbatim', () => {
  it('stores the raw body once per accepted POST and links every row to it', async () => {
    const body = delivery({
      messages: [
        { id: 'wamid.a', from: '972500000001', timestamp: '1700000000', type: 'text' },
        { id: 'wamid.b', from: '972500000001', timestamp: '1700000001', type: 'text' },
      ],
    });
    const raw = JSON.stringify(body);
    const res = await POST(request(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(insertWebhookDelivery).toHaveBeenCalledTimes(1);
    expect(insertWebhookDelivery).toHaveBeenCalledWith({ provider: 'whatsapp', raw, body });
    expect(rowsArg().map((r) => r.delivery_id)).toEqual(['del-1', 'del-1']);
  });

  it('still persists the events (without a link) when the delivery store fails', async () => {
    vi.mocked(insertWebhookDelivery).mockResolvedValueOnce(null);
    await POST(
      signed(delivery({ messages: [{ id: 'wamid.a', from: '972500000001', timestamp: '1700000000', type: 'text' }] })),
    );
    expect(rowsArg()).toHaveLength(1);
    expect(rowsArg()[0].delivery_id).toBeNull();
  });

  it('never stores an unverified or malformed body', async () => {
    const raw = JSON.stringify(delivery({ messages: [] }));
    await POST(request(raw, 'sha256=deadbeef'));
    await POST(request('{not json', sign('{not json')));
    expect(insertWebhookDelivery).not.toHaveBeenCalled();
  });
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

// Template-health fields (message_template_status_update / template_category_update /
// template_correct_category_detection / message_template_quality_update) are
// NOT in whatsapp-api-js's typed PostData union — normalizeTemplateHealthRows
// reads them off the raw payload, so these are exercised directly through the
// signed HTTP round-trip (same as every other event kind here), not a
// separate unit-level entry point.
function templateDelivery(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', time: 1700000000, changes: [{ field, value }] }],
  };
}

describe('POST /api/webhooks/whatsapp — template-health fields', () => {
  it('persists message_template_status_update with its own event_kind + dedupe key', async () => {
    const res = await POST(
      signed(
        templateDelivery('message_template_status_update', {
          event: 'REJECTED',
          message_template_id: 123456789,
          message_template_name: 'rsvp_invite_he',
          message_template_language: 'he',
          rejection_info: { reason: 'INVALID_FORMAT', recommendation: 'fix it' },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'whatsapp',
      event_kind: 'template_status',
      dedupe_key: 'wa-tmpl:template_status:123456789:1700000000',
    });
    expect(rows[0].payload).toMatchObject({ event: 'REJECTED' });
  });

  it('persists template_category_update (impending) with its own event_kind', async () => {
    const res = await POST(
      signed(
        templateDelivery('template_category_update', {
          message_template_id: 42,
          message_template_name: 'reminder_1',
          message_template_language: 'he',
          new_category: 'UTILITY',
          correct_category: 'MARKETING',
          category_update_timestamp: 1700086400,
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(rowsArg()[0]).toMatchObject({
      event_kind: 'template_category',
      dedupe_key: 'wa-tmpl:template_category:42:1700000000',
    });
  });

  it('persists template_correct_category_detection with its own event_kind', async () => {
    const res = await POST(
      signed(
        templateDelivery('template_correct_category_detection', {
          message_template_id: 7,
          message_template_name: 'final',
          message_template_language: 'he',
          category: 'UTILITY',
          correct_category: 'MARKETING',
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(rowsArg()[0]).toMatchObject({ event_kind: 'template_category_misuse' });
  });

  it('persists message_template_quality_update with its own event_kind', async () => {
    const res = await POST(
      signed(
        templateDelivery('message_template_quality_update', {
          message_template_id: 9,
          message_template_name: 'invite',
          message_template_language: 'he',
          previous_quality_score: 'GREEN',
          new_quality_score: 'RED',
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(rowsArg()[0]).toMatchObject({ event_kind: 'template_quality' });
  });

  it('persists a template-health field that lacks message_template_id under its raw field name', async () => {
    const res = await POST(
      signed(templateDelivery('message_template_status_update', { event: 'APPROVED' })),
    );
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_kind: 'message_template_status_update',
      message_id: null,
      phone_number_id: null,
    });
  });
});

// Every other subscribed field (account_update, business_username_updates,
// phone_number_quality_update, user_preferences, calls, …) is persisted
// generically under its Meta field name so nothing Meta delivers is invisible
// in /admin/webhooks. The worker has no handler for these kinds and marks them
// processed untouched.
describe('POST /api/webhooks/whatsapp — every other subscribed field is persisted', () => {
  it('persists an unrecognized field under its raw field name with a stable dedupe key', async () => {
    const body = templateDelivery('business_username_updates', {
      display_phone_number: '15550000000',
      username: 'kalfa.event',
      status: 'approved',
    });
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'whatsapp',
      event_kind: 'business_username_updates',
      message_id: null,
      context_message_id: null,
      phone_number_id: null,
      event_at: new Date(1700000000 * 1000).toISOString(),
    });
    expect(rows[0].payload).toMatchObject({ username: 'kalfa.event', status: 'approved' });
    expect(rows[0].dedupe_key).toMatch(
      /^wa-field:business_username_updates:waba-1:1700000000:[0-9a-f]{16}$/,
    );

    // A Meta retry of the SAME delivery must produce the SAME key (→ DB no-op).
    vi.mocked(insertWebhookEvents).mockClear();
    await POST(signed(body));
    expect(rowsArg()[0].dedupe_key).toBe(rows[0].dedupe_key);
  });

  it('keeps phone_number_id when the field value carries metadata', async () => {
    const res = await POST(
      signed(
        templateDelivery('phone_number_quality_update', {
          metadata: { display_phone_number: '15550000000', phone_number_id: 'p1' },
          display_phone_number: '15550000000',
          event: 'FLAGGED',
          current_limit: 'TIER_1K',
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(rowsArg()[0]).toMatchObject({
      event_kind: 'phone_number_quality_update',
      phone_number_id: 'p1',
    });
  });

  it('persists a `messages` change that carries neither messages nor statuses as messages_other', async () => {
    const res = await POST(
      signed(
        delivery({
          errors: [{ code: 130429, title: 'Rate limit hit' }],
        }),
      ),
    );
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_kind: 'messages_other',
      phone_number_id: 'p1',
      message_id: null,
    });
    expect(rows[0].dedupe_key).toMatch(/^wa-field:messages_other:waba-1:na:[0-9a-f]{16}$/);
  });

  it('does not double-persist a handled `messages` change alongside the generic row', async () => {
    const res = await POST(
      signed(
        delivery({
          messages: [{ id: 'wamid.a', from: '972500000001', timestamp: '1700000000', type: 'text' }],
        }),
      ),
    );
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows).toHaveLength(1);
    expect(rows[0].event_kind).toBe('message');
  });

  it('persists a mixed delivery: one message row + one generic row per other change', async () => {
    const res = await POST(
      signed({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            time: 1700000001,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '15550000000', phone_number_id: 'p1' },
                  messages: [{ id: 'wamid.m1', from: '972500000001', timestamp: '1700000000', type: 'text' }],
                },
              },
              { field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } },
              { field: 'security', value: { event: 'PIN_CHANGED' } },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const rows = rowsArg();
    expect(rows.map((r) => r.event_kind)).toEqual(['message', 'account_update', 'security']);
  });
});

// Meta's App Dashboard "Test" button sends the SAME sample payload every click
// (entry.id "0", phone_number_id "123456123", wamid "ABGGFlA5Fpa"). With the
// production dedupe key each click after the first is a silent DB no-op, so the
// username/BSUID test scenarios were never inspectable. Sandbox deliveries get a
// per-request suffix instead; real deliveries keep the exact production key.
function sandboxDelivery(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '0',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '16505551111', phone_number_id: '123456123' },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

describe('POST /api/webhooks/whatsapp — Meta sandbox test payloads persist on every click', () => {
  it('gives a sandbox message a per-delivery dedupe key so two identical Test clicks both persist', async () => {
    const body = sandboxDelivery({
      contacts: [{ profile: { name: 'test user name' }, wa_id: '16315551181' }],
      messages: [
        { from: '16315551181', id: 'ABGGFlA5Fpa', timestamp: '1504902988', type: 'text', text: { body: 'hi' } },
      ],
    });
    await POST(signed(body));
    const first = rowsArg()[0];
    expect(first.event_kind).toBe('message');
    expect(first.dedupe_key).toMatch(/^wa-msg:ABGGFlA5Fpa:test:\d+$/);

    vi.mocked(insertWebhookEvents).mockClear();
    await new Promise((r) => setTimeout(r, 2));
    await POST(signed(body));
    expect(rowsArg()[0].dedupe_key).not.toBe(first.dedupe_key);
  });

  it('gives a sandbox status a per-delivery dedupe key too', async () => {
    await POST(
      signed(
        sandboxDelivery({
          statuses: [{ id: 'ABGGFlA5Fpa', status: 'delivered', timestamp: '1504902988', recipient_id: '16315551181' }],
        }),
      ),
    );
    expect(rowsArg()[0].dedupe_key).toMatch(/^wa-status:ABGGFlA5Fpa:delivered:test:\d+$/);
  });

  it('leaves the production dedupe key untouched for a real WABA delivery', async () => {
    await POST(
      signed(delivery({ messages: [{ id: 'wamid.real', from: '972500000001', timestamp: '1700000000', type: 'text' }] })),
    );
    expect(rowsArg()[0].dedupe_key).toBe('wa-msg:wamid.real');
  });
});

// The value-level `contacts[]` block is where Meta puts the sender's profile
// name, `wa_id`, and — per the BSUID/usernames rollout — `user_id` and
// `username`. It is not part of the message object, so it used to be dropped.
// It is now carried on the persisted row under a key that cannot collide with a
// message field (`contacts` is itself a message type).
describe('POST /api/webhooks/whatsapp — sender/recipient contact block is kept', () => {
  it('attaches sender_contact (profile + wa_id + user_id + username) to an inbound message row', async () => {
    await POST(
      signed(
        delivery({
          contacts: [
            {
              profile: { name: 'Sheena Nelson', username: 'realsheenanelson' },
              wa_id: '972500000001',
              user_id: 'IL.13491208655302741918',
            },
          ],
          messages: [
            { from: '972500000001', from_user_id: 'IL.13491208655302741918', id: 'wamid.u1', timestamp: '1700000000', type: 'text', text: { body: 'hi' } },
          ],
        }),
      ),
    );
    const row = rowsArg()[0];
    expect(row.event_kind).toBe('message');
    expect(row.payload).toMatchObject({
      from_user_id: 'IL.13491208655302741918',
      sender_contact: {
        profile: { name: 'Sheena Nelson', username: 'realsheenanelson' },
        wa_id: '972500000001',
        user_id: 'IL.13491208655302741918',
      },
    });
  });

  it('does not invent sender_contact when the delivery carries no contacts block', async () => {
    await POST(
      signed(delivery({ messages: [{ id: 'wamid.n1', from: '972500000001', timestamp: '1700000000', type: 'text' }] })),
    );
    expect(rowsArg()[0].payload).not.toHaveProperty('sender_contact');
  });

  it('does not clobber a shared-contact-card message (type contacts) — the card stays under `contacts`', async () => {
    await POST(
      signed(
        delivery({
          contacts: [{ profile: { name: 'Owner' }, wa_id: '972500000002', user_id: 'IL.1' }],
          messages: [
            {
              from: '972500000002',
              id: 'wamid.c1',
              timestamp: '1700000000',
              type: 'contacts',
              contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972 50-123-4567' }] }],
            },
          ],
        }),
      ),
    );
    const payload = rowsArg()[0].payload as Record<string, unknown>;
    expect(payload.contacts).toEqual([{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972 50-123-4567' }] }]);
    expect(payload.sender_contact).toMatchObject({ wa_id: '972500000002', user_id: 'IL.1' });
  });

  it('attaches recipient_contact to a status row when Meta includes the contacts block', async () => {
    await POST(
      signed(
        delivery({
          contacts: [{ profile: { name: 'Pablo M.', username: 'pablomorales' }, wa_id: '972500000003', user_id: 'IL.2' }],
          statuses: [
            { id: 'wamid.s1', status: 'delivered', timestamp: '1700000000', recipient_id: '972500000003', recipient_user_id: 'IL.2' },
          ],
        }),
      ),
    );
    expect(rowsArg()[0].payload).toMatchObject({
      status: 'delivered',
      recipient_user_id: 'IL.2',
      recipient_contact: { profile: { username: 'pablomorales' }, user_id: 'IL.2' },
    });
  });
});

describe('POST /api/webhooks/whatsapp — rejected deliveries are visible (ids only)', () => {
  it('raises an ids-only ops alert on an invalid signature (no body, no phone)', async () => {
    const raw = JSON.stringify(delivery({ messages: [] }));
    const res = await POST(request(raw, 'sha256=deadbeef'));
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert.level).toBe('warn');
    expect(alert.fields).toMatchObject({ reason: 'invalid_signature', bytes: raw.length });
    expect(JSON.stringify(alert)).not.toContain('15550000000');
  });

  it('raises an ids-only ops alert on a signed but malformed body', async () => {
    const raw = '{not json';
    const res = await POST(request(raw, sign(raw)));
    expect(res.status).toBe(400);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toMatchObject({
      reason: 'malformed_body',
    });
  });

  it('does not alert on an accepted delivery', async () => {
    await POST(signed(delivery({ messages: [] })));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OWNER AGENT (plans/owner-whatsapp-agent-plan.md stage 4) — THE GOLDEN MATRIX.
//
// The invariant: nothing about guest traffic changes. Every fixture below runs in
// every configuration (outreach on/off × number chosen/null × agent switch on/off
// × routing-read DB error none/settings/allow-list) and is compared against the
// SAME fixture, SAME outreach state, with the feature UNCONFIGURED (the
// migration's defaults). For a fixture with no authorised message, these must be
// deep-equal — and what reaches insertWebhookEvents equal to the byte:
//   * the response (status + body, or the same throw);
//   * every insertWebhookDelivery call;
//   * every insertWebhookEvents call;
//   * every sendSlackAlert call from the webhook itself.
// The ONE permitted difference is task-mandated: a failed routing read sends one
// ids-only alert from source 'owner-agent'. So alerts are partitioned by source:
// the webhook's own must match the baseline exactly, and the owner-agent ones must
// number exactly 1 in a cell where a routing read actually failed, else 0.
// ═══════════════════════════════════════════════════════════════════════════════

const OA_CHOSEN = '1111222233334444';
const OA_OTHER = '5555666677778888';
const OA_STAFF = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OA_ENTRY = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const OA_STAFF_E164 = '+972508412345';
const OA_STAFF_WA_ID = '972508412345';
const OA_DISABLED_E164 = '+972507777777';
const OA_GUEST_WA_ID = '972501111111';
const OA_QUESTION = 'כמה פניות פתוחות יש היום?';

function oaValue(phoneNumberId: string, extra: Record<string, unknown>) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
    ...extra,
  };
}
function oaBody(changes: Array<{ field: string; value: Record<string, unknown> }>) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', time: 1700000100, changes }] };
}
function oaMessages(phoneNumberId: string, messages: unknown[], contacts?: unknown[]) {
  return oaBody([{ field: 'messages', value: oaValue(phoneNumberId, { ...(contacts ? { contacts } : {}), messages }) }]);
}
function oaText(id: string, from: string, text: string) {
  return { id, from, timestamp: '1700000000', type: 'text', text: { body: text } };
}

interface OaFixture {
  name: string;
  raw: string;
  signature: 'valid' | 'invalid';
  /** Messages that ARE authorised (allow-listed sender, chosen number) → diverted when routed. */
  authorised: Array<{ wamid: string; text: boolean }>;
  /** Only where outreach OFF differs from ON (see the malformed-entry fixture). */
  authorisedOutreachOff?: Array<{ wamid: string; text: boolean }>;
}

const OA_FIXTURES: OaFixture[] = [
  {
    name: 'status only (on the chosen number, to the staff phone)',
    raw: JSON.stringify(
      oaBody([
        {
          field: 'messages',
          value: oaValue(OA_CHOSEN, {
            statuses: [
              { id: 'wamid.s1', status: 'delivered', timestamp: '1700000000', recipient_id: OA_STAFF_WA_ID },
              { id: 'wamid.s2', status: 'read', timestamp: '1700000001', recipient_id: OA_GUEST_WA_ID },
            ],
          }),
        },
      ]),
    ),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'allow-listed phone, but on ANOTHER number',
    raw: JSON.stringify(oaMessages(OA_OTHER, [oaText('wamid.other', OA_STAFF_WA_ID, 'אני מגיע')])),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'guest (not allow-listed) on the chosen number',
    raw: JSON.stringify(
      oaMessages(
        OA_CHOSEN,
        [oaText('wamid.guest', OA_GUEST_WA_ID, 'כן, נגיע 2')],
        [{ profile: { name: 'אורח' }, wa_id: OA_GUEST_WA_ID }],
      ),
    ),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'guest RSVP button reply on the chosen number',
    raw: JSON.stringify(
      oaMessages(OA_CHOSEN, [
        {
          id: 'wamid.btn',
          from: OA_GUEST_WA_ID,
          timestamp: '1700000000',
          type: 'button',
          button: { payload: 'rsvp_yes', text: 'מגיע' },
          context: { id: 'wamid.out' },
        },
      ]),
    ),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'foreign wa_id that normalizePhone() would turn INTO the allow-listed Israeli number',
    raw: JSON.stringify(oaMessages(OA_CHOSEN, [oaText('wamid.foreign', '508412345', 'hi')])),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'trunk-zero wa_id (+9720…) that normalizes onto the allow-listed number',
    raw: JSON.stringify(oaMessages(OA_CHOSEN, [oaText('wamid.trunk', '9720508412345', 'hi')])),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'sender on a DISABLED allow-list row',
    raw: JSON.stringify(oaMessages(OA_CHOSEN, [oaText('wamid.disabled', OA_DISABLED_E164.slice(1), 'hi')])),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'template-health',
    raw: JSON.stringify(
      oaBody([
        {
          field: 'message_template_status_update',
          value: { event: 'APPROVED', message_template_id: 42, message_template_name: 'rsvp_invite_he' },
        },
      ]),
    ),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'another field (account_update, phone_number_quality_update)',
    raw: JSON.stringify(
      oaBody([
        { field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } },
        {
          field: 'phone_number_quality_update',
          value: { metadata: { phone_number_id: OA_CHOSEN }, event: 'FLAGGED', current_limit: 'TIER_1K' },
        },
      ]),
    ),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'messages change with only an errors block, on the chosen number',
    raw: JSON.stringify(oaBody([{ field: 'messages', value: oaValue(OA_CHOSEN, { errors: [{ code: 130429 }] }) }])),
    signature: 'valid',
    authorised: [],
  },
  {
    name: 'bad signature (carrying an allow-listed message)',
    raw: JSON.stringify(oaMessages(OA_CHOSEN, [oaText('wamid.badsig', OA_STAFF_WA_ID, OA_QUESTION)])),
    signature: 'invalid',
    authorised: [],
  },
  { name: 'invalid JSON', raw: '{not json', signature: 'valid', authorised: [] },
  // Signed bodies that are valid JSON but not an object: today the envelope is
  // stored first and then the normalizer throws (null) or yields nothing. The
  // diversion must not move either of those.
  { name: 'signed JSON null', raw: 'null', signature: 'valid', authorised: [] },
  { name: 'signed JSON array', raw: '[]', signature: 'valid', authorised: [] },
  { name: 'signed JSON string', raw: '"x"', signature: 'valid', authorised: [] },
  {
    name: 'entry with a non-array changes next to an allow-listed message',
    raw: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'waba-1', changes: [{ field: 'messages', value: oaValue(OA_CHOSEN, { messages: [oaText('wamid.bad', OA_STAFF_WA_ID, OA_QUESTION)] }) }] },
        { id: 'waba-2', changes: 5 },
      ],
    }),
    signature: 'valid',
    // Outreach ON: the normalizer throws on `changes: 5` exactly as today (after
    // the envelope is stored), so nothing is diverted — the route keeps today's
    // failure. Outreach OFF: nothing is ever written for guests, and the staff
    // message itself is well-formed, so it is diverted.
    authorised: [],
    authorisedOutreachOff: [{ wamid: 'wamid.bad', text: true }],
  },
  // ── authorised ──
  {
    name: 'allow-listed sender, text, on the chosen number',
    raw: JSON.stringify(
      oaMessages(
        OA_CHOSEN,
        [oaText('wamid.staff', OA_STAFF_WA_ID, OA_QUESTION)],
        [{ profile: { name: 'Owner' }, wa_id: OA_STAFF_WA_ID }],
      ),
    ),
    signature: 'valid',
    authorised: [{ wamid: 'wamid.staff', text: true }],
  },
  {
    name: 'allow-listed sender, image, on the chosen number',
    raw: JSON.stringify(
      oaMessages(OA_CHOSEN, [{ id: 'wamid.img', from: OA_STAFF_WA_ID, timestamp: '1700000000', type: 'image', image: { id: 'm1' } }]),
    ),
    signature: 'valid',
    authorised: [{ wamid: 'wamid.img', text: false }],
  },
  {
    name: 'mixed delivery: guest + staff message, a status, another field',
    raw: JSON.stringify(
      oaBody([
        {
          field: 'messages',
          value: oaValue(OA_CHOSEN, {
            messages: [
              oaText('wamid.mix.guest', OA_GUEST_WA_ID, 'כן'),
              oaText('wamid.mix.staff', OA_STAFF_WA_ID, OA_QUESTION),
            ],
          }),
        },
        {
          field: 'messages',
          value: oaValue(OA_CHOSEN, {
            statuses: [{ id: 'wamid.mix.s', status: 'sent', timestamp: '1700000002', recipient_id: OA_GUEST_WA_ID }],
          }),
        },
        { field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } },
      ]),
    ),
    signature: 'valid',
    authorised: [{ wamid: 'wamid.mix.staff', text: true }],
  },
];

interface OaConfig {
  outreach: boolean;
  number: boolean;
  agentSwitch: boolean;
  dbError: 'none' | 'settings' | 'allowlist';
}

const OA_CONFIGS: OaConfig[] = [];
for (const outreach of [true, false])
  for (const number of [true, false])
    for (const agentSwitch of [true, false])
      for (const dbError of ['none', 'settings', 'allowlist'] as const)
        OA_CONFIGS.push({ outreach, number, agentSwitch, dbError });

function oaLabel(c: OaConfig): string {
  return `outreach ${c.outreach ? 'on' : 'off'} · number ${c.number ? 'chosen' : 'null'} · switch ${c.agentSwitch ? 'on' : 'off'} · db error ${c.dbError}`;
}

function oaState(c: OaConfig): FakeAdminState {
  const s = unconfiguredState();
  s.settings = {
    owner_agent_enabled: c.agentSwitch,
    owner_agent_phone_number_id: c.number ? OA_CHOSEN : null,
    owner_agent_daily_cap: 50,
  };
  s.allowlist = [
    { id: OA_ENTRY, e164: OA_STAFF_E164, staff_user_id: OA_STAFF, enabled: true },
    { id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', e164: OA_DISABLED_E164, staff_user_id: OA_STAFF, enabled: false },
  ];
  s.staff = new Set([OA_STAFF]);
  s.verifiedPhones = new Map([[OA_STAFF, OA_STAFF_E164]]);
  const dbErr = { code: '57014', message: `canceling statement; row (${OA_STAFF_E164})` };
  if (c.dbError === 'settings') s.settingsError = dbErr;
  if (c.dbError === 'allowlist') s.allowlistError = dbErr;
  return s;
}

type Outcome = { status: number; body: string } | { threw: string };

async function oaRun(fx: OaFixture, outreach: boolean, state: FakeAdminState) {
  vi.clearAllMocks();
  ownerAgentFake.admin.reset(state);
  __resetRateLimitStateForTests();
  vi.mocked(getOutreachEnabled).mockResolvedValue(outreach);
  const sig = fx.signature === 'valid' ? sign(fx.raw) : 'sha256=deadbeef';
  let outcome: Outcome;
  try {
    const res = await POST(request(fx.raw, sig));
    outcome = { status: res.status, body: await res.text() };
  } catch (e) {
    outcome = { threw: e instanceof Error ? e.constructor.name : typeof e };
  }
  const alerts = vi.mocked(sendSlackAlert).mock.calls.map((c) => c[0]);
  return {
    outcome,
    delivery: vi.mocked(insertWebhookDelivery).mock.calls.map((c) => c[0]),
    events: vi.mocked(insertWebhookEvents).mock.calls.map((c) => c[0]),
    eventsBytes: JSON.stringify(vi.mocked(insertWebhookEvents).mock.calls),
    webhookAlerts: alerts.filter((a) => a.source !== 'owner-agent'),
    agentAlerts: alerts.filter((a) => a.source === 'owner-agent'),
    audits: ownerAgentFake.admin.writes.filter((w) => w.table === 'owner_agent_audit').map((w) => w.row),
    intake: ownerAgentFake.admin.writes.filter((w) => w.table === 'owner_agent_intake').map((w) => w.row),
    sends: ownerAgentSend.mock.calls.map((c) => [...c]),
  };
}

// A routing read failed in this cell (and so exactly one owner-agent alert).
function oaRoutingFails(c: OaConfig): boolean {
  return c.dbError === 'settings' || (c.dbError === 'allowlist' && c.number);
}
// The feature is live in this cell: a number chosen and the routing read succeeded.
function oaRouted(c: OaConfig): boolean {
  return c.number && c.dbError === 'none';
}

describe.each(OA_CONFIGS.map((c) => [oaLabel(c), c] as const))(
  'owner agent golden matrix — %s',
  (_label, config) => {
    it.each(OA_FIXTURES.map((fx) => [fx.name, fx] as const))('%s', async (_name, fx) => {
      const baseline = await oaRun(fx, config.outreach, unconfiguredState());
      // The baseline itself must be the feature-free path: no owner-agent anything.
      expect(baseline.agentAlerts).toEqual([]);
      expect(baseline.audits).toEqual([]);
      expect(baseline.sends).toEqual([]);

      const got = await oaRun(fx, config.outreach, oaState(config));

      // Owner-agent alerts: exactly one per failed routing read, ids only.
      if (oaRoutingFails(config)) {
        expect(got.agentAlerts).toHaveLength(1);
        expect(got.agentAlerts[0].fields).toEqual({
          step: config.dbError === 'settings' ? 'routing_settings' : 'routing_allowlist',
          code: '57014',
        });
        expect(JSON.stringify(got.agentAlerts[0])).not.toContain(OA_STAFF_WA_ID);
      }

      const authorised = config.outreach ? fx.authorised : (fx.authorisedOutreachOff ?? fx.authorised);
      const diverted = oaRouted(config) ? authorised : [];

      // Response: always what today answers.
      expect(got.outcome).toStrictEqual(baseline.outcome);
      // The webhook's own alerts (signature / JSON): always today's.
      expect(got.webhookAlerts).toStrictEqual(baseline.webhookAlerts);

      if (diverted.length === 0) {
        // No authorised message in play: byte-for-byte today.
        expect(got.delivery).toStrictEqual(baseline.delivery);
        expect(got.events).toStrictEqual(baseline.events);
        expect(got.eventsBytes).toBe(baseline.eventsBytes);
        expect(got.audits).toEqual([]);
        expect(got.intake).toEqual([]);
        expect(got.sends).toEqual([]);
        if (!oaRoutingFails(config)) expect(got.agentAlerts).toEqual([]);
        return;
      }

      // ── An authorised message, routed ──
      expect(got.agentAlerts).toEqual([]);
      const divertedIds = new Set(diverted.map((d) => d.wamid));

      // Guests: exactly the baseline minus the diverted message rows — nothing else.
      if (!config.outreach) {
        // Outreach off writes nothing for anyone today, and still nothing now.
        expect(baseline.delivery).toEqual([]);
        expect(baseline.events).toEqual([]);
        expect(got.delivery).toEqual([]);
        expect(got.events).toEqual([]);
      } else {
        const baselineRows = baseline.events.flat();
        const keptRows = baselineRows.filter(
          (r) => !(r.event_kind === 'message' && r.message_id !== null && divertedIds.has(r.message_id as string)),
        );
        expect(keptRows.length).toBe(baselineRows.length - diverted.length);
        if (keptRows.length === 0) {
          expect(got.delivery).toEqual([]); // nothing left to keep an envelope for
          expect(got.events).toEqual([]);
        } else {
          expect(got.delivery).toStrictEqual(baseline.delivery); // verbatim (9.13)
          expect(got.events).toStrictEqual([keptRows]);
        }
      }
      // No diverted wamid ever reaches webhook_inbox.
      for (const call of got.events) {
        for (const row of call) expect(divertedIds.has(row.message_id as string)).toBe(false);
      }

      // Exactly one audit row per diverted message, with its code.
      const expected = diverted.map((d) => {
        if (!config.agentSwitch) return ['gated', 'kill_switch_off'];
        if (!d.text) return ['gated', 'non_text'];
        return ['intake_queued', null];
      });
      expect(got.audits.map((a) => [a.outcome, a.reason_code])).toEqual(expected);
      expect(JSON.stringify(got.audits)).not.toContain(OA_STAFF_WA_ID);
      expect(JSON.stringify(got.audits)).not.toContain(OA_QUESTION);

      // Insert + enqueue only when the gate passes.
      const passing = diverted.filter((d) => config.agentSwitch && d.text);
      expect(got.intake.map((r) => r.wamid)).toEqual(passing.map((d) => d.wamid));
      expect(got.sends).toEqual(
        passing.map((d) => [
          QUEUES.ownerAgentReply,
          { intakeId: expect.any(String) },
          { id: deterministicJobId(d.wamid) },
        ]),
      );
    });
  },
);

describe('owner agent — a failure while handling a diverted message never changes the answer', () => {
  const mixed = OA_FIXTURES.find((f) => f.name.startsWith('mixed delivery'))!;

  it.each([true, false])('intake insert fails (outreach %s): 200 ok, guests persisted, one ids-only alert', async (outreach) => {
    const baseline = await oaRun(mixed, outreach, unconfiguredState());
    const state = oaState({ outreach, number: true, agentSwitch: true, dbError: 'none' });
    state.intakeInsertError = { code: '23514', message: `Failing row contains (${OA_QUESTION}, ${OA_STAFF_E164})` };
    const got = await oaRun(mixed, outreach, state);

    expect(got.outcome).toStrictEqual({ status: 200, body: 'ok' });
    expect(got.outcome).toStrictEqual(baseline.outcome);
    expect(got.delivery).toStrictEqual(baseline.delivery);
    expect(got.webhookAlerts).toStrictEqual(baseline.webhookAlerts);
    expect(got.sends).toEqual([]);
    expect(got.agentAlerts).toHaveLength(1);
    expect(got.agentAlerts[0].fields).toEqual({ step: 'intake', code: '23514', audit: 'written', entry: OA_ENTRY });
    const alertText = JSON.stringify(got.agentAlerts[0]);
    expect(alertText).not.toContain(OA_STAFF_WA_ID);
    expect(alertText).not.toContain(OA_QUESTION);
    expect(got.audits.map((a) => [a.outcome, a.reason_code])).toEqual([['failed', 'db_error']]);
  });

  it('the service-role client itself throws while handling: still 200 ok, guests persisted', async () => {
    const state = oaState({ outreach: true, number: true, agentSwitch: true, dbError: 'none' });
    const baseline = await oaRun(mixed, true, unconfiguredState());
    // First call (routing) succeeds; the second (handling) throws.
    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient)
      .mockImplementationOnce(() => ownerAgentFake.admin.client as never)
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    ownerAgentFake.admin.reset(state);
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(insertWebhookDelivery).mockClear();
    vi.mocked(insertWebhookEvents).mockClear();
    vi.mocked(sendSlackAlert).mockClear();
    const res = await POST(request(mixed.raw, sign(mixed.raw)));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(vi.mocked(insertWebhookDelivery).mock.calls.map((c) => c[0])).toStrictEqual(baseline.delivery);
    const alerts = vi.mocked(sendSlackAlert).mock.calls.map((c) => c[0]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ source: 'owner-agent', fields: { step: 'client', code: 'exception' } });
  });

  it('outreach off + number chosen: the body is read only to find staff messages; a guest-only delivery writes nothing', async () => {
    const guestOnly = OA_FIXTURES.find((f) => f.name.startsWith('guest (not allow-listed)'))!;
    const got = await oaRun(guestOnly, false, oaState({ outreach: false, number: true, agentSwitch: true, dbError: 'none' }));
    expect(got.outcome).toStrictEqual({ status: 200, body: 'ok' });
    expect(got.delivery).toEqual([]);
    expect(got.events).toEqual([]);
    expect(got.audits).toEqual([]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
