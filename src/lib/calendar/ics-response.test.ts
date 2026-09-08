import { describe, expect, it } from 'vitest';

import { icsResponse } from './ics-response';

describe('icsResponse', () => {
  it('serves inline text/calendar with no-store, nosniff, noindex, no-referrer', async () => {
    const res = icsResponse('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 'החתונה-של-דנה-ויוסי');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition.startsWith('inline;')).toBe(true);
    expect(disposition).toContain('filename="kalfa-event.ics"'); // ASCII fallback when the name is all Hebrew
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('החתונה-של-דנה-ויוסי')}.ics`);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.text()).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });

  it('keeps an ASCII name as the plain filename and strips quotes', () => {
    const res = icsResponse('x', 'Dana-and-Yossi"s');
    expect(res.headers.get('content-disposition')).toContain('filename="Dana-and-Yossis.ics"');
  });
});
