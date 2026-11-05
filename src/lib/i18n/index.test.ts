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
