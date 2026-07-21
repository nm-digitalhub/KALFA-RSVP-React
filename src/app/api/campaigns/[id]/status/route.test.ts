import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { POST } from './route';
import { requireConsoleAgent, callerHasPlatformPermission } from '@/lib/auth/console-agent';
import { createAdminClient } from '@/lib/supabase/admin';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function req(action: string, id: string = CAMPAIGN_ID): Request {
  return new Request(`https://beta.kalfa.me/api/campaigns/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: JSON.stringify({ action }),
  });
}
const ctx = (id: string = CAMPAIGN_ID) => ({ params: Promise.resolve({ id }) });

// A chainable stand-in for the service-role client. Reads terminate at
// maybeSingle() (campaigns → campaignRow, events → eventRow); update chains are
// awaited directly, resolving via `then` to { error: updateError }.
function mockAdmin(opts: {
  campaignRow?: { data: unknown; error: unknown };
  eventRow?: { data: unknown; error: unknown };
  updateError?: unknown;
}) {
  const { campaignRow = { data: null, error: null }, eventRow = { data: { status: 'active' }, error: null }, updateError = null } = opts;
  const makeChain = (table: string) => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      update: vi.fn(() => c),
      eq: vi.fn(() => c),
      in: vi.fn(() => c),
      maybeSingle: vi.fn(() => Promise.resolve(table === 'events' ? eventRow : campaignRow)),
      then: (resolve: (v: unknown) => void) => resolve({ error: updateError }),
    };
    return c;
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn((t: string) => makeChain(t)) } as never);
}

function authOk(hasManageVoice = true) {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(hasManageVoice as never);
}

describe('POST /api/campaigns/[id]/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 when not authenticated', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: false, status: 401, error: 'לא מורשה' } as never);
    expect((await POST(req('pause'), ctx())).status).toBe(401);
  });

  it('403 without manage_voice', async () => {
    authOk(false);
    expect((await POST(req('pause'), ctx())).status).toBe(403);
  });

  it('400 on an unknown action', async () => {
    authOk();
    expect((await POST(req('delete'), ctx())).status).toBe(400);
  });

  it('404 when the campaign does not exist', async () => {
    authOk();
    mockAdmin({ campaignRow: { data: null, error: null } });
    expect((await POST(req('pause'), ctx())).status).toBe(404);
  });

  it('pauses an active campaign', async () => {
    authOk();
    mockAdmin({ campaignRow: { data: { id: CAMPAIGN_ID, status: 'active', event_id: EVENT_ID, capture_status: 'authorized' }, error: null } });
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'paused' });
  });

  it('409 when pausing a non-active campaign', async () => {
    authOk();
    mockAdmin({ campaignRow: { data: { id: CAMPAIGN_ID, status: 'paused', event_id: EVENT_ID, capture_status: 'authorized' }, error: null } });
    expect((await POST(req('pause'), ctx())).status).toBe(409);
  });

  it('409 when activating without an authorized J5 hold', async () => {
    authOk();
    mockAdmin({ campaignRow: { data: { id: CAMPAIGN_ID, status: 'paused', event_id: EVENT_ID, capture_status: 'pending' }, error: null } });
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('תפיסת מסגרת') });
  });

  it('activates an authorized, paused campaign on an active event', async () => {
    authOk();
    mockAdmin({
      campaignRow: { data: { id: CAMPAIGN_ID, status: 'paused', event_id: EVENT_ID, capture_status: 'authorized' }, error: null },
      eventRow: { data: { status: 'active' }, error: null },
    });
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active' });
  });

  it('409 when activating for a non-active event', async () => {
    authOk();
    mockAdmin({
      campaignRow: { data: { id: CAMPAIGN_ID, status: 'approved', event_id: EVENT_ID, capture_status: 'authorized' }, error: null },
      eventRow: { data: { status: 'closed' }, error: null },
    });
    expect((await POST(req('activate'), ctx())).status).toBe(409);
  });
});
