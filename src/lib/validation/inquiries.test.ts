import { describe, expect, it } from 'vitest';

import {
  INQUIRY_TOPICS,
  contactMessageSchema,
  callbackRequestSchema,
} from './inquiries';

describe('contactMessageSchema', () => {
  const valid = {
    name: 'דנה לוי',
    email: 'dana@example.com',
    topic: 'מכירות',
    message: 'אשמח לפרטים על המערכת',
  };

  it('accepts a valid submission with email only', () => {
    expect(contactMessageSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts phone instead of email', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      email: undefined,
      phone: '052-111-2222',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when both phone and email are missing', () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, email: undefined });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid phone', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      email: undefined,
      phone: '123',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a topic outside the closed vocabulary', () => {
    const parsed = contactMessageSchema.safeParse({ ...valid, topic: 'אחר לגמרי' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an overlong message', () => {
    const parsed = contactMessageSchema.safeParse({
      ...valid,
      message: 'א'.repeat(2001),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('callbackRequestSchema', () => {
  it('accepts a valid call-me-back request', () => {
    const parsed = callbackRequestSchema.safeParse({
      full_name: 'יוסי כהן',
      phone: '0521112222',
      topic: INQUIRY_TOPICS[1],
      note: 'נוח לי אחרי 17:00',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a phone', () => {
    const parsed = callbackRequestSchema.safeParse({
      full_name: 'יוסי כהן',
      phone: '',
      topic: 'תמיכה',
    });
    expect(parsed.success).toBe(false);
  });
});
