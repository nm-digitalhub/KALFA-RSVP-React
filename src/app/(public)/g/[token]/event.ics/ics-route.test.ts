import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tripwires for the public gift ICS route (same posture as gift-rate-limit.test.ts):
// token fingerprint in the rate-limit key, the shared inline text/calendar
// response, and ONLY event fields in the file — never the payment URL.
describe('/g/[token]/event.ics route', () => {
  const raw = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  // Identifier checks run on CODE only — the header comment legitimately names
  // what the file must NOT contain.
  const source = raw.replace(/^\s*\/\/.*$/gm, '');

  it('shape-checks the 32-hex token and rate-limits by fingerprint + IP, never the raw token', () => {
    expect(source).toMatch(/const TOKEN_RE = \/\^\[0-9a-f\]\{32\}\$\//);
    expect(source).toMatch(/import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/);
    expect(source).toMatch(/rateLimit\(`gift:ics:\$\{fp\}:\$\{ip\}`/);
    expect(source).toMatch(/rateLimit\(`gift:ics:ip:\$\{ip\}`/);
    expect(source).not.toMatch(/rateLimit\(`gift:ics:\$\{token\}/);
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('resolves the token through getGiftByToken and answers every failure with a bare 404', () => {
    expect(source).toContain("from '@/lib/data/gift'");
    expect(source).toMatch(/getGiftByToken\(token\)/);
    expect((source.match(/new Response\(null, \{ status: 404 \}\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('uses the library generator + shared response helper and exposes no payment or guest data', () => {
    expect(source).toContain("from '@/lib/calendar/event-calendar'");
    expect(source).toContain("from '@/lib/calendar/ics-response'");
    expect(source).not.toMatch(/gift_payment_url|payment|giftProvider|phone|full_name/);
    // The UID seed is the internal id, hashed inside renderIcs → calendarUid; the raw token never reaches the file.
    expect(source).toMatch(/renderIcs\(built, view\.id\)/);
    expect(source).not.toMatch(/renderIcs\([^)]*token/);
  });
});
