import { describe, expect, it } from 'vitest';

import { ltrSegments } from './ltr-segments';

describe('ltrSegments', () => {
  it('isolates paths, file names, URLs and inline code; keeps Hebrew as text', () => {
    expect(ltrSegments('ראה plans/fleet-messaging.md ואת `npm run lint` ב-https://kalfa.me/a')).toEqual([
      { type: 'text', value: 'ראה ' },
      { type: 'ltr', value: 'plans/fleet-messaging.md' },
      { type: 'text', value: ' ואת ' },
      { type: 'code', value: 'npm run lint' },
      { type: 'text', value: ' ב-' },
      { type: 'ltr', value: 'https://kalfa.me/a' },
    ]);
  });

  it('leaves Hebrew slashes and plain Hebrew untouched', () => {
    expect(ltrSegments('כן/לא — לאשר?')).toEqual([{ type: 'text', value: 'כן/לא — לאשר?' }]);
  });

  it('catches a bare file name', () => {
    expect(ltrSegments('עודכן DESIGN.md היום').map((s) => s.type)).toEqual(['text', 'ltr', 'text']);
  });

  it('never loses characters', () => {
    const text = 'PR #12: src/lib/a.ts, `x`, ו-README.md.';
    expect(ltrSegments(text).map((s) => (s.type === 'code' ? `\`${s.value}\`` : s.value)).join('')).toBe(text);
  });
});
