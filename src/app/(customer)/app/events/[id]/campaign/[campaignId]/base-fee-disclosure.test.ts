import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard: every customer surface that presents commercial terms
// BEFORE or AT the signature must disclose that the activation fee is charged
// unconditionally.
//
// WHY THIS EXISTS. The base fee is charged at 0 reached — `close-charge-amount.ts`
// adds `input.base` before any reached count is considered, and the agreement
// body (§3, `agreements/template.ts`) spells that out. The payment page and the
// agreement both said so. The approve page — the one the customer actually
// signs from — did not: it listed the per-reached price, the ceiling, the
// channels and the window, then closed with "חיוב רק על איש קשר שהושג"
// unconditionally. An owner could read that summary, sign, have nobody respond,
// and be charged the base fee anyway.
//
// That framing is the exact failure `fleet/business-facts.ts` documents (the
// 2026-07-26 compliance review): presenting an unconditional fee as
// outcome-conditional is a price misrepresentation, so the disclosure is not
// optional wording. The defect was a MISSING disclosure on one of three
// surfaces, which no type or test could catch — hence this guard.
//
// The rule enforced here: a surface that reads the campaign's commercial
// snapshot to show the customer what they are agreeing to must also read
// `base_price` and carry the unconditional-charge phrasing. Copy may be
// rewritten; it may not go back to quoting only the per-reached price.

const CAMPAIGN_ROOT = __dirname;

// The phrase the payment page and the agreement already use for "charged no
// matter what". Kept as the shared anchor so the three surfaces cannot drift
// into making differently-worded promises about the same fee.
const UNCONDITIONAL_PHRASE = 'נגבים בכל מקרה';

const SURFACES = [
  {
    label: 'approve page (the signature surface)',
    path: join(CAMPAIGN_ROOT, 'approve', 'page.tsx'),
  },
  {
    label: 'payment page (the card surface)',
    path: join(CAMPAIGN_ROOT, 'payment', 'page.tsx'),
  },
] as const;

describe('base fee is disclosed as unconditional on every pre-charge surface', () => {
  // Anti-no-op: if these pages move or are renamed, fail loudly rather than
  // silently guarding nothing.
  it('finds both surfaces on disk', () => {
    for (const { label, path } of SURFACES) {
      expect(() => readFileSync(path, 'utf8'), `${label} missing at ${path}`).not.toThrow();
    }
  });

  it.each(SURFACES)(
    '$label reads the campaign base_price snapshot',
    ({ path }) => {
      const source = readFileSync(path, 'utf8');
      // The snapshot field, never the live package — a surface that read the
      // package could show a figure the signed agreement does not contain.
      expect(source).toMatch(/campaign\.base_price/);
    },
  );

  it.each(SURFACES)(
    '$label states that the activation fee is charged regardless of outcome',
    ({ path }) => {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain(UNCONDITIONAL_PHRASE);
    },
  );

  // The specific regression: the approve page's closing claim must not assert
  // "charged only for a reached contact" without qualification. Before the fix
  // that sentence stood alone; now it is reachable only on the `basePrice === 0`
  // branch, where it is true.
  it('approve page does not make the reached-only claim unconditionally', () => {
    const source = readFileSync(join(CAMPAIGN_ROOT, 'approve', 'page.tsx'), 'utf8');
    const claim = 'חיוב רק על איש קשר שהושג';
    expect(source, 'the reached-only claim should still exist for zero-base campaigns')
      .toContain(claim);
    // It appears twice: once inside the base-fee branch (prefixed by the
    // unconditional disclosure) and once as the zero-base fallback. A single
    // occurrence means the branch was collapsed back to the old flat claim.
    const occurrences = source.split(claim).length - 1;
    expect(
      occurrences,
      'the reached-only claim must be branch-guarded, not stated flatly',
    ).toBeGreaterThan(1);
  });
});
