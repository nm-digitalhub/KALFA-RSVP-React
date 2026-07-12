import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForHold: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/outreach', () => ({ sendCampaignWhatsApp: vi.fn() }));

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getCampaignForHold } from '@/lib/data/campaigns';
import {
  getOutreachEnabled,
  getWhatsAppConfig,
} from '@/lib/data/outreach-config';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(
    `${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/whatsapp-send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: form.toString(),
    },
  ) as unknown as NextRequest;
}

function callPost(req: NextRequest) {
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

describe('POST /api/campaigns/[id]/whatsapp-send — CSRF origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requireUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getCampaignForHold).mockResolvedValue({
      id: CAMPAIGN_ID,
      event_id: EVENT_ID,
      status: 'active',
      max_charge_ceiling: 100,
      capture_status: 'authorized',
    } as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: EVENT_ID,
      name: 'Test Event',
      status: 'active',
      // Well into the future — never "past" regardless of when this runs.
      event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      rsvp_deadline: null,
    } as never);
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue({
      phoneNumberId: 'p',
      wabaId: 'w',
      accessToken: 'a',
      appSecret: 's',
      verifyToken: 'v',
    });
    vi.mocked(sendCampaignWhatsApp).mockResolvedValue({ sent: 1, skipped: 0, blocked: false });
  });

  it('reaches sendCampaignWhatsApp for a same-origin POST', async () => {
    const res = await callPost(
      request({ message_key: 'rsvp_reminder' }, { Origin: APP_ORIGIN }),
    );
    expect(sendCampaignWhatsApp).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      'rsvp_reminder',
    );
    expect(res.status).toBe(303);
  });

  it('rejects a cross-origin POST with 403, without calling sendCampaignWhatsApp', async () => {
    const res = await callPost(
      request(
        { message_key: 'rsvp_reminder' },
        { Origin: 'https://evil.test' },
      ),
    );
    expect(res.status).toBe(403);
    expect(sendCampaignWhatsApp).not.toHaveBeenCalled();
  });

  it('rejects a POST with no Origin and no Referer with 403, without calling sendCampaignWhatsApp', async () => {
    const res = await callPost(request({ message_key: 'rsvp_reminder' }, {}));
    expect(res.status).toBe(403);
    expect(sendCampaignWhatsApp).not.toHaveBeenCalled();
  });
});
