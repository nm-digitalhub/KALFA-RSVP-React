import { describe, expect, it } from 'vitest';

import {
  CALLBACK_STATUSES,
  callbackStatusEnum,
  updateCallbackStatusSchema,
  packageBaseSchema,
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
});

describe('appRoleEnum', () => {
  it('accepts admin and user, rejects others', () => {
    expect(appRoleEnum.safeParse('admin').success).toBe(true);
    expect(appRoleEnum.safeParse('user').success).toBe(true);
    expect(appRoleEnum.safeParse('superuser').success).toBe(false);
  });
});
