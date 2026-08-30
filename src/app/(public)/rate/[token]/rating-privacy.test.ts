import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Privacy tripwire: the rating page renders NOTHING identifying about the
// inquiry (docs/admin-contacts-redesign-plan-2026-08-25.md §4.3 — "the page
// must render nothing identifying. No name, no inquiry subject, no email").
// Textual on purpose (page.tsx/rating-form.tsx are largely Server/Client
// Components) so a future "let's show the customer's name for a nicer
// greeting" change fails CI loudly instead of shipping a silent leak. Same
// shape as r/[token]/rsvp-privacy.test.ts.

// Matches actual property/column access (`.name`, `msg.email`, a `.select`
// string mentioning the field) — NOT bare English words, which would false-
// positive on this file's own prose comments (e.g. "never name/email/phone").
const FORBIDDEN_FIELDS =
  /[.'"](?:name|email|phone|message|internal_note|draft_reply|sent_reply|thread_id|topic|source)\b/;

describe('public rating page never references identifying inquiry fields', () => {
  for (const file of ['page.tsx', 'rating-form.tsx', 'actions.ts']) {
    it(`${file} has no reference to an identifying contact_messages field`, () => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(FORBIDDEN_FIELDS);
    });
  }
});

describe('getRatingByToken selects only the id column', () => {
  it('the resolver in inquiry-rating.ts selects id only', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'lib', 'data', 'inquiry-rating.ts'),
      'utf8',
    );
    expect(source).toMatch(/\.select\('id'\)/);
    expect(source).not.toMatch(FORBIDDEN_FIELDS);
  });
});
