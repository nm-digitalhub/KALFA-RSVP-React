import { describe, expect, it, vi } from 'vitest';

import { getT } from '.';

describe('getT', () => {
  it('returns the Hebrew default exactly as written', () => {
    const text = 'הדף נטען מחדש… דו"ח של צ\'אט';
    expect(getT('public')('some.key', text)).toBe(text);
  });

  it('fills a placeholder and leaves a name unescaped', () => {
    const t = getT('customer');
    expect(t('greeting', 'שלום {{name}}', { name: 'ג\'ון "הגדול"' })).toBe('שלום ג\'ון "הגדול"');
  });

  it('keeps a geresh that sits right before a placeholder', () => {
    expect(getT('admin')('geresh', "ג'{{name}}", { name: 'ון' })).toBe("ג'ון");
  });

  // The sample data of the home page preview goes through i18next's formatters, so the Hebrew must come out as it was written.
  it('formats a date and a percent the way the Hebrew site writes them', () => {
    const t = getT('public');
    const date = new Date(2026, 5, 14);
    const formatParams = { date: { day: '2-digit', month: '2-digit', year: 'numeric' } };
    expect(t('date', '{{date, datetime}} · אולמי השרון', { date, formatParams })).toBe('14.06.2026 · אולמי השרון');
    expect(t('percent', '{{rate, number}}', { rate: 0.82, formatParams: { rate: { style: 'percent' } } })).toBe('82%');
  });

  it('picks the Hebrew plural form, and the general default for the `two` form', () => {
    const t = getT('public');
    const party = (count: number) =>
      t('party', {
        count,
        defaultValue: '{{count}} אורחים',
        defaultValue_one: '{{count}} אורח',
        defaultValue_other: '{{count}} אורחים',
      });
    expect(party(1)).toBe('1 אורח');
    expect(party(2)).toBe('2 אורחים');
    expect(party(4)).toBe('4 אורחים');
  });

  it('prints nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) => vi.spyOn(console, level));
    vi.resetModules();
    const fresh = await import('.');
    fresh.getT('common')('quiet', 'שקט');
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
