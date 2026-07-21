import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// The lifecycle itself is tested in campaigns.test.ts (including the console
// narrowing and every guard). Here the contract under test is that the route
// DELEGATES to it with the right actor and maps its refusals to HTTP.
vi.mock('@/lib/data/campaigns', () => ({
  activateCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
}));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { activateCampaign, pauseCampaign } from '@/lib/data/campaigns';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { createAdminClient } from '@/lib/supabase/admin';

const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';

function req(action: unknown, id = CAMPAIGN_ID): Request {
  return new Request(`https://beta.kalfa.me/api/campaigns/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: JSON.stringify({ action }),
  });
}
const ctx = (id = CAMPAIGN_ID) => ({ params: Promise.resolve({ id }) });

function campaignRow(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'maybeSingle']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => builder),
  } as never);
}

function authOk(hasPermission = true) {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: STAFF_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(hasPermission as never);
}

const FOUND = { id: CAMPAIGN_ID, event_id: EVENT_ID, events: { owner_id: OWNER_ID } };

describe('POST /api/campaigns/[id]/status', () => {
  // resetAllMocks, not clearAllMocks: clear wipes recorded CALLS but keeps
  // implementations, so a mockRejectedValue set by one test leaks into the next
  // and fails it for the wrong reason (observed while writing these).
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(activateCampaign).mockResolvedValue(undefined);
    vi.mocked(pauseCampaign).mockResolvedValue(undefined);
    vi.mocked(recordStaffAccess).mockResolvedValue(undefined);
  });

  it('401 when the Bearer session is not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req('pause'), ctx())).status).toBe(401);
  });

  // The authority is campaigns.runstate, NOT manage_voice: pausing a campaign
  // also stops its WhatsApp sends, which is outside what a key documented as
  // "ניהול מוקד שיחות AI" promises. See migration 20260721183855.
  it('gates on campaigns.runstate specifically', async () => {
    authOk(false);
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(403);
    expect(callerHasPlatformPermission).toHaveBeenCalledWith(
      expect.anything(),
      'campaigns.runstate',
    );
  });

  it('400 on an unknown action', async () => {
    authOk();
    expect((await POST(req('delete'), ctx())).status).toBe(400);
  });

  it('400 on a malformed campaign id', async () => {
    authOk();
    expect((await POST(req('pause', 'not-a-uuid'), ctx('not-a-uuid'))).status).toBe(400);
  });

  it('404 when the campaign does not exist — as JSON, not a rendered page', async () => {
    authOk();
    campaignRow(null);
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(pauseCampaign).not.toHaveBeenCalled();
  });

  it('pause delegates to pauseCampaign with a console actor', async () => {
    authOk();
    campaignRow(FOUND);
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'paused' });
    expect(pauseCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      kind: 'console',
      staffUserId: STAFF_ID,
    });
  });

  it('activate delegates to activateCampaign with a console actor', async () => {
    authOk();
    campaignRow(FOUND);
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active' });
    expect(activateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      kind: 'console',
      staffUserId: STAFF_ID,
    });
  });

  // Every refusal the domain layer raises is "understood, but the state forbids
  // it" — the caller must see the real reason, not a generic 500.
  it.each([
    'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי',
    'האירוע כבר חלף — לא ניתן לבצע פעולה זו עבור אירוע שמועדו עבר',
    'יש לפרסם את האירוע לפני אישורי הגעה',
  ])('maps "%s" to 409 with the reason intact', async (message) => {
    authOk();
    campaignRow(FOUND);
    vi.mocked(activateCampaign).mockRejectedValue(new Error(message));
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: message });
  });

  it('an unexpected failure is 500 and does NOT leak the message', async () => {
    authOk();
    campaignRow(FOUND);
    vi.mocked(pauseCampaign).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1'));
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('ECONNREFUSED');
  });

  it('writes a staff-access audit row for a successful transition', async () => {
    authOk();
    campaignRow(FOUND);
    await POST(req('pause'), ctx());
    expect(recordStaffAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: STAFF_ID,
        permission: 'campaigns.runstate',
        subjectType: 'campaign',
        subjectId: CAMPAIGN_ID,
        ownerId: OWNER_ID,
        eventId: EVENT_ID,
      }),
    );
  });

  it('does NOT audit a refused transition', async () => {
    authOk();
    campaignRow(FOUND);
    vi.mocked(activateCampaign).mockRejectedValue(
      new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי'),
    );
    await POST(req('activate'), ctx());
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });

  // The state has already changed by the time the audit runs; throwing here
  // would report failure for work that was done. It is logged loudly instead.
  it('still answers 200 when the audit write fails', async () => {
    authOk();
    campaignRow(FOUND);
    vi.mocked(recordStaffAccess).mockRejectedValue(new Error('audit down'));
    expect((await POST(req('pause'), ctx())).status).toBe(200);
  });
});
