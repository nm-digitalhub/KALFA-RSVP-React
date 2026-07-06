import { describe, expect, it } from 'vitest';

import {
  celebrantsTextFor,
  eventHeadingFor,
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
