import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { HEADCOUNT_MAX } from '@/lib/constants';
import { getT } from '@/lib/i18n';
import { rsvpSubmitSchema } from './rsvp';

const schema = rsvpSubmitSchema(getT('public'));

describe('rsvpSubmitSchema', () => {
  it('accepts a valid attending response with one count', () => {
    const result = schema.safeParse({
      status: 'attending',
      headcount: 3,
      meal_pref: 'צמחוני',
      note: 'נגיע בשמחה',
    });
    expect(result.success).toBe(true);
  });

  it('accepts more than 10 people: there is no ceiling of 10', () => {
    expect(schema.safeParse({ status: 'attending', headcount: 15 }).success).toBe(true);
    expect(schema.safeParse({ status: 'attending', headcount: HEADCOUNT_MAX }).success).toBe(true);
  });

  it('accepts declined with a zero count', () => {
    const result = schema.safeParse({ status: 'declined', headcount: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a status outside the whitelist', () => {
    const result = schema.safeParse({ status: 'going', headcount: 1 });
    expect(result.success).toBe(false);
  });

  it('requires at least one guest when attending, reported on the count field', () => {
    const result = schema.safeParse({ status: 'attending', headcount: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(z.flattenError(result.error).fieldErrors.headcount).toEqual(['נא לציין לפחות אורח אחד']);
    }
  });

  it('allows a zero count for maybe (the count is forced to 0 server-side)', () => {
    const result = schema.safeParse({ status: 'maybe', headcount: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects a negative count', () => {
    expect(schema.safeParse({ status: 'attending', headcount: -1 }).success).toBe(false);
  });

  it('rejects a non-integer count', () => {
    expect(schema.safeParse({ status: 'attending', headcount: 1.5 }).success).toBe(false);
  });

  it('rejects a count above the absolute cap', () => {
    expect(schema.safeParse({ status: 'attending', headcount: HEADCOUNT_MAX + 1 }).success).toBe(false);
  });

  it.each([
    ['not a number', 'x', 'מספר לא תקין'],
    ['a fraction', 1.5, 'מספר לא תקין'],
    ['a negative', -1, 'מספר לא תקין'],
    ['above the cap', HEADCOUNT_MAX + 1, 'מספר גדול מדי'],
  ])('a count that is %s keeps its Hebrew message', (_case, headcount, message) => {
    const result = schema.safeParse({ status: 'attending', headcount });
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('rejects an over-long note', () => {
    const result = schema.safeParse({ status: 'attending', headcount: 1, note: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts custom answers as a string record', () => {
    const result = schema.safeParse({
      status: 'attending',
      headcount: 1,
      answers: { bus: 'yes', allergy: 'בוטנים' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answers).toEqual({ bus: 'yes', allergy: 'בוטנים' });
    }
  });

  it('rejects an over-long answer value', () => {
    const result = schema.safeParse({
      status: 'attending',
      headcount: 1,
      answers: { note: 'x'.repeat(501) },
    });
    expect(result.success).toBe(false);
  });
});
