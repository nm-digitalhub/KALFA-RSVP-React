import { describe, expect, it } from 'vitest';

import { rsvpSubmitSchema } from './rsvp';

describe('rsvpSubmitSchema', () => {
  it('accepts a valid attending response', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 2,
      kids: 1,
      meal_pref: 'צמחוני',
      note: 'נגיע בשמחה',
    });
    expect(result.success).toBe(true);
  });

  it('accepts declined with zero counts', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'declined',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status outside the whitelist', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'going',
      adults: 1,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one guest when attending', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.adults).toBeDefined();
    }
  });

  it('allows zero total for maybe (counts are forced to 0 server-side)', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'maybe',
      adults: 0,
      kids: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative counts', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: -1,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer counts', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 1.5,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects counts above the absolute cap', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 51,
      kids: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long note', () => {
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 1,
      kids: 0,
      note: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom answers as a string record', () => {
    const result = rsvpSubmitSchema.safeParse({
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
    const result = rsvpSubmitSchema.safeParse({
      status: 'attending',
      adults: 1,
      kids: 0,
      answers: { note: 'x'.repeat(501) },
    });
    expect(result.success).toBe(false);
  });
});
