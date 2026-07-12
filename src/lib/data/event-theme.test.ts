import { describe, expect, it } from 'vitest';

import { EVENT_THEME } from '@/lib/data/event-theme';
import { EVENT_TYPES } from '@/lib/validation/schemas';

describe('EVENT_THEME', () => {
  it('covers every event type with non-empty static classes and copy', () => {
    for (const type of EVENT_TYPES) {
      const theme = EVENT_THEME[type];
      expect(theme, type).toBeDefined();
      expect(theme.accent, type).toMatch(/^text-/);
      expect(theme.banner, type).toContain('bg-gradient-to-b');
      expect(theme.greeting.trim().length, type).toBeGreaterThan(0);
    }
  });

  it('has no extra keys beyond the event-type enum', () => {
    expect(Object.keys(EVENT_THEME).sort()).toEqual([...EVENT_TYPES].sort());
  });
});
