import { describe, expect, it } from 'vitest';

import {
  celebrantNamesFor,
  celebrantsTextFor,
  eventHeadingFor,
  eventHeadingSegmentsFor,
  EVENT_TYPE_ICON,
} from './celebrant-display';
import { EVENT_TYPES } from '@/lib/validation/schemas';

describe('celebrantsTextFor', () => {
  it('couple: joins both, renders either alone', () => {
    expect(celebrantsTextFor('wedding', { groom: 'דוד', bride: 'רות' })).toBe(
      'דוד ורות',
    );
    expect(celebrantsTextFor('wedding', { groom: 'דוד' })).toBe('דוד');
    expect(celebrantsTextFor('henna', { bride: 'רות' })).toBe('רות');
  });

  it('single: the name field', () => {
    expect(celebrantsTextFor('bar_mitzvah', { name: 'אורי' })).toBe('אורי');
    expect(celebrantsTextFor('birthday', { name: 'נועה' })).toBe('נועה');
  });

  it('parents: parents alone, child appended when set', () => {
    expect(celebrantsTextFor('brit', { parents: 'נטלי קלפה' })).toBe('נטלי קלפה');
    expect(
      celebrantsTextFor('brit', { parents: 'נטלי קלפה', child: 'בני' }),
    ).toBe('נטלי קלפה — לכבוד בני');
  });

  it('free: the names field', () => {
    expect(celebrantsTextFor('other', { names: 'משפחת לוי' })).toBe('משפחת לוי');
  });

  it('is defensive against empty/garbage shapes', () => {
    expect(celebrantsTextFor('wedding', null)).toBeNull();
    expect(celebrantsTextFor('brit', {})).toBeNull();
    expect(celebrantsTextFor('brit', { parents: '   ' })).toBeNull();
    expect(celebrantsTextFor('birthday', ['x'] as never)).toBeNull();
    expect(celebrantsTextFor('other', 'text' as never)).toBeNull();
  });
});

describe('eventHeadingFor', () => {
  it('possessive types compose "<label> של <names>"', () => {
    expect(
      eventHeadingFor('wedding', { groom: 'דוד', bride: 'רות' }, 'אירוע'),
    ).toEqual({ title: 'החתונה של דוד ורות', subtitle: null });
    expect(eventHeadingFor('bar_mitzvah', { name: 'אורי' }, 'אירוע')).toEqual({
      title: 'בר המצווה של אורי',
      subtitle: null,
    });
    expect(eventHeadingFor('birthday', { name: 'נועה' }, 'אירוע')).toEqual({
      title: 'יום ההולדת של נועה',
      subtitle: null,
    });
  });

  it('brit/britah: type label as title, parents on the subtitle', () => {
    expect(
      eventHeadingFor('brit', { parents: 'נטלי קלפה' }, 'ברית הבן של נטלי'),
    ).toEqual({ title: 'ברית', subtitle: 'ההורים: נטלי קלפה' });
    expect(eventHeadingFor('britah', null, 'שם אירוע')).toEqual({
      title: 'בריתה',
      subtitle: null,
    });
  });

  it('falls back to the event name when names are missing', () => {
    expect(eventHeadingFor('wedding', null, 'החתונה שלנו')).toEqual({
      title: 'החתונה שלנו',
      subtitle: null,
    });
    expect(eventHeadingFor('other', { names: 'משפחת לוי' }, 'מסיבת השנה')).toEqual(
      { title: 'מסיבת השנה', subtitle: 'בעלי השמחה: משפחת לוי' },
    );
  });

  it('has an icon for every event type', () => {
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_ICON[t]).toBeTruthy();
    }
  });
});

describe('celebrantNamesFor / eventHeadingSegmentsFor (line breaks between people, never inside a name)', () => {
  it('lists the name tokens exactly as they appear in the composed text', () => {
    expect(celebrantNamesFor('wedding', { groom: 'אייל מלכה', bride: 'שלומית קאקון' })).toEqual([
      'אייל מלכה',
      'ושלומית קאקון',
    ]);
    expect(celebrantNamesFor('wedding', { bride: 'רות' })).toEqual(['רות']);
    expect(celebrantNamesFor('bar_mitzvah', { name: 'אורי כהן' })).toEqual(['אורי כהן']);
    expect(celebrantNamesFor('brit', { parents: 'נטלי קלפה', child: 'בני' })).toEqual(['נטלי קלפה', 'בני']);
    expect(celebrantNamesFor('other', { names: 'משפחת לוי' })).toEqual(['משפחת לוי']);
    expect(celebrantNamesFor('wedding', null)).toEqual([]);
  });

  it('wraps each multi-word name as one unbreakable segment; the texts join back to the title', () => {
    const celebrants = { groom: 'אייל מלכה', bride: 'שלומית קאקון' };
    const segments = eventHeadingSegmentsFor('wedding', celebrants, 'אירוע');
    expect(segments).toEqual([
      { text: 'החתונה של ', noWrap: false },
      { text: 'אייל מלכה', noWrap: true },
      { text: ' ', noWrap: false },
      { text: 'ושלומית קאקון', noWrap: true },
    ]);
    expect(segments.map((s) => s.text).join('')).toBe(
      eventHeadingFor('wedding', celebrants, 'אירוע').title,
    );
  });

  it('single-word names need no segment; parents-kind and fallback titles are one plain segment', () => {
    expect(eventHeadingSegmentsFor('wedding', { groom: 'דוד', bride: 'רות' }, 'אירוע')).toEqual([
      { text: 'החתונה של דוד ורות', noWrap: false },
    ]);
    expect(eventHeadingSegmentsFor('brit', { parents: 'נטלי קלפה', child: 'בני' }, 'x')).toEqual([
      { text: 'ברית', noWrap: false },
    ]);
    expect(eventHeadingSegmentsFor('wedding', null, 'החתונה שלנו')).toEqual([
      { text: 'החתונה שלנו', noWrap: false },
    ]);
  });

  it('a name over 24 characters stays breakable (nowrap would overflow a 320px card)', () => {
    const long = 'אביגיל שרה רבקה לאה כהן-צדק בן-דוד'; // 34 chars
    const segments = eventHeadingSegmentsFor('bat_mitzvah', { name: long }, 'x');
    expect(segments).toEqual([{ text: `בת המצווה של ${long}`, noWrap: false }]);
  });

  it('every event type: segments always join back to the title', () => {
    const celebrants = {
      groom: 'אייל מלכה', bride: 'שלומית קאקון', name: 'נועה לוי', parents: 'נטלי קלפה', child: 'בני', names: 'משפחת לוי',
    };
    for (const t of EVENT_TYPES) {
      const title = eventHeadingFor(t, celebrants, 'שם האירוע').title;
      expect(eventHeadingSegmentsFor(t, celebrants, 'שם האירוע').map((s) => s.text).join('')).toBe(title);
    }
  });
});
