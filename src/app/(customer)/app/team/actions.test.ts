import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wiring tests for the unstable_rethrow migration: every mutation action here
// must propagate Next.js control-flow signals (redirect/notFound) thrown by
// requireActiveOrg() or the orgs.ts ownership/membership gate, and must still
// convert a genuine domain error into the existing friendly message.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({
  ACTIVE_ORG_COOKIE: 'active_org',
  getOrgContext: vi.fn(),
  requireActiveOrg: vi.fn(),
}));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://app.test${p}`) }));
vi.mock('@/lib/data/orgs', () => ({
  inviteMember: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import { requireActiveOrg } from '@/lib/auth/dal';
import { inviteMember } from '@/lib/data/orgs';
import { inviteMemberAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});
// Real notFound() digest format (verified against node_modules/next/dist/
// client/components/not-found.js): 'NEXT_HTTP_ERROR_FALLBACK;404'.
const NEXT_NOT_FOUND = Object.assign(new Error('NEXT_NOT_FOUND'), {
  digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActiveOrg).mockResolvedValue({
    orgId: 'org-1',
  } as unknown as Awaited<ReturnType<typeof requireActiveOrg>>);
});

describe('inviteMemberAction — Next.js control-flow signals', () => {
  it('propagates a NEXT_REDIRECT from inviteMember instead of returning { error }', async () => {
    vi.mocked(inviteMember).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      inviteMemberAction(null, fd({ email: 'a@b.com', role_id: '11111111-1111-4111-8111-111111111111' })),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('propagates a NEXT_NOT_FOUND from inviteMember instead of returning { error }', async () => {
    vi.mocked(inviteMember).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(
      inviteMemberAction(null, fd({ email: 'a@b.com', role_id: '11111111-1111-4111-8111-111111111111' })),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('converts a genuine domain error into its own message, not a thrown error', async () => {
    vi.mocked(inviteMember).mockRejectedValue(new Error('המשתמש כבר חבר בארגון'));

    const result = await inviteMemberAction(
      null,
      fd({ email: 'a@b.com', role_id: '11111111-1111-4111-8111-111111111111' }),
    );

    expect(result).toEqual({ error: 'המשתמש כבר חבר בארגון' });
  });

  it('falls back to the generic message for a non-Error rejection', async () => {
    vi.mocked(inviteMember).mockRejectedValue('boom');

    const result = await inviteMemberAction(
      null,
      fd({ email: 'a@b.com', role_id: '11111111-1111-4111-8111-111111111111' }),
    );

    expect(result).toEqual({ error: 'שליחת ההזמנה נכשלה' });
  });
});
