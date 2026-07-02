import { beforeEach, describe, expect, it, vi } from 'vitest';

// The catch block here has two DIFFERENT destinations depending on what was
// thrown: a genuine domain error redirects to the join page with ?error=1,
// while a Next.js control-flow signal (e.g. requireUser()'s redirect to
// /auth/login) must propagate UNCHANGED -- not be rewritten to ?error=1.

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
  }),
}));
vi.mock('@/lib/auth/dal', () => ({ ACTIVE_ORG_COOKIE: 'active_org' }));
vi.mock('@/lib/data/orgs', () => ({ acceptInvitation: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: vi.fn() })),
}));

import { acceptInvitation } from '@/lib/data/orgs';
import { acceptInvitationAction } from './actions';

// requireUser()'s real redirect target inside acceptInvitation.
const AUTH_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(token: string): FormData {
  const f = new FormData();
  f.set('token', token);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('acceptInvitationAction — Next.js control-flow signals', () => {
  it('propagates requireUser()\'s NEXT_REDIRECT to /auth/login unchanged, not rewritten to ?error=1', async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(AUTH_REDIRECT);

    await expect(acceptInvitationAction(fd('tok-1'))).rejects.toMatchObject({
      digest: expect.stringContaining('/auth/login'),
    });
  });

  it('redirects to the join page with ?error=1 on a genuine (non-framework) failure', async () => {
    vi.mocked(acceptInvitation).mockRejectedValue(new Error('ההזמנה אינה תקפה'));

    await expect(acceptInvitationAction(fd('tok-1'))).rejects.toMatchObject({
      digest: expect.stringContaining('/join/tok-1?error=1'),
    });
  });
});
