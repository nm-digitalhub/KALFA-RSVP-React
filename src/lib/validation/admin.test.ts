import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  rescheduleCallbackSchema,
  contactStatusEnum,
  updateContactStatusSchema,
  packageBaseSchema,
  operationalFieldsSchema,
  companySettingsSchema,
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

// A package with a contact quota is sold once at its own price_with_vat; the quota is how many contacts the campaign
// may approach. A package without a quota is a valid non-campaign package.
describe('operationalFieldsSchema', () => {
  // Shaped like readOperationalForm's output.
  const quotaBase = {
    contact_quota: '40',
    channels: ['whatsapp'],
    outreach_schedule: [{ days_before: '7', channel: 'whatsapp', message_key: 'rsvp_1' }],
  };
  const issue = (r: ReturnType<typeof operationalFieldsSchema.safeParse>, path: string) =>
    r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === path)?.message;

  it('accepts a quota with channels and a schedule', () => {
    const r = operationalFieldsSchema.safeParse(quotaBase);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contact_quota).toBe(40);
  });

  it('a blank or absent quota is a valid non-campaign package (null), with no campaign requirements', () => {
    for (const contact_quota of ['', undefined, null]) {
      const r = operationalFieldsSchema.safeParse({ contact_quota, channels: [], outreach_schedule: [] });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.contact_quota).toBeNull();
    }
  });

  it.each(['0', '-5', '2.5', 'abc'])('rejects the quota %j', (contact_quota) => {
    const r = operationalFieldsSchema.safeParse({ ...quotaBase, contact_quota });
    expect(r.success).toBe(false);
    expect(issue(r, 'contact_quota')).toBe('נא להזין מכסה תקינה (מספר שלם, 1 ומעלה)');
  });

  it('a quota package needs a channel and a schedule, on the channels it names', () => {
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

  it('carries no per-result or card-hold field: a submitted one is dropped, never stored', () => {
    const r = operationalFieldsSchema.safeParse({
      ...quotaBase,
      price_per_reached: '4',
      base_price: '200',
      included_reached: '200',
      min_hold_floor: '50',
      hold_buffer_pct: '10',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
        expect(r.data, old).not.toHaveProperty(old);
      }
    }
  });
});

// The reschedule form posts the raw value of an <input type="datetime-local">:
// Israel wall time, minute precision, no zone. The schema converts it to the
// real instant, so what the admin typed is what gets stored. Before this the
// string was stored as-is and Postgres read it as UTC — every time typed landed
// three hours late in summer (incident 2026-10-07: 06:36 became 10:36).
describe('rescheduleCallbackSchema', () => {
  const ID = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';
  const INVALID = 'נא לבחור מועד עתידי תקין';

  beforeEach(() => {
    vi.useFakeTimers();
    // 06:33 in Israel (IDT, UTC+3).
    vi.setSystemTime(new Date('2026-10-07T03:33:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const parse = (exactAt: unknown) => rescheduleCallbackSchema.safeParse({ id: ID, exactAt });

  it('converts the Israel wall time to the instant — 06:36 is 03:36Z, not 06:36Z', () => {
    const r = parse('2026-10-07T06:36');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exactAt).toBe('2026-10-07T03:36:00.000Z');
  });

  it('uses the offset of the date typed (winter is UTC+2)', () => {
    vi.setSystemTime(new Date('2026-01-15T05:00:00.000Z'));
    const r = parse('2026-01-15T09:30');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exactAt).toBe('2026-01-15T07:30:00.000Z');
  });

  it('keeps the id as submitted', () => {
    const r = parse('2026-10-07T06:36');
    expect(r.success && r.data.id).toBe(ID);
  });

  it('rejects a time that is already past in Israel, and the current minute', () => {
    for (const past of ['2026-10-07T06:30', '2026-10-07T06:33', '2026-10-06T23:00']) {
      const r = parse(past);
      expect(r.success, past).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe(INVALID);
    }
  });

  it('judges "future" on the converted instant, not on the raw digits', () => {
    // 09:00 as raw digits is "after" 06:33 only because Postgres would have read
    // it as UTC; in Israel 06:35 is 2 minutes ahead and 06:32 is already past.
    expect(parse('2026-10-07T06:35').success).toBe(true);
    expect(parse('2026-10-07T06:32').success).toBe(false);
  });

  it('rejects anything that is not minute-precision wall time with no zone', () => {
    for (const bad of [
      '',
      'garbage',
      '2026-10-07',
      '2026-10-07T06:36:30',
      '2026-10-07T06:36:00Z', // the form Zod's docs show as valid for `local: true`
      '2026-10-07T06:36Z',
      '2026-10-07T06:36+03:00',
      '2026-10-07T03:36:00.000Z',
      '2026-02-30T10:00',
      null,
      undefined,
    ]) {
      const r = parse(bad);
      expect(r.success, String(bad)).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe(INVALID);
    }
  });

  it('still requires a valid request id', () => {
    const r = rescheduleCallbackSchema.safeParse({ id: 'not-a-uuid', exactAt: '2026-10-07T06:36' });
    expect(r.success).toBe(false);
  });
});

describe('companySettingsSchema — the agreement link addresses', () => {
  const company = {
    company_legal_name: 'קאלפא',
    company_legal_id: '51-1234567',
    company_legal_address: 'הרצל 1',
    company_contact_phone: '03-1234567',
    company_contact_email: 'support@kalfa.me',
    privacy_url: 'https://beta.kalfa.me/privacy',
    terms_url: '/terms',
    warranty_text: 'ת',
    company_instagram_url: '',
  };

  it('saves an http(s) address, a path on this site, or empty (the /privacy and /terms defaults)', () => {
    expect(companySettingsSchema.safeParse(company).success).toBe(true);
    expect(companySettingsSchema.safeParse({ ...company, privacy_url: '', terms_url: '' }).success).toBe(true);
  });

  it.each(['privacy_url', 'terms_url'] as const)('refuses an unsafe %s at the source, with the field named', (field) => {
    for (const value of ['javascript:alert(1)', '//evil.example/x', 'https://']) {
      const parsed = companySettingsSchema.safeParse({ ...company, [field]: value });
      expect(parsed.success, value).toBe(false);
      if (!parsed.success) expect(Object.keys(parsed.error.flatten().fieldErrors)).toEqual([field]);
    }
  });
});
