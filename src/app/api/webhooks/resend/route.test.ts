import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn() }));

import { POST } from './route';
import { insertWebhookEvents, type WebhookInboxInsert } from '@/lib/data/webhooks';

// The Standard Webhooks signature IS the auth. Signatures are produced with the
// same library the route verifies with, so these tests exercise real crypto
// rather than a stub — a hand-rolled signer would only prove itself.
const SECRET = 'whsec_dGVzdHNlY3JldHRlc3RzZWNyZXR0ZXN0c2VjcmV0';

function sign(raw: string, id: string, at: Date = new Date()) {
  // sign() returns "v1,<sig>"; the header carries the same shape.
  return new Webhook(SECRET).sign(id, at, raw);
}

function request(
  raw: string,
  opts: { id?: string; signature?: string; timestamp?: string } = {},
): NextRequest {
  const id = opts.id ?? 'msg_test_1';
  const at = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'svix-id': id,
    'svix-timestamp': at,
    'svix-signature': opts.signature ?? sign(raw, id, new Date(Number(at) * 1000)),
  };
  return new Request('https://kalfa.test/api/webhooks/resend', {
    method: 'POST',
    headers,
    body: raw,
  }) as unknown as NextRequest;
}

const bounced = JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-08-26T12:00:00.000Z',
  // A real payload carries BOTH ids, and they are not interchangeable:
  // email_id = Resend's UUID; message_id = the RFC 5322 Message-ID header.
  data: {
    email_id: 'fd8629d3-51af-4b2f-a0fd-44fb8e51d7f0',
    message_id: '<0199a1c4-7d2e-71f3-9f0b-2c5d8e4a1b60@eu-west-1.amazonses.com>',
    to: ['a@b.com'],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
});

describe('POST /api/webhooks/resend', () => {
  it('accepts a correctly signed handled event and persists it once', async () => {
    const res = await POST(request(bounced));
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).toHaveBeenCalledTimes(1);
    const [rows] = vi.mocked(insertWebhookEvents).mock.calls[0] as [WebhookInboxInsert[]];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'resend',
      event_kind: 'email_delivery',
      // dedupe on the per-DELIVERY id, not email_id: one email emits several
      // events, so keying on email_id would collapse them into one row.
      dedupe_key: 'msg_test_1',
      // The RFC Message-ID, NOT email_id — this is the value In-Reply-To /
      // References are matched against, so storing the UUID here would make the
      // row useless for threading.
      message_id: '<0199a1c4-7d2e-71f3-9f0b-2c5d8e4a1b60@eu-west-1.amazonses.com>',
    });
  });

  it('rejects a tampered signature with 401 and persists NOTHING', async () => {
    // Verify-before-persist is the whole point: a row appearing here would mean
    // an unsigned caller can fill the table.
    const res = await POST(request(bounced, { signature: 'v1,bogussignature' }));
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('rejects a body altered after signing (byte-sensitive raw body)', async () => {
    const signature = sign(bounced, 'msg_test_1');
    const tampered = bounced.replace('a@b.com', 'attacker@evil.com');
    const res = await POST(request(tampered, { signature }));
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('rejects a replayed old delivery (5-minute tolerance in standardwebhooks)', async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const ts = String(Math.floor(old.getTime() / 1000));
    const res = await POST(
      request(bounced, { timestamp: ts, signature: sign(bounced, 'msg_test_1', old) }),
    );
    expect(res.status).toBe(401);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('acknowledges an unhandled event type with 200, not 4xx', async () => {
    // Resend retries anything that is not 200 and eventually DISABLES an endpoint
    // that keeps failing — a 4xx here would switch off delivery of the events we
    // do want.
    const opened = JSON.stringify({
      type: 'email.opened',
      data: { email_id: 'x' },
    });
    const res = await POST(request(opened));
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('is a no-op 200 when the secret is unconfigured', async () => {
    // 200 so an unconfigured deployment never trips the retry ladder.
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
    const res = await POST(request(bounced));
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });

  it('passes the same dedupe_key for a redelivered event so the DB can dedupe', async () => {
    // Resend guarantees at-least-once; duplicates are expected, not exceptional.
    await POST(request(bounced, { id: 'msg_dup' }));
    await POST(request(bounced, { id: 'msg_dup' }));
    const keys = vi
      .mocked(insertWebhookEvents)
      .mock.calls.map((c) => (c[0] as WebhookInboxInsert[])[0].dedupe_key);
    expect(keys).toEqual(['msg_dup', 'msg_dup']);
  });

  // Regression: this column was first populated with event.data.email_id. BOTH
  // fields exist on every event, so the mistake persists a plausible-looking
  // value and is invisible without this check — but a row keyed on Resend's UUID
  // can never be matched to an inbound reply's In-Reply-To/References header.
  it("never stores Resend's email_id in the message_id column", async () => {
    await POST(request(bounced));
    const [rows] = vi.mocked(insertWebhookEvents).mock.calls[0] as [WebhookInboxInsert[]];
    const row = rows[0];
    expect(row.message_id).not.toBe('fd8629d3-51af-4b2f-a0fd-44fb8e51d7f0');
    // An RFC 5322 Message-ID is angle-bracketed with a domain part; a bare UUID
    // is not, so this fails loudly if the two are ever swapped back.
    expect(row.message_id).toMatch(/^<[^@>]+@[^@>]+>$/);
    // email_id is not lost — the full payload is persisted alongside it.
    const payload = row.payload as { data: { email_id: string } };
    expect(payload.data.email_id).toBe('fd8629d3-51af-4b2f-a0fd-44fb8e51d7f0');
  });
});
