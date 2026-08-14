import { describe, expect, it } from 'vitest';

import { AGENT_STATUS_FRESHNESS_MS, effectivePresence } from './presence';

const NOW = Date.parse('2026-08-13T19:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('effectivePresence', () => {
  it('keeps a fresh status exactly as stored', () => {
    for (const s of ['ready', 'not_ready', 'dnd', 'in_call'] as const) {
      expect(effectivePresence(s, iso(1_000), NOW)).toBe(s);
    }
  });

  // The incident this module exists for: the only provisioned agent sat at
  // status 'ready' with a heartbeat 661 minutes old, so the roster advertised
  // "זמין" while every inbound call was (correctly) answered with "אין נציג
  // זמין". Router and roster must never disagree again.
  it('collapses a long-stale ready to offline (the 13.8 roster/router split)', () => {
    expect(effectivePresence('ready', iso(661 * 60_000), NOW)).toBe('offline');
  });

  it('collapses EVERY status when stale, not just ready', () => {
    for (const s of ['ready', 'not_ready', 'dnd', 'in_call'] as const) {
      expect(effectivePresence(s, iso(10 * 60_000), NOW)).toBe('offline');
    }
  });

  it('tolerates exactly one missed 60s beat, and no more', () => {
    // The panel beats every 60s; the window is 90s. One missed beat must not
    // evict a live agent, but a second one must.
    expect(effectivePresence('ready', iso(AGENT_STATUS_FRESHNESS_MS), NOW)).toBe('ready');
    expect(effectivePresence('ready', iso(AGENT_STATUS_FRESHNESS_MS + 1), NOW)).toBe('offline');
  });

  it('fails CLOSED on a missing or unparseable heartbeat', () => {
    // An agent we cannot prove is live must never be offered as a call
    // target — the same direction the server's own gate fails.
    expect(effectivePresence('ready', null, NOW)).toBe('offline');
    expect(effectivePresence('ready', undefined, NOW)).toBe('offline');
    expect(effectivePresence('ready', 'not-a-date', NOW)).toBe('offline');
    expect(effectivePresence('ready', '', NOW)).toBe('offline');
  });

  it('treats a future heartbeat as fresh rather than as an error', () => {
    // Small clock skew between the DB and a browser is normal; a timestamp
    // slightly ahead of `now` is not evidence the agent is gone.
    expect(effectivePresence('ready', iso(-5_000), NOW)).toBe('ready');
  });
});
