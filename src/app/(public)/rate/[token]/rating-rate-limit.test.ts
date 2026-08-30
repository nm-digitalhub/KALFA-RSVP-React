import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tripwire: both the view (page.tsx) and submit (actions.ts) rate-limit keys
// must be built from a tokenFingerprint(), never the raw rating token — same
// reasoning and shape as g/[token]/gift-rate-limit.test.ts and
// r/[token]/rsvp-rate-limit.test.ts.

describe('public rating page rate-limit key never embeds the raw token', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('imports tokenFingerprint from the shared security module', () => {
    expect(source).toMatch(
      /import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/,
    );
  });

  it('does not build the rateLimit key from the raw token', () => {
    expect(source).not.toMatch(/rateLimit\(`rating:view:\$\{token\}/);
  });

  it('builds the rate-limit key from the fingerprint variable', () => {
    expect(source).toMatch(/rateLimit\(`rating:view:\$\{fp\}/);
  });
});

describe('rating submit action rate-limit key never embeds the raw token', () => {
  const source = readFileSync(join(__dirname, 'actions.ts'), 'utf8');

  it('imports tokenFingerprint from the shared security module', () => {
    expect(source).toMatch(
      /import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/,
    );
  });

  it('does not build the rateLimit key from the raw token', () => {
    expect(source).not.toMatch(/rateLimit\(`rating:submit:\$\{token\}/);
  });

  it('builds the rate-limit key from the fingerprint variable', () => {
    expect(source).toMatch(/rateLimit\(`rating:submit:\$\{fp\}/);
  });
});
