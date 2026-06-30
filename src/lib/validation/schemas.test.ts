import { describe, expect, it } from 'vitest';

import {
  createEventSchema,
  EVENT_TYPES,
  loginSchema,
  ORDER_STATUSES,
  payPendingOrderSchema,
  signupSchema,
  updateEventSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from './schemas';
import { PROFILE_NAME_MAX } from '@/lib/constants';
import { todayIL } from '@/lib/data/event-date';

// S2.2 — relative-to-real-time date strings (Israel calendar day), so these
// tests never go stale. Reuses the SAME production helper the refines call
// (todayIL), not a re-derived date computation.
function ilDate(offsetDays: number): string {
  return todayIL(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
}

describe('loginSchema', () => {
  it('accepts a valid email + password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('trims the email', () => {
    const result = loginSchema.safeParse({
      email: '  user@example.com  ',
      password: 'secret',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('user@example.com');
  });

  it('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('signupSchema', () => {
  it('accepts an 8+ character password with a full name', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      full_name: 'ישראל ישראלי',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '1234567',
      full_name: 'ישראל ישראלי',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 72 characters', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(73),
      full_name: 'ישראל ישראלי',
    });
    expect(result.success).toBe(false);
  });

  it('requires a full name', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      full_name: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid Israeli phone', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      full_name: 'ישראל ישראלי',
      phone: '050-123-4567',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty phone (optional)', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      full_name: 'ישראל ישראלי',
      phone: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid phone', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      full_name: 'ישראל ישראלי',
      phone: '123',
    });
    expect(result.success).toBe(false);
  });
});

describe('createEventSchema', () => {
  it('accepts the minimal valid event (name + type)', () => {
    const result = createEventSchema.safeParse({
      name: 'חתונה של דנה ויוסי',
      event_type: 'wedding',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing/empty name', () => {
    const result = createEventSchema.safeParse({ name: '   ', event_type: 'wedding' });
    expect(result.success).toBe(false);
  });

  it('rejects an event_type outside the enum', () => {
    const result = createEventSchema.safeParse({ name: 'אירוע', event_type: 'concert' });
    expect(result.success).toBe(false);
  });

  it('allows every event_type in EVENT_TYPES', () => {
    for (const type of EVENT_TYPES) {
      const result = createEventSchema.safeParse({ name: 'אירוע', event_type: type });
      expect(result.success).toBe(true);
    }
  });

  it('allows optional venue_name and event_date to be empty strings', () => {
    const result = createEventSchema.safeParse({
      name: 'אירוע',
      event_type: 'birthday',
      event_date: '',
      venue_name: '',
    });
    expect(result.success).toBe(true);
  });

  // S2.2 — R2: event_date must be at least tomorrow (Israel). Mirrors the new
  // DB trigger's lower bound; '' (no date yet) stays legal for a draft.
  it('rejects an event_date of today, with the error on event_date', () => {
    const result = createEventSchema.safeParse({
      name: 'אירוע',
      event_type: 'birthday',
      event_date: ilDate(0),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.event_date).toBeDefined();
    }
  });

  it('rejects an event_date in the past', () => {
    const result = createEventSchema.safeParse({
      name: 'אירוע',
      event_type: 'birthday',
      event_date: ilDate(-1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts an event_date of tomorrow (the earliest legal date)', () => {
    const result = createEventSchema.safeParse({
      name: 'אירוע',
      event_type: 'birthday',
      event_date: ilDate(1),
    });
    expect(result.success).toBe(true);
  });
});

describe('updateEventSchema — rsvp_deadline vs event_date', () => {
  const base = {
    name: 'חתונה של דנה ויוסי',
    event_type: 'wedding' as const,
    status: 'draft' as const,
  };

  it('accepts a deadline on/before the event date', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '2026-08-15',
      rsvp_deadline: '2026-08-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a deadline equal to the event date (boundary)', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '2026-08-15',
      rsvp_deadline: '2026-08-15',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an event date with no deadline', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '2026-08-15',
      rsvp_deadline: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts neither date set (both optional)', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '',
      rsvp_deadline: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a deadline after the event date, with the error on rsvp_deadline', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '2026-08-15',
      rsvp_deadline: '2026-08-20',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.rsvp_deadline).toBeDefined();
    }
  });

  it('rejects a deadline with no event date, with the error on rsvp_deadline', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: '',
      rsvp_deadline: '2026-08-20',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.rsvp_deadline).toBeDefined();
    }
  });

  // S2.2 — R2: event_date must be at least tomorrow (Israel). Uses a fixed
  // far-future literal for rsvp_deadline so it never collides with the R2b
  // lower bound being tested separately below.
  it('rejects an event_date of today', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: ilDate(0),
      rsvp_deadline: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.event_date).toBeDefined();
    }
  });

  it('accepts an event_date of tomorrow', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: ilDate(1),
      rsvp_deadline: '',
    });
    expect(result.success).toBe(true);
  });

  // S2.2 — R2b (NEW, found live on ec7c68d1): rsvp_deadline must not already be
  // in the past. Lower bound is >= TODAY (not tomorrow) — same-day is legal.
  it('rejects a deadline of yesterday, with the error on rsvp_deadline', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: ilDate(30),
      rsvp_deadline: ilDate(-1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.rsvp_deadline).toBeDefined();
    }
  });

  it('accepts a deadline of today (R2b boundary — same-day is legal)', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: ilDate(30),
      rsvp_deadline: ilDate(0),
    });
    expect(result.success).toBe(true);
  });

  it('does not include a status field in the parsed output (S2.2 — status removed)', () => {
    const result = updateEventSchema.safeParse({
      ...base,
      event_date: ilDate(30),
      rsvp_deadline: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('status');
    }
  });
});

