import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({
  activateCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
}));

import { POST } from './route';
import { requireConsoleAgent, callerHasPlatformPermission } from '@/lib/auth/console-agent';
import { createAdminClient } from '@/lib/supabase/admin';
import { activateCampaign, pauseCampaign } from '@/lib/data/campaigns';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

function req(action: string, id: string = CAMPAIGN_ID): Request {
  return new Request(`https://beta.kalfa.me/api/campaigns/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: JSON.stringify({ action }),
  });
}
const ctx = (id: string = CAMPAIGN_ID) => ({ params: Promise.resolve({ id }) });

// Existence pre-check stub: from('campaigns').select('id').eq('id', id).maybeSingle().
function mockAdmin(campaignRow: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    maybeSingle: vi.fn(() => Promise.resolve(campaignRow)),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => c) } as never);
}

function authOk(hasManageVoice = true) {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(hasManageVoice as never);
}

const found = { data: { id: CAMPAIGN_ID }, error: null };

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
    mockAdmin({ data: null, error: null });
    expect((await POST(req('pause'), ctx())).status).toBe(404);
    expect(pauseCampaign).not.toHaveBeenCalled();
  });

  it('pauses via the canonical pauseCampaign with console authz', async () => {
    authOk();
    mockAdmin(found);
    vi.mocked(pauseCampaign).mockResolvedValue(undefined as never);
    const res = await POST(req('pause'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'paused' });
    expect(pauseCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, 'console');
  });

  it('activates via the canonical activateCampaign with console authz', async () => {
    authOk();
    mockAdmin(found);
    vi.mocked(activateCampaign).mockResolvedValue(undefined as never);
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'active' });
    expect(activateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, 'console');
  });

  it('surfaces a canonical business-rule failure as 409 with its message', async () => {
    authOk();
    mockAdmin(found);
    vi.mocked(activateCampaign).mockRejectedValue(new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי') as never);
    const res = await POST(req('activate'), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('לא ניתן לשנות') });
  });
});
