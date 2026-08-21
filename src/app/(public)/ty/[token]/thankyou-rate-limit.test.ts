import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tripwire: the public thank-you page's rate-limit key must be built from a
// tokenFingerprint(), never the raw guest token — a raw token in a rate-limit
// key sits in process memory keyed by exactly the secret it protects, and can
// surface in diagnostics. Textual on purpose (page.tsx is a Server Component)
// so a revert to the raw-token pattern fails loudly. Same shape as
// r/[token]/rsvp-rate-limit.test.ts (production-readiness audit 21.8, §2
// finding 5 — this site was one of the ones still on the raw token).

describe('public thank-you page rate-limit key never embeds the raw token', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('imports tokenFingerprint from the shared security module', () => {
    expect(source).toMatch(
      /import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/,
    );
  });

  it('does not build the rateLimit key from the raw token', () => {
    expect(source).not.toMatch(/rateLimit\(`ty:view:\$\{token\}/);
  });

  it('builds the rate-limit key from the fingerprint variable', () => {
    expect(source).toMatch(/rateLimit\(`ty:view:\$\{fp\}/);
  });
});
