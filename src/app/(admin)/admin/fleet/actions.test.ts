import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/admin/fleet', () => ({
  answerFleetRequest: vi.fn(),
  createOwnerFleetRequest: vi.fn(),
  createOwnerFleetContinuation: vi.fn(),
  readFleetRoles: vi.fn(),
}));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { revalidatePath } from 'next/cache';
import {
  answerFleetRequest,
  createOwnerFleetContinuation,
  createOwnerFleetRequest,
  readFleetRoles,
} from '@/lib/data/admin/fleet';
import { answerFleetRequestAction, createFleetRequestAction } from './actions';

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
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin' } as never);
});

describe('answerFleetRequestAction — authorization', () => {
  it('propagates the permission redirect instead of returning { error }', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(NEXT_REDIRECT);
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

describe('answerFleetRequestAction — B1 self-answer', () => {
  it('surfaces the data-layer refusal for an owner-opened request and logs nothing', async () => {
    vi.mocked(answerFleetRequest).mockRejectedValueOnce(new Error('לא ניתן להשיב לפנייה ששלחת'));
    const r = await answerFleetRequestAction(
      null,
      fd({ id: REQUEST_ID, verdict: 'answered', answer: 'כן' }),
    );
    expect(r?.error).toBe('לא ניתן להשיב לפנייה ששלחת');
    expect(logActivity).not.toHaveBeenCalled();
  });
});

const ROLES = [{ name: 'ops-monitor', enabled: true, tier: 0, reactive: [], scheduleSlots: 1 }];

describe('createFleetRequestAction — new message', () => {
  beforeEach(() => {
    vi.mocked(readFleetRoles).mockResolvedValue(ROLES);
    vi.mocked(createOwnerFleetRequest).mockResolvedValue({ id: REQUEST_ID, deduplicated: false });
  });

  it('uses the visible subject, defaults kind/tier, and revalidates the layout', async () => {
    const r = await createFleetRequestAction(
      null,
      fd({ role: 'ops-monitor', title: 'בדיקת גיבויים', body: 'נא לבדוק שהגיבוי של הלילה עבר' }),
    );
    expect(createOwnerFleetRequest).toHaveBeenCalledWith({
      role: 'ops-monitor',
      kind: 'question',
      tier: 0,
      title: 'בדיקת גיבויים',
      body: 'נא לבדוק שהגיבוי של הלילה עבר',
      threadRoot: null,
    });
    expect(r).toMatchObject({ requestId: REQUEST_ID, deduplicated: false, role: 'ops-monitor' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/fleet', 'layout');
  });

  it('falls back to "הודעה ל-<role>" when subject and first line are too short', async () => {
    await createFleetRequestAction(null, fd({ role: 'ops-monitor', title: '', body: 'כן\nזה בסדר גמור לבצע' }));
    expect(vi.mocked(createOwnerFleetRequest).mock.calls[0][0].title).toBe('הודעה ל-ops-monitor');
  });

  it('keeps the 10-character minimum so "כן" does not wake an agent run', async () => {
    const r = await createFleetRequestAction(null, fd({ role: 'ops-monitor', body: 'כן' }));
    expect(r?.fieldErrors?.body?.length).toBeGreaterThan(0);
    expect(createOwnerFleetRequest).not.toHaveBeenCalled();
  });

  it('refuses a role that fleet.json does not define', async () => {
    const r = await createFleetRequestAction(null, fd({ role: 'ghost-role', body: 'הודעה ארוכה מספיק' }));
    expect(r?.fieldErrors?.role?.length).toBeGreaterThan(0);
    expect(createOwnerFleetRequest).not.toHaveBeenCalled();
  });

  it('fails closed when fleet.json is unreadable', async () => {
    vi.mocked(readFleetRoles).mockResolvedValueOnce(null);
    const r = await createFleetRequestAction(null, fd({ role: 'ops-monitor', body: 'הודעה ארוכה מספיק' }));
    expect(r?.error).toBeTruthy();
    expect(createOwnerFleetRequest).not.toHaveBeenCalled();
  });

  it('reports a dedup hit with the existing id so the UI can focus it', async () => {
    vi.mocked(createOwnerFleetRequest).mockResolvedValueOnce({ id: REQUEST_ID, deduplicated: true });
    const r = await createFleetRequestAction(null, fd({ role: 'ops-monitor', body: 'הודעה ארוכה מספיק' }));
    expect(r).toMatchObject({ deduplicated: true, requestId: REQUEST_ID });
    expect(r?.notice).toContain('כבר נשלחה היום');
  });
});

describe('createFleetRequestAction — continuation ("השב" on a closed message)', () => {
  it('sends only the replied-to id; role/title/thread come from the server', async () => {
    vi.mocked(createOwnerFleetContinuation).mockResolvedValue({
      id: REQUEST_ID,
      deduplicated: false,
      role: 'ops-monitor',
    });
    const r = await createFleetRequestAction(
      null,
      // a tampered hidden role/title must be ignored on this path
      fd({ continueFrom: REQUEST_ID, body: 'עוד', role: 'social-manager', title: 'x' }),
    );
    expect(createOwnerFleetContinuation).toHaveBeenCalledWith({ continueFrom: REQUEST_ID, body: 'עוד' });
    expect(createOwnerFleetRequest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ role: 'ops-monitor', requestId: REQUEST_ID });
  });

  it('needs at least 2 characters and a real uuid', async () => {
    const short = await createFleetRequestAction(null, fd({ continueFrom: REQUEST_ID, body: 'א' }));
    expect(short?.fieldErrors?.body?.length).toBeGreaterThan(0);
    const bad = await createFleetRequestAction(null, fd({ continueFrom: 'nope', body: 'עוד פרט' }));
    expect(bad?.fieldErrors?.continueFrom?.length).toBeGreaterThan(0);
    expect(createOwnerFleetContinuation).not.toHaveBeenCalled();
  });
});
