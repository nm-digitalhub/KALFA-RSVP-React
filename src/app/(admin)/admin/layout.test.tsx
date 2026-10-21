// The admin layout's softphone mount gate. The panel mounts only for an ACTIVE console agent: the layout asks
// is_console_agent() (the same check /api/agents/sdk-auth makes through requireConsoleAgent), not just whether
// console_me returned a vox_username — console_me also returns the row to an inactive agent, who then got a
// mounted softphone that sdk-auth refused with 403.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const state = vi.hoisted(() => ({
  consoleMe: { vox_username: 'agent-1', display_name: 'Agent One' } as Record<string, unknown> | null,
  isAgent: { data: true as unknown, error: null as unknown },
  softphoneFlag: true,
  rpcCalls: [] as string[],
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformStaff: vi.fn(async () => ({ id: 'u-1', email: 'a@kalfa.test' })) }));
vi.mock('@/lib/auth/platform-ability', () => ({ getPlatformAbility: vi.fn(async () => ({ rules: [] })) }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn(async () => ({ full_name: 'Agent One' })) }));
vi.mock('@/lib/data/exchange-connections', () => ({ getMyActiveExchangeConnection: vi.fn(async () => null) }));
vi.mock('@/lib/data/exchange-availability', () => ({ getMyPresence: vi.fn(), listMyAvailabilityBlocks: vi.fn() }));
vi.mock('@/lib/data/admin/nav-counts', () => ({ getAdminNavCounts: vi.fn(async () => ({})) }));
vi.mock('@/lib/data/admin/nav-visibility', () => ({ getAdminNavGrants: vi.fn(async () => ({})) }));
vi.mock('@/lib/data/console-softphone-config', () => ({
  consoleSoftphoneEnabled: vi.fn(async () => state.softphoneFlag),
  consoleHandoffEnabled: vi.fn(async () => false),
  consoleConsultConferenceEnabled: vi.fn(async () => false),
}));
vi.mock('@/lib/data/console-calls', () => ({ consoleWakeEnabled: vi.fn(async () => false), isShiftActiveAndFresh: vi.fn(() => false) }));
vi.mock('@/lib/data/console-queues', () => ({ getAgentQueueMemberships: vi.fn(async () => []) }));
vi.mock('@/components/admin-shell', () => ({ AdminShell: () => null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const chain = (data: unknown) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }) };
      return q;
    };
    return {
      from: (table: string) => chain(table === 'console_me' ? state.consoleMe : null),
      rpc: async (fn: string) => {
        state.rpcCalls.push(fn);
        return fn === 'is_console_agent' ? state.isAgent : { data: null, error: { message: 'unexpected rpc' } };
      },
    };
  }),
}));

import AdminLayout from './layout';

async function softphoneProps() {
  const el = (await AdminLayout({ children: null })) as ReactElement<{ softphone: { enabled: boolean; voxUsername: string | null } }>;
  return el.props.softphone;
}

beforeEach(() => {
  state.consoleMe = { vox_username: 'agent-1', display_name: 'Agent One' };
  state.isAgent = { data: true, error: null };
  state.softphoneFlag = true;
  state.rpcCalls = [];
});

describe('admin layout — softphone mount gate', () => {
  it('an active agent with the flag on gets the softphone', async () => {
    expect(await softphoneProps()).toMatchObject({ enabled: true, voxUsername: 'agent-1' });
    expect(state.rpcCalls).toContain('is_console_agent');
  });

  it('an INACTIVE agent (console_me still returns its row) gets no softphone', async () => {
    state.isAgent = { data: false, error: null };
    expect(await softphoneProps()).toMatchObject({ enabled: false });
  });

  it('fails closed when is_console_agent() errors', async () => {
    state.isAgent = { data: null, error: { message: 'boom' } };
    expect(await softphoneProps()).toMatchObject({ enabled: false });
  });

  it('the feature flag still gates an active agent', async () => {
    state.softphoneFlag = false;
    expect(await softphoneProps()).toMatchObject({ enabled: false });
  });
});
