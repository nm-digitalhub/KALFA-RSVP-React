import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { getT } from '@/lib/i18n';
import { rsvpSubmitSchema } from './rsvp';

const schema = rsvpSubmitSchema(getT('public'));

describe('rsvpSubmitSchema', () => {
  it('accepts a valid attending response', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 2,
      kids: 1,
      meal_pref: 'צמחוני',
      note: 'נגיע בשמחה',
    });
    expect(result.success).toBe(true);
  });

  it('accepts declined with zero counts', () => {
    const result = schema.safeParse({
      status: 'declined',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status outside the whitelist', () => {
    const result = schema.safeParse({
      status: 'going',
      adults: 1,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one guest when attending', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(z.flattenError(result.error).fieldErrors.adults).toBeDefined();
    }
  });

  it('allows zero total for maybe (counts are forced to 0 server-side)', () => {
    const result = schema.safeParse({
      status: 'maybe',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative counts', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: -1,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer counts', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 1.5,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects counts above the absolute cap', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 51,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['not a number', 'x', 'מספר לא תקין'],
    ['a fraction', 1.5, 'מספר לא תקין'],
    ['a negative', -1, 'מספר לא תקין'],
    ['above the cap', 51, 'מספר גדול מדי'],
  ])('a count that is %s keeps its Hebrew message', (_case, adults, message) => {
    const result = schema.safeParse({ status: 'attending', adults, kids: 0 });
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('rejects an over-long note', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 1,
      kids: 0,
      note: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom answers as a string record', () => {
    const result = schema.safeParse({
      status: 'attending',
      adults: 1,
      kids: 0,
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
      adults: 1,
      kids: 0,
      answers: { note: 'x'.repeat(501) },
    });
    expect(result.success).toBe(false);
  });
});
