import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tripwires for the public RSVP ICS route (same posture as rsvp-rate-limit.test.ts):
// the shared token shape guard, fingerprint-keyed rate limit, the inline
// text/calendar helper, and ONLY event fields — the guest record never enters it.
describe('/r/[token]/event.ics route', () => {
  const raw = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  // Identifier checks run on CODE only — the header comment legitimately names
  // what the file must NOT contain.
  const source = raw.replace(/^\s*\/\/.*$/gm, '');

  it('guards the token shape with the shared helper and rate-limits by fingerprint + IP', () => {
    expect(source).toMatch(/looksLikeRsvpToken\(token\)/);
    expect(source).toMatch(/import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/);
    expect(source).toMatch(/rateLimit\(`rsvp:ics:\$\{fp\}:\$\{ip\}`, RSVP_READ_RATE\)/);
    expect(source).toMatch(/rateLimit\(`rsvp:ics:ip:\$\{ip\}`/);
    expect(source).not.toMatch(/rateLimit\(`rsvp:ics:\$\{token\}/);
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('reads only view.event.* and answers every failure with a bare 404', () => {
    expect(source).toMatch(/getRsvpByToken\(token\)/);
    expect(source).not.toMatch(/view\.guest|full_name|phone|answers|rsvp_note|meal_pref|\.status/);
    expect((source.match(/new Response\(null, \{ status: 404 \}\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // The RPC lookup is wrapped: an RPC error is the same generic 404, never a 500.
    expect(source).toMatch(/try \{\s*view = await getRsvpByToken\(token\);\s*\} catch/);
    expect(source).toMatch(/renderIcs\(built, view\.event\.id\)/);
  });

  it('uses the library generator + shared response helper', () => {
    expect(source).toContain("from '@/lib/calendar/event-calendar'");
    expect(source).toContain("from '@/lib/calendar/ics-response'");
  });
});
