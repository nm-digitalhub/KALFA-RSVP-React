import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));

import { requireManageVoiceAgent } from './route-auth';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';

const ctx = { userId: 'agent-1', supabase: { marker: 'caller-scoped' } };
const request = new Request('https://kalfa.test/api/x', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: true, ctx } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
});

describe('requireManageVoiceAgent', () => {
  it('passes the caller context through when both gates pass', async () => {
    const auth = await requireManageVoiceAgent(request);
    expect(auth).toEqual({ ok: true, ctx });
    expect(callerHasPlatformPermission).toHaveBeenCalledWith(ctx.supabase, 'manage_voice');
  });

  it('answers the console-agent failure as-is and never asks for the permission', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: false, status: 401, error: 'לא מורשה' });
    const auth = await requireManageVoiceAgent(request);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(401);
    expect(auth.response.headers.get('cache-control')).toBe('no-store');
    expect(await auth.response.json()).toEqual({ error: 'לא מורשה' });
    expect(callerHasPlatformPermission).not.toHaveBeenCalled();
  });

  it('answers 403 for a console agent without manage_voice', async () => {
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    const auth = await requireManageVoiceAgent(request);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(403);
    expect(await auth.response.json()).toEqual({ error: 'אין הרשאה' });
  });
});
