import { describe, expect, it } from 'vitest';

import {
  CALLBACK_STATUSES,
  CALLBACK_STATUS_KIND,
  CALLBACK_TERMINAL_STATUSES,
  isCancellableCallbackStatus,
  CALL_OUTCOMES,
  CONTACT_STATUSES,
  callOutcomeEnum,
  updateCallOutcomeSchema,
  cancelCallbackSchema,
  contactStatusEnum,
  updateContactStatusSchema,
  packageBaseSchema,
  operationalFieldsSchema,
  holdBufferFractionToPercent,
  appRoleEnum,
} from './admin';

// callback_requests.status is a system-driven scheduling state machine with no
// dedicated Zod enum/schema of its own (only 'cancelled' is admin-settable, via
// cancelCallbackSchema below). Separate from it:
// callOutcomeEnum/updateCallOutcomeSchema (what happened on the call) and
// contactStatusEnum/updateContactStatusSchema (the unrelated contacts vocabulary).

describe('CALLBACK_STATUS_KIND', () => {
  // The real guarantee is the compile error from Record<CallbackStatus, …>:
  // a new status cannot be added without classifying it. This asserts the
  // runtime half — that the derived terminal list actually follows the map,
  // rather than being a second hand-written copy that can drift from it.
  it('classifies every status in the vocabulary', () => {
    for (const status of CALLBACK_STATUSES) {
      expect(CALLBACK_STATUS_KIND[status]).toMatch(/^(live|terminal)$/);
    }
  });

  it('derives the terminal list from the map', () => {
    expect([...CALLBACK_TERMINAL_STATUSES]).toEqual(
      CALLBACK_STATUSES.filter((s) => CALLBACK_STATUS_KIND[s] === 'terminal'),
    );
    expect([...CALLBACK_TERMINAL_STATUSES]).toEqual(['cancelled', 'closed']);
  });
});

describe('isCancellableCallbackStatus', () => {
  it('refuses the two statuses that mean the request is over', () => {
    expect(isCancellableCallbackStatus('cancelled')).toBe(false);
    expect(isCancellableCallbackStatus('closed')).toBe(false);
  });

  it('allows every live status', () => {
    for (const status of CALLBACK_STATUSES.filter(
      (s) => CALLBACK_STATUS_KIND[s] === 'live',
    )) {
      expect(isCancellableCallbackStatus(status)).toBe(true);
    }
  });

  // A migration can widen the CHECK constraint before this vocabulary is
  // redeployed. Such a row must stay cancellable — the alternative is a
  // request stuck with no way out, which is worse than an extra cancel button.
  it('treats an unknown status as live rather than stranding the row', () => {
    expect(isCancellableCallbackStatus('some_future_status')).toBe(true);
    expect(isCancellableCallbackStatus('')).toBe(true);
  });
});

describe('callOutcomeEnum', () => {
  it('accepts every value in the closed vocabulary', () => {
    for (const o of CALL_OUTCOMES) {
      expect(callOutcomeEnum.safeParse(o).success).toBe(true);
    }
  });

  it('rejects values outside the vocabulary', () => {
    expect(callOutcomeEnum.safeParse('bogus').success).toBe(false);
    expect(callOutcomeEnum.safeParse('').success).toBe(false);
  });
});

describe('updateCallOutcomeSchema', () => {
  it('accepts a uuid id with a valid outcome', () => {
    const result = updateCallOutcomeSchema.safeParse({
      // A real RFC-9562 v4 UUID (matches gen_random_uuid output shape).
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      callOutcome: 'completed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    const result = updateCallOutcomeSchema.safeParse({
      id: 'not-a-uuid',
      callOutcome: 'completed',
    });
    expect(result.success).toBe(false);
  });
});

