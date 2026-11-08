import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallContext } from '@/lib/data/call-attempts';
import { TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

vi.mock('server-only', () => ({}));

const { ctxMock } = vi.hoisted(() => ({ ctxMock: vi.fn() }));
// Only the lookup is faked; TERMINAL_STATUSES stays the REAL exported set, so this
// suite fails the day the route drifts from it again.
vi.mock('@/lib/data/call-attempts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/call-attempts')>()),
  getCallContextByAccessToken: ctxMock,
}));

import { GET } from './route';

const TOKEN = 'a'.repeat(32);

// One attempt for an active event, with a token that is still valid.
function callContext(status: CallContext['attempt']['status']): CallContext {
  return {
    attempt: {
      id: 'attempt-1',
      status,
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      guest_id: 'guest-1',
      event_id: 'event-1',
      contact_id: 'contact-1',
      el_correlation_nonce: null,
    },
    event: {
      status: 'active',
      name: 'החתונה של דנה ויוסי',
      event_date: '2999-06-01T17:30:00+03:00',
      venue_name: 'אולם הגן',
      venue_address: 'רחוב הפרחים 1',
      event_type: 'wedding',
      celebrants: null,
      rsvp_deadline: null,
    },
    guestFullName: 'דנה כהן',
  };
}

const call = () =>
  GET(
    new Request(`https://kalfa.test/api/voximplant/ctx/${TOKEN}`, {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  );

beforeEach(() => {
  __resetRateLimitStateForTests();
  ctxMock.mockReset();
});

describe('GET /api/voximplant/ctx/[token] — terminal attempts', () => {
  it.each(TERMINAL_STATUSES)('a %s attempt gets the generic 404 and no guest data', async (status) => {
    ctxMock.mockResolvedValue(callContext(status));
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('a call that was handed off to a human no longer serves the guest context', async () => {
    ctxMock.mockResolvedValue(callContext('handed_off'));
    expect((await call()).status).toBe(404);
  });

  it('a live attempt still gets its context', async () => {
    ctxMock.mockResolvedValue(callContext('in_progress'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ guest_name: 'דנה כהן', event_kind: 'חתונה' });
  });
});
