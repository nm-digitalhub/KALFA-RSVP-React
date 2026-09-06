import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventListItem } from '@/lib/data/events';

// getEventCounts is mocked alongside listEvents even though the page no longer
// imports it: the "one query" guarantee is the point of this route, so a
// reintroduced counts query has to fail a test rather than pass unnoticed.
const { listEvents, getEventCounts } = vi.hoisted(() => ({
  listEvents: vi.fn(),
  getEventCounts: vi.fn(),
}));
vi.mock('@/lib/data/events', () => ({ listEvents, getEventCounts }));

// A spy that behaves like the real redirect(): it THROWS, so anything after the
// call in the page would never run. Spying (rather than the pass-through mock
// used in settings/page.test.ts) is what lets these tests tell the two redirect
// targets apart — and prove the empty branch redirects nowhere at all.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
}));

import { redirect } from 'next/navigation';
import AppEntryPage from './page';

const EVENT_ID = '9f1c2d4e-6b0a-4c58-9a1e-7d3b5f8c2a10';
const OTHER_EVENT_ID = '3a7e5c81-24d9-4f6b-b0c3-1e8d92f4a765';

function eventRow(id: string, status: EventListItem['status']): EventListItem {
  return {
    id,
    name: 'חתונה',
    event_type: 'wedding',
    event_date: '2026-11-05T18:00:00+02:00',
    status,
    venue_name: null,
    created_at: '2026-09-01T09:00:00+03:00',
  };
}

// Flatten the returned React element tree (same helper shape as
// auth/confirm/page.test.ts).
function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { props?: { children?: unknown } };
  out.push(el as Record<string, unknown>);
  collect(el.props?.children, out);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/app — server-side entry routing', () => {
  it('no visible events → renders the welcome screen and does NOT redirect', async () => {
    listEvents.mockResolvedValue([]);

    const tree = await AppEntryPage();

    expect(redirect).not.toHaveBeenCalled();

    // Exactly one link: the single primary action. Counter cards, the "new
    // event" tile and the recent-events list are gone, and each of them would
    // add an href here.
    const hrefs = collect(tree)
      .map((el) => (el.props as { href?: string } | undefined)?.href)
      .filter((href): href is string => typeof href === 'string');

    expect(hrefs).toEqual(['/app/events/new']);
  });

  it.each(['draft', 'active', 'closed'] as const)(
    'a single visible event (status=%s) → redirects to that event, regardless of status',
    async (status) => {
      listEvents.mockResolvedValue([eventRow(EVENT_ID, status)]);

      await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT');

      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}`);
    },
  );

  it('two or more visible events → redirects to the events list', async () => {
    listEvents.mockResolvedValue([
      eventRow(EVENT_ID, 'active'),
      eventRow(OTHER_EVENT_ID, 'draft'),
    ]);

    await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/app/events');
  });

  it('the common case costs exactly one query: listEvents({ limit: 2 }), never getEventCounts', async () => {
    listEvents.mockResolvedValue([eventRow(EVENT_ID, 'active')]);

    await expect(AppEntryPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledWith({ limit: 2 });
    expect(getEventCounts).not.toHaveBeenCalled();
  });
});
