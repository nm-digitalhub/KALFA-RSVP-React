import { describe, expect, it } from 'vitest';

import {
  CALLBACK_STATUSES,
  callbackStatusEnum,
  updateCallbackStatusSchema,
  packageBaseSchema,
  operationalFieldsSchema,
  holdBufferFractionToPercent,
  appRoleEnum,
} from './admin';

describe('callbackStatusEnum', () => {
  it('accepts every value in the closed vocabulary', () => {
    for (const s of CALLBACK_STATUSES) {
      expect(callbackStatusEnum.safeParse(s).success).toBe(true);
    }
  });

  it('rejects values outside the vocabulary', () => {
    expect(callbackStatusEnum.safeParse('bogus').success).toBe(false);
    expect(callbackStatusEnum.safeParse('').success).toBe(false);
  });
});

describe('updateCallbackStatusSchema', () => {
  it('accepts a uuid id with a valid status', () => {
    const result = updateCallbackStatusSchema.safeParse({
      // A real RFC-9562 v4 UUID (matches gen_random_uuid output shape).
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      status: 'done',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    const result = updateCallbackStatusSchema.safeParse({
      id: 'not-a-uuid',
      status: 'done',
    });
    expect(result.success).toBe(false);
  });
});

describe('packageBaseSchema', () => {
  const base = {
    name: 'חבילת בסיס',
    tier: 'basic',
    category: 'digital',
    description: '',
    price_with_vat: '199.90',
    includes: 'הזמנה דיגיטלית\nאישורי הגעה\n',
    active: 'on',
  };

  it('coerces price, splits includes into a string[], and reads the checkbox', () => {
    const result = packageBaseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price_with_vat).toBe(199.9);
      expect(result.data.includes).toEqual(['הזמנה דיגיטלית', 'אישורי הגעה']);
      expect(result.data.active).toBe(true);
    }
  });

  it('treats an absent checkbox as inactive', () => {
    const result = packageBaseSchema.safeParse({ ...base, active: undefined });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(false);
    }
  });

  it('drops blank lines in includes and yields [] when empty', () => {
    const result = packageBaseSchema.safeParse({
      ...base,
      includes: '\n  \n',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includes).toEqual([]);
    }
  });

  it('rejects an empty name', () => {
    const result = packageBaseSchema.safeParse({ ...base, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative price', () => {
    const result = packageBaseSchema.safeParse({
      ...base,
      price_with_vat: '-5',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric price', () => {
    const result = packageBaseSchema.safeParse({
      ...base,
      price_with_vat: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('coerces sort_order to an integer', () => {
    const result = packageBaseSchema.safeParse({ ...base, sort_order: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort_order).toBe(5);
    }
  });

  it('defaults sort_order to 0 when absent or blank', () => {
    const absent = packageBaseSchema.safeParse(base);
    const blank = packageBaseSchema.safeParse({ ...base, sort_order: '' });
    expect(absent.success).toBe(true);
    expect(blank.success).toBe(true);
    if (absent.success) expect(absent.data.sort_order).toBe(0);
    if (blank.success) expect(blank.data.sort_order).toBe(0);
  });

  it('rejects a negative or non-integer sort_order', () => {
    expect(packageBaseSchema.safeParse({ ...base, sort_order: '-1' }).success).toBe(
      false,
    );
    expect(packageBaseSchema.safeParse({ ...base, sort_order: '2.5' }).success).toBe(
      false,
    );
  });
});

describe('operationalFieldsSchema', () => {
  // A valid campaign-enabled package (price present ⇒ campaign rules apply),
  // shaped like the form input: numbers arrive as strings.
  const campaignBase = {
    price_per_reached: '4',
    channels: ['whatsapp'],
    outreach_schedule: [{ days_before: '7', channel: 'whatsapp', message_key: 'rsvp_1' }],
    min_hold_floor: '0',
    hold_buffer_pct: '0',
  };

  it('rejects a negative price_per_reached on a campaign-enabled package', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      price_per_reached: '-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // -1 !== null, so the package counts as campaign-enabled and hits the
      // superRefine `<= 0` branch.
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'price_per_reached',
      );
      expect(issue?.message).toBe('המחיר לאיש קשר חייב להיות חיובי');
    }
  });

  it('rejects a negative min_hold_floor', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      min_hold_floor: '-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'min_hold_floor',
      );
      expect(issue?.message).toBe('רצפת ה-hold לא יכולה להיות שלילית');
    }
  });

  it('rejects a negative hold_buffer_pct', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      hold_buffer_pct: '-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'hold_buffer_pct',
      );
      expect(issue?.message).toBe('האחוז לא יכול להיות שלילי');
    }
  });

  it('converts the hold_buffer_pct percent input to a stored fraction', () => {
    // The form takes percent ("10" = +10%); the schema stores the fraction
    // that computeHoldAmount multiplies by directly.
    const ten = operationalFieldsSchema.safeParse({
      ...campaignBase,
      hold_buffer_pct: '10',
    });
    expect(ten.success).toBe(true);
    if (ten.success) {
      expect(ten.data.hold_buffer_pct).toBe(0.1);
    }

    const zero = operationalFieldsSchema.safeParse(campaignBase);
    expect(zero.success).toBe(true);
    if (zero.success) {
      expect(zero.data.hold_buffer_pct).toBe(0);
    }
  });

  it('completes the hold_buffer_pct round-trip: percent input → stored fraction → displayed percent', () => {
    // Plan §5.4 "טסטים חובה (א)": entered 10 → stored 0.1 → edit form shows 10
    // again (holdBufferFractionToPercent is what [id]/page.tsx renders). '7'
    // additionally pins the float-noise case (0.07 * 100 !== 7 in raw floats).
    for (const percent of ['10', '7', '0.5']) {
      const parsed = operationalFieldsSchema.safeParse({
        ...campaignBase,
        hold_buffer_pct: percent,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(holdBufferFractionToPercent(parsed.data.hold_buffer_pct)).toBe(
          Number(percent),
        );
      }
    }
  });

  it('treats an empty price_per_reached as a valid non-campaign package', () => {
    // Empty string preprocesses to null; superRefine short-circuits, so the
    // campaign-only requirements (channels, schedule) do not apply.
    const result = operationalFieldsSchema.safeParse({
      price_per_reached: '',
      channels: [],
      outreach_schedule: [],
      min_hold_floor: '0',
      hold_buffer_pct: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price_per_reached).toBeNull();
    }
  });

  it('treats an absent price_per_reached as a valid non-campaign package', () => {
    const result = operationalFieldsSchema.safeParse({
      channels: [],
      outreach_schedule: [],
      min_hold_floor: '0',
      hold_buffer_pct: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price_per_reached).toBeNull();
    }
  });

  it('rejects a campaign-enabled package with no channels', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      channels: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The same input also produces a per-touchpoint channel-mismatch issue
      // (outreach_schedule.0.channel), so assert on the channels-path issue
      // specifically rather than on issues.length.
      const issue = result.error.issues.find((i) => i.path.join('.') === 'channels');
      expect(issue?.message).toBe('יש לבחור לפחות ערוץ אחד למסלול קמפיין');
    }
  });
});

describe('holdBufferFractionToPercent', () => {
  // Display half of the hold_buffer_pct round-trip (plan §5.4/§5.5): the edit
  // form must re-show the percent the admin entered, not the stored fraction.
  it('maps the stored fraction back to the percent for the edit form', () => {
    expect(holdBufferFractionToPercent(0.1)).toBe(10);
    expect(holdBufferFractionToPercent(0)).toBe(0);
    expect(holdBufferFractionToPercent(1)).toBe(100);
  });

  it('rounds away IEEE-754 noise for common fractions', () => {
    // Naive *100 gives 7.000000000000001 / 28.999999999999996 / 56.99999999999999.
    expect(holdBufferFractionToPercent(0.07)).toBe(7);
    expect(holdBufferFractionToPercent(0.29)).toBe(29);
    expect(holdBufferFractionToPercent(0.57)).toBe(57);
  });
});

describe('appRoleEnum', () => {
  it('accepts admin and user, rejects others', () => {
    expect(appRoleEnum.safeParse('admin').success).toBe(true);
    expect(appRoleEnum.safeParse('user').success).toBe(true);
    expect(appRoleEnum.safeParse('superuser').success).toBe(false);
  });
});
