import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/workflows', () => ({ workflowRunsFingerprint: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/workflow/stream', () => ({ fetchEventsAfter: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { workflowRunsFingerprint } from '@/lib/data/admin/workflows';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET as streamGET } from './runs/[runId]/stream/route';
import { GET as latestGET } from './[id]/runs/latest/route';

beforeEach(() => vi.resetAllMocks());

describe.each([
  {
    name: 'stream',
    gate: vi.mocked(requirePlatformPermission),
    call: () => streamGET(new NextRequest('https://example.test/api/admin/workflows/runs/r1/stream'), { params: Promise.resolve({ runId: 'r1' }) }),
  },
  {
    name: 'latest',
    gate: vi.mocked(workflowRunsFingerprint),
    call: () => latestGET(new NextRequest('https://example.test/api/admin/workflows/w1/runs/latest'), { params: Promise.resolve({ id: 'w1' }) }),
  },
])('$name authorization', ({ gate, call }) => {
  it.each([
    ['/access-denied', 403, 'forbidden'],
    ['/auth/login', 401, 'unauthorized'],
  ] as const)('responds to %s without an HTML redirect', async (path, status, code) => {
    gate.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${path};307;`,
    }));
    const response = await call();
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: code });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('does not misclassify application failures as permission failures', async () => {
    const error = new Error('database unavailable');
    gate.mockRejectedValue(error);
    await expect(call()).rejects.toBe(error);
  });
});

it('preserves the authorized polling response', async () => {
  vi.mocked(workflowRunsFingerprint).mockResolvedValue('fingerprint');
  const response = await latestGET(new NextRequest('https://example.test/api/admin/workflows/w1/runs/latest'), { params: Promise.resolve({ id: 'w1' }) });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ fingerprint: 'fingerprint' });
});
