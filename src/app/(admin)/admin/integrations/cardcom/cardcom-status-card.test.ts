import { describe, expect, it } from 'vitest';

import { CardcomStatusCard } from './cardcom-status-card';

// Called as a plain function: it renders to a tree of elements, which is all this needs.
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

const config = (over = {}) => ({
  exists: true, terminalNumber: 1001, apiName: 'kalfa-api', enabled: true, hasPassword: true, isTestTerminal: false,
  updatedAt: '2026-10-07T10:00:00.000Z', ...over,
});

describe('CardcomStatusCard', () => {
  it('says nothing is set up when no connection was saved', () => {
    expect(textOf(CardcomStatusCard({ config: { ...config(), exists: false } }))).toContain('לא הוזנו פרטי CardCom');
  });

  it('says whether the pilot is on, and never claims the connection works', () => {
    const on = textOf(CardcomStatusCard({ config: config() }));
    expect(on).toContain('מופעל');
    expect(on).not.toContain('מחובר');
    expect(textOf(CardcomStatusCard({ config: config({ enabled: false }) }))).toContain('כבוי');
  });

  it('flags a missing password', () => {
    expect(textOf(CardcomStatusCard({ config: config({ hasPassword: false, enabled: false }) }))).toContain('אין סיסמת API שמורה');
  });

  it('warns on the test terminal that nothing is charged and only a platform admin may buy', () => {
    const text = textOf(CardcomStatusCard({ config: config({ terminalNumber: 1000, isTestTerminal: true }) }));
    expect(text).toContain('מסוף בדיקות');
    expect(text).toContain('מנהל פלטפורמה בלבד');
  });

  it('does not warn on a real terminal', () => {
    expect(textOf(CardcomStatusCard({ config: config() }))).not.toContain('מסוף בדיקות');
  });
});
