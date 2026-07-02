import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/events', () => ({ createEvent: vi.fn() }));

import { createEvent } from '@/lib/data/events';
import { createEventAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = { name: 'חתונה', event_type: 'wedding', event_date: '', venue_name: '' };

beforeEach(() => vi.clearAllMocks());

describe('createEventAction — Next.js control-flow signals', () => {
  it('propagates a NEXT_REDIRECT from createEvent (requireUser) instead of returning { error }', async () => {
    vi.mocked(createEvent).mockRejectedValue(NEXT_REDIRECT);

    await expect(createEventAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(createEvent).mockRejectedValue(new Error('db down'));

    const result = await createEventAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'יצירת האירוע נכשלה. נסו שוב.' });
  });
});
