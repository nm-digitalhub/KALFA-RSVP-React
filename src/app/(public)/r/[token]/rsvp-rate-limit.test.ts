import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tripwire: the public RSVP page's rate-limit keys must be built from a
// tokenFingerprint(), never the raw guest token — a raw token in a rate-limit
// key sits in process memory keyed by exactly the secret it protects, and can
// surface in diagnostics. Textual on purpose (page.tsx is a Server Component)
// so a revert to the raw-token pattern fails loudly.

describe('public RSVP page rate-limit keys never embed the raw token', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('imports tokenFingerprint from the shared security module', () => {
    expect(source).toMatch(
      /import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/,
    );
  });

  it('does not build a rateLimit key from the raw token', () => {
    expect(source).not.toMatch(/rateLimit\(`rsvp:(read|attendees):\$\{token\}/);
  });

  it('builds both rate-limit keys from the fingerprint variable', () => {
    expect(source).toMatch(/rateLimit\(`rsvp:read:\$\{fp\}/);
    expect(source).toMatch(/rateLimit\(`rsvp:attendees:\$\{fp\}/);
  });
});

// The mutation site (production-readiness audit 21.8, §2 finding 5): the read
// site above was already fixed while the submit action — the more sensitive
// of the two, since it accepts a POST — still built its key from the raw
// token. Same tripwire shape, same file-under-test discipline.
describe('public RSVP submit action rate-limit key never embeds the raw token', () => {
  const source = readFileSync(join(__dirname, 'actions.ts'), 'utf8');

  it('imports tokenFingerprint from the shared security module', () => {
    expect(source).toMatch(
      /import\s*\{\s*tokenFingerprint\s*\}\s*from\s*'@\/lib\/security\/token-fingerprint'/,
    );
  });

  it('does not build the rateLimit key from the raw token', () => {
    expect(source).not.toMatch(/rateLimit\(`rsvp:submit:\$\{token\}/);
  });

  it('builds the rate-limit key from the fingerprint variable', () => {
    expect(source).toMatch(/rateLimit\(`rsvp:submit:\$\{fp\}/);
  });
});
