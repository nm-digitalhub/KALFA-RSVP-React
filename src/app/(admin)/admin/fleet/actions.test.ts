import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/admin/fleet', () => ({ answerFleetRequest: vi.fn() }));

import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { answerFleetRequest } from '@/lib/data/admin/fleet';
import { answerFleetRequestAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

// z.uuid() in Zod 4 requires a real RFC-4122 UUID — fixed v4 fixture.
const REQUEST_ID = '3f2c8a54-9b1d-4e6f-8a2b-7c5d9e0f1a2b';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin' } as never);
});

describe('answerFleetRequestAction — authorization', () => {
  it('propagates a requireAdmin redirect instead of returning { error }', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(
      answerFleetRequestAction(null, fd({ id: REQUEST_ID, verdict: 'approved' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(answerFleetRequest).not.toHaveBeenCalled();
  });
});

describe('answerFleetRequestAction — validation', () => {
  it('rejects a non-uuid id', async () => {
    const r = await answerFleetRequestAction(null, fd({ id: 'not-a-uuid', verdict: 'approved' }));
    expect(r?.fieldErrors?.id?.length).toBeGreaterThan(0);
    expect(answerFleetRequest).not.toHaveBeenCalled();
  });

  it('rejects an unknown verdict', async () => {
    const r = await answerFleetRequestAction(null, fd({ id: REQUEST_ID, verdict: 'maybe' }));
    expect(r?.fieldErrors?.verdict?.length).toBeGreaterThan(0);
    expect(answerFleetRequest).not.toHaveBeenCalled();
  });

  it('rejects an over-long answer', async () => {
    const r = await answerFleetRequestAction(
      null,
      fd({ id: REQUEST_ID, verdict: 'answered', answer: 'א'.repeat(2001) }),
    );
    expect(r?.fieldErrors?.answer?.length).toBeGreaterThan(0);
    expect(answerFleetRequest).not.toHaveBeenCalled();
  });
});

describe('answerFleetRequestAction — behavior', () => {
  it('passes a trimmed answer and null for empty, and logs activity', async () => {
    const r = await answerFleetRequestAction(
      null,
      fd({ id: REQUEST_ID, verdict: 'approved', answer: '  ' }),
    );
    expect(r?.notice).toBeTruthy();
    expect(answerFleetRequest).toHaveBeenCalledWith({
      id: REQUEST_ID,
      verdict: 'approved',
      answer: null,
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'fleet_request.answered',
      meta: { request_id: REQUEST_ID, verdict: 'approved' },
    });
  });

  it('returns the safe error message when the data layer rejects', async () => {
    vi.mocked(answerFleetRequest).mockRejectedValueOnce(new Error('הפנייה כבר נענתה או פגה'));
    const r = await answerFleetRequestAction(null, fd({ id: REQUEST_ID, verdict: 'denied' }));
    expect(r?.error).toBe('הפנייה כבר נענתה או פגה');
    expect(logActivity).not.toHaveBeenCalled();
  });
});
