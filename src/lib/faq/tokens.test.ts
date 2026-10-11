import { describe, expect, it } from 'vitest';

import {
  buildFaqTokenValues,
  formatOutreachScheduleHe,
  substituteFaqTokens,
} from './tokens';
import { buildBusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price: 200,
  contact_quota: 200,
  channels: ['whatsapp', 'call'],
  description: null,
  includes: [],
  // The live cadence of the packages on sale: 10 / 6 / 3 days by WhatsApp, an
  // AI call 2 days out, a final WhatsApp the day before.
  outreach_schedule: [
    { days_before: 10, channel: 'whatsapp' },
    { days_before: 6, channel: 'whatsapp' },
    { days_before: 3, channel: 'whatsapp' },
    { days_before: 2, channel: 'call' },
    { days_before: 1, channel: 'whatsapp' },
  ],
};

describe('buildFaqTokenValues', () => {
  it('every token resolves from the packages on sale', () => {
    const values = buildFaqTokenValues(buildBusinessFacts([pkg]));
    expect(values.packages_list).toBe('אישורי הגעה — וואטסאפ + שיחות AI — ₪200, עד 200 אנשי קשר.');
    expect(values.channels_list).toBe('וואטסאפ, שיחה טלפונית (AI)');
    expect(values.outreach_schedule).toBe(
      'וואטסאפ 10 ימים לפני, וואטסאפ 6 ימים לפני, וואטסאפ 3 ימים לפני, ' +
        'שיחה טלפונית (AI) יומיים לפני, וואטסאפ יום לפני',
    );
  });

  it('a package with no schedule yields no cadence, never an invented one', () => {
    const values = buildFaqTokenValues(buildBusinessFacts([{ ...pkg, outreach_schedule: [] }]));
    expect(values.outreach_schedule).toBe('');
  });

  it('the pay-per-result tokens are gone', () => {
    const values = buildFaqTokenValues(buildBusinessFacts([pkg]));
    for (const retired of ['base_price', 'included_reached', 'price_per_reached']) {
      expect(values).not.toHaveProperty(retired);
    }
  });

  it('facts unavailable: every token blanks out, none show a stale/fabricated number', () => {
    const values = buildFaqTokenValues(buildBusinessFacts([]));
    expect(values.packages_list).toBe('');
    expect(values.channels_list).toBe('');
    expect(values.outreach_schedule).toBe('');
  });
});

// Hebrew has a DUAL form. "2 ימים" is not Hebrew, and the live schedule
// contains both a 2-day and a 1-day touchpoint, so both forms ship today.
describe('formatOutreachScheduleHe — Hebrew day forms', () => {
  it('uses יום / יומיים / N ימים, not a numeric form for 1 and 2', () => {
    expect(formatOutreachScheduleHe([{ days_before: 1, channel: 'whatsapp' }]))
      .toBe('וואטסאפ יום לפני');
    expect(formatOutreachScheduleHe([{ days_before: 2, channel: 'whatsapp' }]))
      .toBe('וואטסאפ יומיים לפני');
    expect(formatOutreachScheduleHe([{ days_before: 3, channel: 'whatsapp' }]))
      .toBe('וואטסאפ 3 ימים לפני');
    // The wrong forms must not appear at all.
    const two = formatOutreachScheduleHe([{ days_before: 2, channel: 'whatsapp' }]);
    expect(two).not.toContain('2 ימים');
  });

  it('day 0 reads as the event day rather than "0 ימים לפני"', () => {
    expect(formatOutreachScheduleHe([{ days_before: 0, channel: 'call' }]))
      .toBe('שיחה טלפונית (AI) ביום האירוע');
  });

  it('an unlabelled channel falls back to its key instead of rendering undefined', () => {
    expect(formatOutreachScheduleHe([{ days_before: 5, channel: 'email' }]))
      .toBe('email 5 ימים לפני');
  });

  it('an empty schedule renders nothing', () => {
    expect(formatOutreachScheduleHe([])).toBe('');
  });
});

describe('substituteFaqTokens ({{double_brace}} — the shared engine)', () => {
  it('replaces known tokens and leaves the sentence brace-free', () => {
    const out = substituteFaqTokens('שולחים הזמנות ב־{{channels_list}}.', {
      channels_list: 'וואטסאפ, שיחה טלפונית (AI)',
    });
    expect(out).toBe('שולחים הזמנות ב־וואטסאפ, שיחה טלפונית (AI).');
    expect(out).not.toContain('{{');
  });

  it('an unknown token name (typo) is left literal, not silently dropped', () => {
    const out = substituteFaqTokens('מחיר: {{totaly_unknown_token}}', { channels_list: 'x' });
    expect(out).toBe('מחיר: {{totaly_unknown_token}}');
  });

  it('a known token resolved to "" cleanly disappears, never renders as-is', () => {
    const out = substituteFaqTokens('החבילות: {{packages_list}}', { packages_list: '' });
    expect(out).toBe('החבילות: ');
    expect(out).not.toContain('{{packages_list}}');
  });

  it('single braces are NOT treated as tokens (only {{double}} — matches the agreement template)', () => {
    const out = substituteFaqTokens('מחיר {packages_list} רגיל', { packages_list: '₪200' });
    expect(out).toBe('מחיר {packages_list} רגיל');
  });
});
