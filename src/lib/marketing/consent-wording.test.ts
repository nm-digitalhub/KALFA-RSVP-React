import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CONSENT_WORDING_VERSION, consentTemplate, renderConsentWording } from './consent-wording';

// Every wording version ever shipped, pinned to the SHA-256 of its template. Editing the template without adding a
// new version (and a new line here) fails this test — a recorded consent must always be traceable to one text.
const VERSION_HASHES: Record<string, string> = {
  '2026-10-11.1': '5909c85703bb9114214d2347dc37592066059a9d79f0e28ab72a3239517aa29a',
};

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('consent wording', () => {
  it('the current version is pinned to the current template', () => {
    expect(VERSION_HASHES[CONSENT_WORDING_VERSION]).toBe(sha(consentTemplate()));
  });

  it('names the configured legal entity and carries the version', () => {
    const w = renderConsentWording('נתנאל מבורך קלפה - KALFA RSVP');
    expect(w.text).toContain('נתנאל מבורך קלפה - KALFA RSVP');
    expect(w.text).not.toContain('{company}');
    expect(w.version).toBe(CONSENT_WORDING_VERSION);
  });

  it('never renders an empty advertiser name', () => {
    expect(renderConsentWording('  ').text).toContain('מ-KALFA ');
  });
});
