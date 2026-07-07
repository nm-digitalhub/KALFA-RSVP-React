import { describe, expect, it } from 'vitest';

import {
  buildTemplateParams,
  GUEST_FIRST_NAME_FALLBACK,
  deriveGuestFirstName,
  buildGiftParams,
  buildBritTradInviteParams,
  buildBritTradReminderParams,
  buildBritTradThankyouParams,
  type TemplateParamsContext,
} from './template-spec';

// 2026-07-20 18:00 UTC = Monday 21:00 in Israel (IDT, UTC+3).
const MONDAY_EVENING = '2026-07-20T18:00:00+00:00';

// A fully-bindable wedding event; per-test overrides knock out one ingredient
// at a time for the missing-value matrix.
function ctx(
  overrides: Partial<TemplateParamsContext['event']> = {},
  guestFirstName: string | null = 'דנה',
): TemplateParamsContext {
  return {
    event: {
      name: 'החתונה של דוד ושרה',
      event_type: 'wedding',
      event_date: MONDAY_EVENING,
      venue_name: 'אולמי הגן',
      venue_address: 'דרך השלום 10, תל אביב',
      celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
      ...overrides,
    },
    guestFirstName,
  };
}

describe('buildTemplateParams — generic family', () => {
  it('binds all 7 positions for a couple-kind event (label, "X ו־Y", Israel date parts, venue)', () => {
    expect(buildTemplateParams('generic', ctx())).toEqual({
      params: [
        'דנה',
        'חתונה',
        'דוד לוי ו־שרה כהן',
        'שני',
        'ו׳ באב תשפ״ו (20.07.2026)',
        '21:00',
        'אולמי הגן, דרך השלום 10, תל אביב',
      ],
    });
  });

  it('single kind: {{3}} is the celebrant name as stored', () => {
    const r = buildTemplateParams(
      'generic',
      ctx({ event_type: 'bar_mitzvah', celebrants: { name: 'איתי לוי' } }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[1]).toBe('בר מצווה');
    expect(r.params[2]).toBe('איתי לוי');
  });

  it('parents kind: {{3}} is parents, with " — לכבוד <child>" only when the child was filled', () => {
    const withChild = buildTemplateParams(
      'generic',
      ctx({
        event_type: 'brit',
        celebrants: { parents: 'רון ומיכל כהן', child: 'אריאל', host_composition: 'couple' },
      }),
    );
    if ('missing' in withChild) throw new Error('expected params');
    expect(withChild.params[1]).toBe('ברית');
    expect(withChild.params[2]).toBe('רון ומיכל כהן — לכבוד אריאל');

    const withoutChild = buildTemplateParams(
      'generic',
      ctx({
        event_type: 'britah',
        celebrants: { parents: 'רון ומיכל כהן', host_composition: 'couple' },
      }),
    );
    if ('missing' in withoutChild) throw new Error('expected params');
    expect(withoutChild.params[1]).toBe('בריתה');
    expect(withoutChild.params[2]).toBe('רון ומיכל כהן');
  });

  it('free kind: {{3}} is the free-text names as entered', () => {
    const r = buildTemplateParams(
      'generic',
      ctx({ event_type: 'other', celebrants: { names: 'משפחת אברהם והחברים' } }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[1]).toBe('אחר');
    expect(r.params[2]).toBe('משפחת אברהם והחברים');
  });

  it('returns exactly 7 non-empty strings on success', () => {
    const r = buildTemplateParams('generic', ctx());
    if ('missing' in r) throw new Error('expected params');
    expect(r.params).toHaveLength(7);
    for (const p of r.params) {
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('buildTemplateParams — wedding family', () => {
  it('binds {{2}} to the groom and {{3}} to the bride (no event-type label)', () => {
    expect(buildTemplateParams('wedding', ctx())).toEqual({
      params: [
        'דנה',
        'דוד לוי',
        'שרה כהן',
        'שני',
        'ו׳ באב תשפ״ו (20.07.2026)',
        '21:00',
        'אולמי הגן, דרך השלום 10, תל אביב',
      ],
    });
  });

  it('ignores stray extra celebrant fields left over from an event_type change', () => {
    const r = buildTemplateParams(
      'wedding',
      ctx({ celebrants: { groom: 'דוד לוי', bride: 'שרה כהן', name: 'ישן' } }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[1]).toBe('דוד לוי');
    expect(r.params[2]).toBe('שרה כהן');
  });
});

describe('buildTemplateParams — {{1}} guest name and fallback', () => {
  it('falls back when guestFirstName is null and trims a provided name', () => {
    const withNull = buildTemplateParams('generic', ctx({}, null));
    if ('missing' in withNull) throw new Error('expected params');
    expect(withNull.params[0]).toBe(GUEST_FIRST_NAME_FALLBACK);

    const trimmed = buildTemplateParams('generic', ctx({}, '  דנה  '));
    if ('missing' in trimmed) throw new Error('expected params');
    expect(trimmed.params[0]).toBe('דנה');
  });

  it('treats a whitespace-only guest name as absent (fallback, never an empty param)', () => {
    const r = buildTemplateParams('wedding', ctx({}, '   '));
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[0]).toBe(GUEST_FIRST_NAME_FALLBACK);
  });
});

describe('buildTemplateParams — missing-value matrix (fail-closed)', () => {
  it('generic: null celebrants → "celebrants"', () => {
    expect(buildTemplateParams('generic', ctx({ celebrants: null }))).toEqual({
      missing: ['celebrants'],
    });
  });

  it('generic: a stale other-kind shape is incomplete for the current type', () => {
    // bar_mitzvah expects { name } — a leftover couple shape must not bind.
    const r = buildTemplateParams(
      'generic',
      ctx({ event_type: 'bar_mitzvah', celebrants: { groom: 'דוד', bride: 'שרה' } }),
    );
    expect(r).toEqual({ missing: ['celebrants'] });
  });

  it('generic: a partially-filled couple (groom only) is incomplete', () => {
    expect(buildTemplateParams('generic', ctx({ celebrants: { groom: 'דוד לוי' } }))).toEqual({
      missing: ['celebrants'],
    });
  });

  it('generic: parents kind with only the optional child filled is incomplete', () => {
    const r = buildTemplateParams(
      'generic',
      ctx({ event_type: 'brit', celebrants: { child: 'אריאל' } }),
    );
    expect(r).toEqual({ missing: ['celebrants'] });
  });

  it('generic: non-object jsonb values (string/array) never bind', () => {
    expect(buildTemplateParams('generic', ctx({ celebrants: 'דוד ושרה' }))).toEqual({
      missing: ['celebrants'],
    });
    expect(buildTemplateParams('generic', ctx({ celebrants: ['דוד', 'שרה'] }))).toEqual({
      missing: ['celebrants'],
    });
  });

  it('wedding: null celebrants → both granular keys', () => {
    expect(buildTemplateParams('wedding', ctx({ celebrants: null }))).toEqual({
      missing: ['celebrants.groom', 'celebrants.bride'],
    });
  });

  it('wedding: each absent side is reported under its own key', () => {
    expect(buildTemplateParams('wedding', ctx({ celebrants: { groom: 'דוד לוי' } }))).toEqual({
      missing: ['celebrants.bride'],
    });
    expect(buildTemplateParams('wedding', ctx({ celebrants: { bride: 'שרה כהן' } }))).toEqual({
      missing: ['celebrants.groom'],
    });
  });

  it('wedding: a whitespace-only name counts as absent', () => {
    const r = buildTemplateParams(
      'wedding',
      ctx({ celebrants: { groom: '   ', bride: 'שרה כהן' } }),
    );
    expect(r).toEqual({ missing: ['celebrants.groom'] });
  });

  it('null event_date → "event_date" (covers {{4}}–{{6}})', () => {
    expect(buildTemplateParams('generic', ctx({ event_date: null }))).toEqual({
      missing: ['event_date'],
    });
  });

  it('unparseable event_date → "event_date"', () => {
    expect(buildTemplateParams('generic', ctx({ event_date: 'לא תאריך' }))).toEqual({
      missing: ['event_date'],
    });
  });

  it('null or blank venue_name → "venue_name"', () => {
    expect(buildTemplateParams('generic', ctx({ venue_name: null }))).toEqual({
      missing: ['venue_name'],
    });
    expect(buildTemplateParams('generic', ctx({ venue_name: '   ' }))).toEqual({
      missing: ['venue_name'],
    });
  });

  it('missing venue_address does NOT block — {{7}} is the venue name alone', () => {
    const r = buildTemplateParams('generic', ctx({ venue_address: null }));
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[6]).toBe('אולמי הגן');
  });

  it('accumulates every absent ingredient in stable position order', () => {
    const bare = { celebrants: null, event_date: null, venue_name: null };
    expect(buildTemplateParams('generic', ctx(bare))).toEqual({
      missing: ['celebrants', 'event_date', 'venue_name'],
    });
    expect(buildTemplateParams('wedding', ctx(bare))).toEqual({
      missing: ['celebrants.groom', 'celebrants.bride', 'event_date', 'venue_name'],
    });
  });
});

describe('buildTemplateParams — Israel timezone edges for {{4}}–{{6}}', () => {
  it('late-UTC winter instant renders the NEXT Israel day (IST, UTC+2) with h23 midnight time', () => {
    // 2026-12-31 22:30 UTC = Friday 2027-01-01 00:30 in Israel.
    const r = buildTemplateParams('generic', ctx({ event_date: '2026-12-31T22:30:00Z' }));
    if ('missing' in r) throw new Error('expected params');
    expect(r.params.slice(3, 6)).toEqual(['שישי', 'כ״ב בטבת תשפ״ז (01.01.2027)', '00:30']);
  });

  it('late-UTC summer instant crosses midnight under DST (IDT, UTC+3)', () => {
    // 2026-07-20 21:30 UTC = Tuesday 2026-07-21 00:30 in Israel.
    const r = buildTemplateParams('wedding', ctx({ event_date: '2026-07-20T21:30:00Z' }));
    if ('missing' in r) throw new Error('expected params');
    expect(r.params.slice(3, 6)).toEqual(['שלישי', 'ז׳ באב תשפ״ו (21.07.2026)', '00:30']);
  });

  it('an early-Israel-morning instant stays on its own day (no off-by-one from server TZ)', () => {
    // 2026-07-17 18:00 UTC = Friday 2026-07-17 21:00 in Israel.
    const r = buildTemplateParams('generic', ctx({ event_date: '2026-07-17T18:00:00Z' }));
    if ('missing' in r) throw new Error('expected params');
    expect(r.params.slice(3, 6)).toEqual(['שישי', 'ג׳ באב תשפ״ו (17.07.2026)', '21:00']);
  });
});

describe('deriveGuestFirstName', () => {
  it('takes the first whitespace token of a personal name', () => {
    expect(deriveGuestFirstName('דנה כהן')).toBe('דנה');
    expect(deriveGuestFirstName('  יוסי  לוי ')).toBe('יוסי');
  });

  it('returns null for a household row — the generic greeting must win', () => {
    expect(deriveGuestFirstName('משפחת כהן')).toBe(null);
  });

  it('returns null for missing/empty input', () => {
    expect(deriveGuestFirstName(null)).toBe(null);
    expect(deriveGuestFirstName(undefined)).toBe(null);
    expect(deriveGuestFirstName('   ')).toBe(null);
  });
});

describe('buildGiftParams (kalfa_event_gift_v1)', () => {
  const giftEvent = {
    event_type: 'brit' as const,
    celebrants: { parents: 'נטלי קלפה', host_composition: 'single_mother' },
    gift_payment_url: 'https://payboxapp.page.link/abc123',
  };

  it('builds the 4-param contract for a complete brit event', () => {
    const r = buildGiftParams({ event: giftEvent, guestFirstName: 'דנה' });
    if (!('params' in r)) throw new Error('expected params');
    expect(r.params).toEqual([
      'דנה',
      'ברית',
      'נטלי קלפה',
      'https://payboxapp.page.link/abc123',
    ]);
  });

  it('falls back to the generic greeting without a guest name', () => {
    const r = buildGiftParams({ event: giftEvent, guestFirstName: null });
    if (!('params' in r)) throw new Error('expected params');
    expect(r.params[0]).toBe(GUEST_FIRST_NAME_FALLBACK);
  });

  it('fail-closes when the gift link is missing or not https', () => {
    for (const bad of [null, '', '  ', 'http://payboxapp.page.link/x']) {
      const r = buildGiftParams({
        event: { ...giftEvent, gift_payment_url: bad as string | null },
        guestFirstName: 'דנה',
      });
      if (!('missing' in r)) throw new Error('expected missing');
      expect(r.missing).toContain('gift_payment_url');
    }
  });

  it('fail-closes when celebrants are incomplete for the kind', () => {
    const r = buildGiftParams({
      event: { ...giftEvent, celebrants: { child: 'אריאל' } },
      guestFirstName: 'דנה',
    });
    if (!('missing' in r)) throw new Error('expected missing');
    expect(r.missing).toContain('celebrants');
  });
});

describe('brit personal builders (kalfa_brit_invite_trad_v4 / reminder / thankyou)', () => {
  // 2026-07-12 14:30 UTC = Sunday 17:30 in Israel (IDT) — the brit.
  const BRIT_MS = '2026-07-12T14:30:00.000Z';
  const VENUE = 'בית כנסת הרמ״א, ציזלינג 13, אשדוד';

  function britCtx(
    celebrants: Record<string, string>,
    overrides: Partial<TemplateParamsContext['event']> = {},
  ): TemplateParamsContext {
    return {
      event: {
        name: 'ברית',
        event_type: 'brit',
        event_date: BRIT_MS,
        venue_name: 'בית כנסת הרמ״א',
        venue_address: 'ציזלינג 13, אשדוד',
        celebrants,
        ...overrides,
      },
      guestFirstName: 'דנה', // ignored by the brit builders (first-person line)
    };
  }

  it('invite — single mother: feminine verb, בני, split dates, first-person closing', () => {
    const r = buildBritTradInviteParams(
      britCtx({ parents: 'נטלי קלפה', host_composition: 'single_mother' }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params).toEqual([
      'מתכבדת להזמינכם לשמחת בריתו של בני.',
      'ראשון',
      'כ״ז בתמוז תשפ״ו',
      '12.07.2026',
      '17:30',
      VENUE,
      'אשמח לראותכם בשמחתי. נטלי קלפה',
    ]);
  });

  it('invite — single father: masculine verb, same בני/עמי', () => {
    const r = buildBritTradInviteParams(
      britCtx({ parents: 'דוד כהן', host_composition: 'single_father' }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[0]).toBe('מתכבד להזמינכם לשמחת בריתו של בני.');
    expect(r.params[6]).toBe('אשמח לראותכם בשמחתי. דוד כהן');
  });

  it('invite — couple: plural verb, בננו, עמנו', () => {
    const r = buildBritTradInviteParams(
      britCtx({ parents: 'משה ורות כהן', host_composition: 'couple' }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params[0]).toBe('מתכבדים להזמינכם לשמחת בריתו של בננו.');
    expect(r.params[6]).toBe('נשמח לראותכם בשמחתנו. משה ורות כהן');
  });

  it('reminder — 6 slots, first-person line, no closing slot', () => {
    const r = buildBritTradReminderParams(
      britCtx({ parents: 'נטלי קלפה', host_composition: 'single_mother' }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params).toEqual([
      'רציתי להזכיר לכם בשמחה — שמחת ברית בני מתקרבת.',
      'ראשון',
      'כ״ז בתמוז תשפ״ו',
      '12.07.2026',
      '17:30',
      VENUE,
    ]);
  });

  it('thankyou — thanks line + family signature from the parents surname', () => {
    const r = buildBritTradThankyouParams(
      britCtx({ parents: 'נטלי קלפה', host_composition: 'single_mother' }),
    );
    if ('missing' in r) throw new Error('expected params');
    expect(r.params).toEqual([
      'מעומק הלב — תודה שבאתם לחגוג עמי את שמחת ברית בני.',
      'משפחת קלפה',
    ]);
  });

  it('fail-closes when host_composition is absent (cannot conjugate)', () => {
    const r = buildBritTradInviteParams(britCtx({ parents: 'נטלי קלפה' }));
    if (!('missing' in r)) throw new Error('expected missing');
    expect(r.missing).toContain('celebrants');
  });

  it('fail-closes when the venue is absent', () => {
    const r = buildBritTradInviteParams(
      britCtx({ parents: 'נטלי קלפה', host_composition: 'single_mother' }, { venue_name: null }),
    );
    if (!('missing' in r)) throw new Error('expected missing');
    expect(r.missing).toContain('venue_name');
  });
});