describe('ORDER_STATUSES', () => {
  it('matches the public.order_status enum vocabulary', () => {
    expect([...ORDER_STATUSES]).toEqual([
      'pending',
      'processing',
      'paid',
      'failed',
      'demo',
      'payment_review',
    ]);
  });
});

describe('payPendingOrderSchema', () => {
  // A real v4 UUID — NOT an all-ones value, which Zod 4's z.uuid() rejects
  // because it enforces a valid version/variant nibble.
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts a valid uuid order_id + non-empty og-token', () => {
    const result = payPendingOrderSchema.safeParse({
      order_id: validUuid,
      'og-token': 'tok_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid order_id', () => {
    const result = payPendingOrderSchema.safeParse({
      order_id: 'not-a-uuid',
      'og-token': 'tok_abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty og-token', () => {
    const result = payPendingOrderSchema.safeParse({
      order_id: validUuid,
      'og-token': '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only og-token', () => {
    const result = payPendingOrderSchema.safeParse({
      order_id: validUuid,
      'og-token': '   ',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts both fields empty (nothing required)', () => {
    const result = updateProfileSchema.safeParse({ full_name: '', phone: '' });
    expect(result.success).toBe(true);
  });

  it('accepts a name and a valid phone', () => {
    const result = updateProfileSchema.safeParse({
      full_name: 'דנה כהן',
      phone: '050-123-4567',
    });
    expect(result.success).toBe(true);
  });

  // Valid Israeli numbers across formats: mobile (05N), VoIP (07N), geographic
  // landlines (02/03/04/08/09), and the +972 / 972 international forms.
  it.each([
    '0501234567',
    '050-123-4567',
    '050 123 4567',
    '0721234567', // VoIP 07N
    '021234567', // Jerusalem landline 02
    '031234567', // Tel Aviv landline 03
    '041234567', // Haifa landline 04
    '081234567', // South landline 08
    '091234567', // Sharon landline 09
    '+972501234567',
    '+972-50-123-4567',
    '972501234567',
  ])('accepts valid Israeli phone %s', (phone) => {
    const result = updateProfileSchema.safeParse({ phone });
    expect(result.success).toBe(true);
  });

  // Invalid: wrong area/prefix, too few/many digits, non-Israeli, letters.
  it.each([
    '0601234567', // 06 is not a valid prefix
    '05012345', // too short
    '05012345678', // too long
    '011234567', // 01 is not a valid area code
    '1234567', // no leading 0 / prefix
    '+1 555 123 4567', // non-Israeli
    'not-a-phone',
  ])('rejects invalid phone %s', (phone) => {
    const result = updateProfileSchema.safeParse({ phone });
    expect(result.success).toBe(false);
  });

  it('rejects a name longer than PROFILE_NAME_MAX', () => {
    const result = updateProfileSchema.safeParse({
      full_name: 'א'.repeat(PROFILE_NAME_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a name exactly at PROFILE_NAME_MAX', () => {
    const result = updateProfileSchema.safeParse({
      full_name: 'א'.repeat(PROFILE_NAME_MAX),
    });
    expect(result.success).toBe(true);
  });
});


describe('updateSettingsSchema', () => {
  it('coerces checked checkbox values to booleans', () => {
    const result = updateSettingsSchema.safeParse({
      event_updates: 'on',
      reminder_updates: 'on',
      billing_updates: 'on',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        event_updates: true,
        reminder_updates: true,
        billing_updates: true,
      });
    }
  });

  it('treats missing checkbox values as false', () => {
    const result = updateSettingsSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        event_updates: false,
        reminder_updates: false,
        billing_updates: false,
      });
    }
  });
});