describe('cancelCallbackSchema', () => {
  it('accepts a uuid id', () => {
    const result = cancelCallbackSchema.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    const result = cancelCallbackSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('contactStatusEnum', () => {
  it('accepts every value in the closed vocabulary', () => {
    for (const s of CONTACT_STATUSES) {
      expect(contactStatusEnum.safeParse(s).success).toBe(true);
    }
  });

  it('rejects values outside the vocabulary, including the old scheduling states', () => {
    expect(contactStatusEnum.safeParse('bogus').success).toBe(false);
    expect(contactStatusEnum.safeParse('').success).toBe(false);
    // pending_schedule/scheduled/etc. are callback-scheduling states now — a
    // contact message must never accept them.
    for (const s of CALLBACK_STATUSES) {
      if ((CONTACT_STATUSES as readonly string[]).includes(s)) continue;
      expect(contactStatusEnum.safeParse(s).success).toBe(false);
    }
  });
});

describe('updateContactStatusSchema', () => {
  it('accepts a uuid id with a valid status', () => {
    const result = updateContactStatusSchema.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      status: 'done',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    const result = updateContactStatusSchema.safeParse({
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

  it('accepts base_price + included_reached set together (base+overage, S4)', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      base_price: '200',
      included_reached: '200',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.base_price).toBe(200);
      expect(result.data.included_reached).toBe(200);
    }
  });

  it('coerces empty base_price/included_reached to null (pure per-reached, NOT 0)', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      base_price: '',
      included_reached: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.base_price).toBeNull();
      expect(result.data.included_reached).toBeNull();
    }
  });

  it('rejects a base_price without an included_reached (all-or-nothing)', () => {
    const result = operationalFieldsSchema.safeParse({
      ...campaignBase,
      base_price: '200',
      included_reached: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'included_reached',
      );
      expect(issue?.message).toBe(
        'מחיר בסיס וכמות כלולה חייבים להיות מוגדרים יחד (או שניהם ריקים)',
      );
    }
  });

  it('rejects a negative base_price and a non-integer included_reached', () => {
    expect(
      operationalFieldsSchema.safeParse({
        ...campaignBase,
        base_price: '-1',
        included_reached: '10',
      }).success,
    ).toBe(false);
    expect(
      operationalFieldsSchema.safeParse({
        ...campaignBase,
        base_price: '200',
        included_reached: '10.5',
      }).success,
    ).toBe(false);
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

// A fixed-price package with a contact quota (docs/superpowers/plans/2026-10-04-package-payment-plan.md, P-F): the
// price is the package's own price_with_vat, charged once; the quota is how many contacts the campaign may approach.
// The per-reached formula and the card hold do not exist for it — so the server refuses a mix, whatever the form sent.
describe('operationalFieldsSchema — fixed-price package with a contact quota', () => {
  // Shaped like readOperationalForm's output for a fixed-price package: the formula and hold inputs are not rendered
  // in the browser, so formData.get() yields null for them.
  const quotaBase = {
    contact_quota: '40',
    price_per_reached: null,
    base_price: null,
    included_reached: null,
    min_hold_floor: null,
    hold_buffer_pct: null,
    channels: ['whatsapp'],
    outreach_schedule: [{ days_before: '7', channel: 'whatsapp', message_key: 'rsvp_1' }],
  };
  const issue = (r: ReturnType<typeof operationalFieldsSchema.safeParse>, path: string) =>
    r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === path)?.message;

  it('accepts a quota with channels and a schedule and no formula fields (hold fields absent → 0)', () => {
    const r = operationalFieldsSchema.safeParse(quotaBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.contact_quota).toBe(40);
      expect(r.data.price_per_reached).toBeNull();
      expect(r.data.base_price).toBeNull();
      expect(r.data.included_reached).toBeNull();
      expect(r.data.min_hold_floor).toBe(0);
      expect(r.data.hold_buffer_pct).toBe(0);
    }
  });

  it('a blank or absent quota is "no quota" (null), exactly as before', () => {
    for (const contact_quota of ['', undefined, null]) {
      const r = operationalFieldsSchema.safeParse({ ...quotaBase, contact_quota, price_per_reached: '4' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.contact_quota).toBeNull();
    }
  });

  it.each(['0', '-5', '2.5', 'abc'])('rejects the quota %j', (contact_quota) => {
    const r = operationalFieldsSchema.safeParse({ ...quotaBase, contact_quota });
    expect(r.success).toBe(false);
    expect(issue(r, 'contact_quota')).toBe('נא להזין מכסה תקינה (מספר שלם, 1 ומעלה)');
  });

  it('a quota package is campaign-enabled: it needs a channel and a schedule even with no price per reached', () => {
    const noChannels = operationalFieldsSchema.safeParse({ ...quotaBase, channels: [] });
    expect(issue(noChannels, 'channels')).toBe('יש לבחור לפחות ערוץ אחד למסלול קמפיין');
    const noSchedule = operationalFieldsSchema.safeParse({ ...quotaBase, outreach_schedule: [] });
    expect(issue(noSchedule, 'outreach_schedule')).toBe('יש להוסיף לפחות שלב אחד ללוח הפניות');
    const wrongChannel = operationalFieldsSchema.safeParse({
      ...quotaBase,
      outreach_schedule: [{ days_before: '7', channel: 'call', message_key: 'x' }],
    });
    expect(issue(wrongChannel, 'outreach_schedule.0.channel')).toBe('הערוץ אינו נכלל בערוצי החבילה');
  });

  it('refuses a mix with the per-reached formula — on every formula field', () => {
    const msg = 'חבילה עם מכסה אינה משתמשת בתמחור לפי מענה — השאירו ריק';
    expect(issue(operationalFieldsSchema.safeParse({ ...quotaBase, price_per_reached: '4' }), 'price_per_reached')).toBe(msg);
    const base = operationalFieldsSchema.safeParse({ ...quotaBase, base_price: '200', included_reached: '200' });
    expect(issue(base, 'base_price')).toBe(msg);
    expect(issue(base, 'included_reached')).toBe(msg);
  });

  it('refuses a card-hold floor or buffer — a hold does not exist in this model', () => {
    const msg = 'שדה זה שייך לתפיסת מסגרת ואינו בשימוש בחבילה עם מכסה';
    expect(issue(operationalFieldsSchema.safeParse({ ...quotaBase, min_hold_floor: '50' }), 'min_hold_floor')).toBe(msg);
    expect(issue(operationalFieldsSchema.safeParse({ ...quotaBase, hold_buffer_pct: '10' }), 'hold_buffer_pct')).toBe(msg);
  });
});
