import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/interactions', () => ({
  resolveInboundContact: vi.fn(),
  insertInteraction: vi.fn(),
  markContactRemovalRequested: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ recordReached: vi.fn() }));

import { POST } from './route';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import {
  insertInteraction,
  markContactRemovalRequested,
  resolveInboundContact,
} from '@/lib/data/interactions';
import { recordReached } from '@/lib/data/billing';

// The HMAC signature IS the auth, so each test signs the EXACT raw body it posts.
const APP_SECRET = 'test-app-secret';

function signedRequest(payload: unknown): NextRequest {
  const raw = JSON.stringify(payload);
  const signature =
    'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return new Request('https://kalfa.test/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature },
    body: raw,
  }) as unknown as NextRequest;
}

function inbound(body: string, type = 'text') {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: 'wamid.1', from: '972501234567', type, text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
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
  vi.mocked(resolveInboundContact).mockResolvedValue({
    eventId: 'e1',
    campaignId: 'c1',
    contactId: 'k1',
  });
  vi.mocked(insertInteraction).mockResolvedValue(true);
  vi.mocked(recordReached).mockResolvedValue('billed');
  vi.mocked(markContactRemovalRequested).mockResolvedValue();
});

describe('POST /api/webhooks/whatsapp — D4 removal handling', () => {
  it('removal reply bills FIRST, then sets removal_requested', async () => {
    const res = await POST(signedRequest(inbound('אנא הסירו אותי')));

    expect(res.status).toBe(200);
    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'k1',
        evidence: 'whatsapp_inbound_removal',
      }),
    );
    expect(markContactRemovalRequested).toHaveBeenCalledWith('k1');
    // Order matters: the bill must land before the removal guard is armed.
    expect(
      vi.mocked(recordReached).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(markContactRemovalRequested).mock.invocationCallOrder[0],
    );
  });

  it('a normal RSVP reply bills but does NOT set removal_requested', async () => {
    const res = await POST(signedRequest(inbound('אני מגיע, תודה')));

    expect(res.status).toBe(200);
    expect(recordReached).toHaveBeenCalledTimes(1);
    expect(recordReached).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: 'whatsapp_inbound_message' }),
    );
    expect(markContactRemovalRequested).not.toHaveBeenCalled();
  });

  it('honors removal on a deduped Meta retry without re-billing', async () => {
    vi.mocked(insertInteraction).mockResolvedValue(false);

    const res = await POST(signedRequest(inbound('הסר')));

    expect(res.status).toBe(200);
    expect(recordReached).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).toHaveBeenCalledWith('k1');
  });

  it('does not bill or remove when the sender is not a targeted contact', async () => {
    vi.mocked(resolveInboundContact).mockResolvedValue(null);

    const res = await POST(signedRequest(inbound('הסר')));

    expect(res.status).toBe(200);
    expect(recordReached).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without writing anything', async () => {
    const raw = JSON.stringify(inbound('הסר'));
    const req = new Request('https://kalfa.test/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      body: raw,
    }) as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(recordReached).not.toHaveBeenCalled();
    expect(markContactRemovalRequested).not.toHaveBeenCalled();
  });
});
