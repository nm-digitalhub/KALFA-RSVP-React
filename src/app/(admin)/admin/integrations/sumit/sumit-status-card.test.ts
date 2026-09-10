// The branch worth pinning: "your credentials are wrong" must not look like "SUMIT has
// a problem". Flattening them sends someone to re-check a key that was never wrong.
import { describe, expect, it } from 'vitest';

import { SumitStatusCard } from './sumit-status-card';

function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (typeof n === 'string' || typeof n === 'number') return void parts.push(String(n));
    if (Array.isArray(n)) return void n.forEach(visit);
    if (n && typeof n === 'object') visit((n as { props?: { children?: unknown } }).props?.children);
  };
  visit(node);
  return parts.join(' ');
}

describe('SumitStatusCard', () => {
  it('says "not set up" rather than "rejected" when there is nothing to check', () => {
    expect(textOf(SumitStatusCard({ health: null }))).toContain('לא הוזנו');
  });

  it('shows OUR company as the proof the credential pair resolved', () => {
    const text = textOf(
      SumitStatusCard({
        health: {
          ok: true, companyName: 'KALFA RSVP', corporateNumber: '316125434',
          documentsEmail: 'docs@example.com',
        },
      }),
    );
    expect(text).toContain('מחובר');
    expect(text).toContain('KALFA RSVP');
    expect(text).toContain('316125434');
  });

  it('warns that billing is actually stopped when the pair is rejected', () => {
    const text = textOf(
      SumitStatusCard({ health: { ok: false, kind: 'credentials_rejected', message: 'נדחו' } }),
    );
    expect(text).toContain('⚠️');
    expect(text).toContain('סליקה מושבתת');
  });

  it('does NOT blame our config for a fault at SUMIT or on the network', () => {
    for (const kind of ['provider_error', 'unreachable'] as const) {
      const text = textOf(SumitStatusCard({ health: { ok: false, kind, message: 'x' } }));
      expect(text).toContain('לא על הפרטים שלכם');
      expect(text).not.toContain('סליקה מושבתת');
    }
  });
});
