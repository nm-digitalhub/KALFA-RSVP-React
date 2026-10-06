import { describe, expect, it } from 'vitest';

import {
  buildFaqTokenValues,
  formatOutreachScheduleHe,
  substituteFaqTokens,
} from './tokens';
import { buildBusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price_per_reached: 4,
  base_price: 200,
  included_reached: 200,
  channels: ['whatsapp', 'call'],
  // The live cadence (queried from the canonical package): 10 / 6 / 3 days by
  // WhatsApp, an AI call 2 days out, a final WhatsApp the day before.
  outreach_schedule: [
    { days_before: 10, channel: 'whatsapp' },
    { days_before: 6, channel: 'whatsapp' },
    { days_before: 3, channel: 'whatsapp' },
    { days_before: 2, channel: 'call' },
    { days_before: 1, channel: 'whatsapp' },
  ],
};

describe('buildFaqTokenValues', () => {
  it('base+overage model: all four tokens resolve to real values', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(true, pkg));
    expect(values.base_price).toBe('₪200');
    expect(values.included_reached).toBe('200');
    expect(values.price_per_reached).toBe('₪4');
    expect(values.channels_list).toBe('וואטסאפ, שיחה טלפונית (AI)');
    expect(values.outreach_schedule).toBe(
      'וואטסאפ 10 ימים לפני, וואטסאפ 6 ימים לפני, וואטסאפ 3 ימים לפני, ' +
        'שיחה טלפונית (AI) יומיים לפני, וואטסאפ יום לפני',
    );
  });

  it('the cadence is NOT gate-dependent — the engine runs it under either pricing model', () => {
    const on = buildFaqTokenValues(buildBusinessFacts(true, pkg));
    const off = buildFaqTokenValues(buildBusinessFacts(false, pkg));
    expect(off.outreach_schedule).toBe(on.outreach_schedule);
    expect(off.outreach_schedule).not.toBe('');
  });

  it('a package whose schedule was never selected yields no cadence, never an invented one', () => {
    const { outreach_schedule: _omitted, ...withoutSchedule } = pkg;
    const values = buildFaqTokenValues(buildBusinessFacts(true, withoutSchedule));
    expect(values.outreach_schedule).toBe('');
  });

  it('per-reached model (gate off): base/included blank out instead of showing ₪0', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(false, pkg));
    expect(values.base_price).toBe('');
    expect(values.included_reached).toBe('');
    // price_per_reached and channels_list are meaningful under either model.
    expect(values.price_per_reached).toBe('₪4');
    expect(values.channels_list).toBe('וואטסאפ, שיחה טלפונית (AI)');
  });

  it('facts unavailable: every token blanks out, none show a stale/fabricated number', () => {
    const values = buildFaqTokenValues(buildBusinessFacts(true, null));
    expect(values.base_price).toBe('');
    expect(values.included_reached).toBe('');
    expect(values.price_per_reached).toBe('');
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
    const out = substituteFaqTokens('דמי הפעלה {{base_price}}.', { base_price: '' });
    expect(out).toBe('דמי הפעלה .');
    expect(out).not.toContain('{{base_price}}');
  });

  it('single braces are NOT treated as tokens (only {{double}} — matches the agreement template)', () => {
    const out = substituteFaqTokens('מחיר {base_price} רגיל', { base_price: '₪200' });
    expect(out).toBe('מחיר {base_price} רגיל');
  });
});
