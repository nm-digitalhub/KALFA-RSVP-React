import { describe, it, expect } from 'vitest';

import { RSVP_QUICK_REPLY, RSVP_QUICK_REPLY_PAYLOADS, RSVP_BUTTON_MAP } from './rsvp-buttons';

// The OUTBOUND payloads and the INBOUND map are ONE source of truth; this pins
// that they stay derived from the single ordered list (so send + receive, and the
// approved button order, can never silently drift).
describe('rsvp-buttons (single source of truth)', () => {
  it('outbound payloads are the approved button order', () => {
    expect(RSVP_QUICK_REPLY_PAYLOADS).toEqual(['rsvp_attending', 'rsvp_declined', 'rsvp_maybe']);
  });

  it('inbound map resolves each payload to its status', () => {
    expect(RSVP_BUTTON_MAP).toEqual({
      rsvp_attending: 'attending',
      rsvp_declined: 'declined',
      rsvp_maybe: 'maybe',
    });
  });

  it('the map is derived from the same ordered list (no drift)', () => {
    for (const { payload, status } of RSVP_QUICK_REPLY) {
      expect(RSVP_BUTTON_MAP[payload]).toBe(status);
    }
    expect(Object.keys(RSVP_BUTTON_MAP)).toEqual([...RSVP_QUICK_REPLY_PAYLOADS]);
  });
});
