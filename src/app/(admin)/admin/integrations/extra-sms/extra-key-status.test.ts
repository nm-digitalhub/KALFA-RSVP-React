// The 60-day card threshold lives here because it is the one branch on this page that
// can drift silently: it is deliberately different from the 30-day Slack threshold, and
// nothing else would notice if the two quietly became one number.
import { describe, expect, it } from 'vitest';

import { ExtraKeyStatus } from './extra-key-status';
import { EXTRA_KEY_WARN_DAYS } from './thresholds';

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

const healthy = (daysToExpiry: number | null, scopes: Record<string, unknown> | null = null) => ({
  ok: true as const,
  scopes,
  createdAt: '2025-10-27',
  expireAt: '2027-10-27',
  daysToExpiry,
  accountEmail: 'account@example.com',
});

describe('ExtraKeyStatus', () => {
  it('is quiet one day above the threshold and warns on it', () => {
    expect(textOf(ExtraKeyStatus({ health: healthy(EXTRA_KEY_WARN_DAYS + 1) }))).not.toContain('⚠️');
    expect(textOf(ExtraKeyStatus({ health: healthy(EXTRA_KEY_WARN_DAYS) }))).toContain('⚠️');
  });

  it('warns EARLIER than Slack does — 60, not 30', () => {
    // If someone collapses the two thresholds into one constant, this is what fails.
    expect(EXTRA_KEY_WARN_DAYS).toBe(60);
    expect(textOf(ExtraKeyStatus({ health: healthy(45) }))).toContain('⚠️');
  });

  it('shows the dates and the remaining days', () => {
    const text = textOf(ExtraKeyStatus({ health: healthy(412) }));
    expect(text).toContain('2027-10-27');
    expect(text).toContain('412');
  });

  it('reads a past expiry as elapsed, not as a negative countdown', () => {
    expect(textOf(ExtraKeyStatus({ health: healthy(-3) }))).toContain('פג לפני 3 ימים');
  });

  it('says an unscoped key is normal rather than leaving it to read as a fault', () => {
    expect(textOf(ExtraKeyStatus({ health: healthy(412, null) }))).toContain('לא תקלה');
    expect(textOf(ExtraKeyStatus({ health: healthy(412, { sms: true }) }))).not.toContain('לא תקלה');
  });

  it('omits the countdown entirely when the expiry could not be read', () => {
    // null means "we could not tell", which must not render as "0 days" or as fine.
    const text = textOf(ExtraKeyStatus({ health: healthy(null) }));
    expect(text).not.toContain('ימים לתפוגה');
    expect(text).not.toContain('⚠️');
  });

  it('separates a rejected key from an unreachable service', () => {
    expect(
      textOf(ExtraKeyStatus({ health: { ok: false, kind: 'key_invalid', message: 'לא תקף' } })),
    ).toContain('מפתח אינו תקף');
    expect(
      textOf(ExtraKeyStatus({ health: { ok: false, kind: 'unreachable', message: 'אין קשר' } })),
    ).toContain('לא ניתן לבדוק כעת');
  });
});
