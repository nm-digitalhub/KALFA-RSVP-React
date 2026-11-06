import { describe, expect, it } from 'vitest';

import { EVENT_THEME, eventGreetings, eventThankyouGreetings } from '@/lib/data/event-theme';
import { getT } from '@/lib/i18n';
import { EVENT_TYPES } from '@/lib/validation/schemas';

describe('EVENT_THEME', () => {
  it('covers every event type with non-empty static classes', () => {
    for (const type of EVENT_TYPES) {
      const theme = EVENT_THEME[type];
      expect(theme, type).toBeDefined();
      expect(theme.accent, type).toMatch(/^text-/);
      expect(theme.banner, type).toContain('bg-linear-to-b');
    }
  });

  it('has no extra keys beyond the event-type enum', () => {
    expect(Object.keys(EVENT_THEME).sort()).toEqual([...EVENT_TYPES].sort());
  });
});

describe.each([
  ['eventGreetings', eventGreetings],
  ['eventThankyouGreetings', eventThankyouGreetings],
])('%s', (_name, copy) => {
  const lines = copy(getT('public'));

  it('covers every event type with non-empty copy', () => {
    for (const type of EVENT_TYPES) expect(lines[type].trim().length, type).toBeGreaterThan(0);
  });

  it('has no extra keys beyond the event-type enum', () => {
    expect(Object.keys(lines).sort()).toEqual([...EVENT_TYPES].sort());
  });
});
