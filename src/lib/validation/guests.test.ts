import { describe, expect, it } from 'vitest';

import {
  createGuestSchema,
  updateGuestSchema,
  importRowSchema,
  groupSchema,
} from './guests';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('createGuestSchema', () => {
  it('accepts the minimal valid guest (name only)', () => {
    const r = createGuestSchema.safeParse({ full_name: 'דנה כהן' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(createGuestSchema.safeParse({ full_name: '   ' }).success).toBe(false);
  });

  it('accepts a valid Israeli mobile phone', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', phone: '050-1234567' })
        .success,
    ).toBe(true);
  });

  it('rejects a malformed phone', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', phone: '12' }).success,
    ).toBe(false);
  });

  it('allows an empty phone (optional)', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', phone: '' }).success,
    ).toBe(true);
  });

  it('accepts every guest_status enum value', () => {
    for (const status of ['pending', 'attending', 'declined', 'maybe'] as const) {
      const r = createGuestSchema.safeParse({ full_name: 'דנה', status });
      expect(r.success).toBe(true);
    }
  });

  it('rejects a status outside the enum', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', status: 'rejected' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-uuid group_id', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', group_id: 'not-a-uuid' })
        .success,
    ).toBe(false);
  });

  it('accepts a uuid group_id and an empty group_id', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', group_id: VALID_UUID })
        .success,
    ).toBe(true);
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', group_id: '' }).success,
    ).toBe(true);
  });

  it('rejects a negative expected_count', () => {
    expect(
      createGuestSchema.safeParse({ full_name: 'דנה', expected_count: '-1' })
        .success,
    ).toBe(false);
  });
});

describe('updateGuestSchema', () => {
  it('is fully partial (empty object is valid)', () => {
    expect(updateGuestSchema.safeParse({}).success).toBe(true);
  });

  it('has no id / event_id / rsvp_token fields, so they cannot be smuggled', () => {
    const r = updateGuestSchema.safeParse({
      full_name: 'דנה',
      id: 'x',
      event_id: 'y',
      rsvp_token: 'secret',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('id');
      expect(r.data).not.toHaveProperty('event_id');
      expect(r.data).not.toHaveProperty('rsvp_token');
    }
  });
});

describe('importRowSchema', () => {
  it('accepts a row with name + phone + group', () => {
    const r = importRowSchema.safeParse({
      full_name: 'דנה',
      phone: '0501234567',
      group: 'משפחה',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a row with no name', () => {
    expect(importRowSchema.safeParse({ full_name: '' }).success).toBe(false);
  });

  it('rejects a row with a malformed phone', () => {
    expect(
      importRowSchema.safeParse({ full_name: 'דנה', phone: 'abc' }).success,
    ).toBe(false);
  });
});

describe('groupSchema', () => {
  it('accepts a named group', () => {
    expect(groupSchema.safeParse({ name: 'משפחה' }).success).toBe(true);
  });

  it('rejects an empty group name', () => {
    expect(groupSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
