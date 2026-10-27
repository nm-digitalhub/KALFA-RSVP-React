import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { requireConsoleAction, type ConsoleAgentContext } from '@/lib/auth/console-agent';
import { PLATFORM_ACTIONS } from '@/lib/casl';

// The Bearer API's action gate (openspec/changes/casl-console-ability-foundation, task 5.1): the key comes from the
// CASL action map and is checked by has_platform_permission AS the caller; anything but an explicit true is a 403.
function ctxWith(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { rpc, ctx: { userId: 'staff-1', supabase: { rpc } } as unknown as ConsoleAgentContext };
}

describe('requireConsoleAction', () => {
  it('checks the key the action map binds, as the caller', async () => {
    const { rpc, ctx } = ctxWith({ data: true, error: null });

    await expect(requireConsoleAction(ctx, 'runstate', 'Campaign')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('has_platform_permission', { _key: PLATFORM_ACTIONS.Campaign.runstate });
    expect(PLATFORM_ACTIONS.Campaign.runstate).toBe('campaigns.runstate');
  });

  it.each([
    ['the key is not held', { data: false, error: null }],
    ['the check errors', { data: null, error: { message: 'boom' } }],
    ['the answer is not a boolean true', { data: 'true', error: null }],
  ])('fails closed with 403 when %s', async (_case, result) => {
    const { ctx } = ctxWith(result);

    await expect(requireConsoleAction(ctx, 'runstate', 'Campaign')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'אין הרשאה',
    });
  });
});
