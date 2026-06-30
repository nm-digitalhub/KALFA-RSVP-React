import { beforeEach, describe, expect, it, vi } from 'vitest';

// S2.3a — the bug this fixes: the old `event_date: event_date ? event_date :
// null` mapping collapsed "key absent from FormData" (a disabled, non-draft
// input — never POSTed by the browser) and "key present with an empty value"
// (a draft owner explicitly clearing the field) into the same `null`, which is
// exactly the ambiguity updateEvent's key-presence contract (S2.3) exists to
// prevent. FormData.has(...) is the only reliable signal.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ updateEvent: vi.fn() }));

import { updateEvent } from '@/lib/data/events';
import { updateEventAction } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BASE = {
  name: 'חתונה',
  event_type: 'wedding',
  venue_name: '',
  venue_address: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateEvent).mockResolvedValue(
    {} as unknown as Awaited<ReturnType<typeof updateEvent>>,
  );
});

describe('updateEventAction — FormData.has() presence mapping', () => {
  it('omits the event_date key entirely when the field is absent from FormData (disabled, non-draft input)', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE })); // no event_date entry at all

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('event_date' in input).toBe(false);
  });

  it('includes the event_date key (as null) when FormData has it as an empty string (draft owner clearing it)', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE, event_date: '' }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('event_date' in input).toBe(true);
    expect(input.event_date).toBeNull();
  });

  it('omits the rsvp_deadline key entirely when the field is absent from FormData', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect('rsvp_deadline' in input).toBe(false);
  });

  it('includes a present, non-empty date value trimmed', async () => {
    await updateEventAction(
      'e-1',
      null,
      fd({ ...BASE, event_date: '2026-12-01 ' }),
    );

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(input.event_date).toBe('2026-12-01');
  });

  it('never forwards a status key, even if a stale client posts one', async () => {
    await updateEventAction('e-1', null, fd({ ...BASE, status: 'active' }));

    const input = vi.mocked(updateEvent).mock.calls[0][1];
    expect(Object.hasOwn(input, 'status')).toBe(false);
  });
});
