// The branch worth pinning here is `fullyVerified`, which has THREE meanings and only
// one of them is a problem: true = fully verified, false = an optional record is
// outstanding while mail flows fine, null = the SMTP path, where DNS belongs to the
// relay. Collapsing false and null into "not verified" would invent a fault.
import { describe, expect, it } from 'vitest';

import { EmailHealthCard } from './email-health-card';

function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (typeof n === 'string' || typeof n === 'number') {
      parts.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n && typeof n === 'object') visit((n as { props?: { children?: unknown } }).props?.children);
  };
  visit(node);
  return parts.join(' ');
}

const ok = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  transport: 'resend' as const,
  from: 'KALFA <noreply@kalfa.me>',
  domain: 'kalfa.me',
  domainStatus: 'verified',
  records: [
    { record: 'DKIM', status: 'verified' },
    { record: 'SPF', status: 'verified' },
  ],
  fullyVerified: true,
  ...over,
});

describe('EmailHealthCard', () => {
  it('says "not configured" rather than "broken" when there is nothing to probe', () => {
    expect(textOf(EmailHealthCard({ health: null }))).toContain('אינו מוגדר');
  });

  it('shows the SPF and DKIM rows behind the verdict', () => {
    const text = textOf(EmailHealthCard({ health: ok() }));
    expect(text).toContain('DKIM');
    expect(text).toContain('SPF');
    expect(text).toContain('kalfa.me');
  });

  it('marks a partial verification WITHOUT calling it a failure', () => {
    const text = textOf(EmailHealthCard({ health: ok({ fullyVerified: false }) }));
    expect(text).toContain('אימות חלקי');
    expect(text).toContain('תקין');
  });

  it('explains the missing DNS verdict on the SMTP path instead of leaving a blank', () => {
    // null is not "unverified" — the relay rewrites and signs the body, so SPF/DKIM
    // state is its business. A blank here reads as a fault.
    const text = textOf(
      EmailHealthCard({ health: ok({ transport: 'smtp', fullyVerified: null, records: [] }) }),
    );
    expect(text).toContain('SMTP');
    expect(text).toContain('הממסר');
    expect(text).not.toContain('אימות חלקי');
  });

  it('separates "we could not ask" from "it is broken"', () => {
    // A sending-only key and provider throttling say nothing about the mail itself.
    for (const kind of ['key_restricted', 'rate_limited'] as const) {
      const text = textOf(EmailHealthCard({ health: { ok: false, kind, message: 'x' } }));
      expect(text).toContain('לא על הדואר עצמו');
    }
    const broken = textOf(
      EmailHealthCard({ health: { ok: false, kind: 'domain_failed', message: 'שבור' } }),
    );
    expect(broken).not.toContain('לא על הדואר עצמו');
    expect(broken).toContain('אימות הדומיין נשבר');
  });

  it('prints the provider status verbatim when one was observed', () => {
    // The SDK's own union lags its docs, so an unrecognised status must reach the eye.
    const text = textOf(
      EmailHealthCard({
        health: { ok: false, kind: 'domain_failed', message: 'x', observedStatus: 'temporary_failure' },
      }),
    );
    expect(text).toContain('temporary_failure');
  });
});
