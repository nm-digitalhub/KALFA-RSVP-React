import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getT } from '@/lib/i18n';
import {
  INQUIRY_TOPICS,
  callbackIntakeSchema,
  contactMessageSchema,
  callbackRequestSchema,
  toInquiryTopic,
} from './inquiries';

const t = getT('public');

describe('contactMessageSchema', () => {
  const valid = {
    name: 'דנה לוי',
    email: 'dana@example.com',
    topic: 'מכירות',
    message: 'אשמח לפרטים על המערכת',
  };

  it('accepts a valid submission with email only', () => {
    expect(contactMessageSchema(t).safeParse(valid).success).toBe(true);
  });

  it('accepts phone instead of email', () => {
    const parsed = contactMessageSchema(t).safeParse({
      ...valid,
      email: undefined,
      phone: '052-111-2222',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when both phone and email are missing', () => {
    const parsed = contactMessageSchema(t).safeParse({ ...valid, email: undefined });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid phone', () => {
    const parsed = contactMessageSchema(t).safeParse({
      ...valid,
      email: undefined,
      phone: '123',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a topic outside the closed vocabulary', () => {
    const parsed = contactMessageSchema(t).safeParse({ ...valid, topic: 'אחר לגמרי' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an overlong message', () => {
    const parsed = contactMessageSchema(t).safeParse({
      ...valid,
      message: 'א'.repeat(2001),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('callbackRequestSchema', () => {
  it('accepts a valid call-me-back request', () => {
    const parsed = callbackRequestSchema(t).safeParse({
      full_name: 'יוסי כהן',
      phone: '0521112222',
      topic: INQUIRY_TOPICS[1],
      note: 'נוח לי אחרי 17:00',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a phone', () => {
    const parsed = callbackRequestSchema(t).safeParse({
      full_name: 'יוסי כהן',
      phone: '',
      topic: 'תמיכה',
    });
    expect(parsed.success).toBe(false);
  });
});

// The exact Hebrew of every message, written out here and not derived from a schema. Zod drops a message given in the
// wrong form without any error, and the visitor then reads its English default: `success` alone would not show that.
describe('messages', () => {
  function fieldErrors(result: { success: boolean; error?: z.ZodError }) {
    return result.error ? z.flattenError(result.error).fieldErrors : null;
  }

  it('contactMessageSchema: every field, and the rule that asks for a phone or an email', () => {
    const schema = contactMessageSchema(t);

    expect(fieldErrors(schema.safeParse({ name: 'א', email: 'x', phone: '123', topic: 'לא נושא', message: 'קצר' }))).toEqual({
      name: ['נא למלא שם'],
      email: ['כתובת האימייל אינה תקינה'],
      phone: ['מספר הטלפון אינו תקין'],
      topic: ['נא לבחור נושא'],
      message: ['נא לכתוב את תוכן הפנייה'],
    });
    expect(
      fieldErrors(schema.safeParse({ name: 'א'.repeat(121), email: 'a@b.co', topic: 'מכירות', message: 'א'.repeat(2001) })),
    ).toEqual({ name: ['השם ארוך מדי'], message: ['ההודעה ארוכה מדי'] });
    expect(fieldErrors(schema.safeParse({ name: 'דנה לוי', topic: 'מכירות', message: 'אשמח לפרטים' }))).toEqual({
      phone: ['נא למלא טלפון או אימייל ליצירת קשר'],
    });
  });

  it('callbackRequestSchema', () => {
    expect(
      fieldErrors(
        callbackRequestSchema(t).safeParse({ full_name: 'א', phone: '123', topic: 'לא נושא', note: 'א'.repeat(501) }),
      ),
    ).toEqual({
      full_name: ['נא למלא שם'],
      phone: ['מספר הטלפון אינו תקין'],
      topic: ['נא לבחור נושא'],
      note: ['ההערה ארוכה מדי'],
    });
  });

  it('callbackIntakeSchema', () => {
    expect(
      fieldErrors(callbackIntakeSchema(t).safeParse({ full_name: 'א', topic: 'לא נושא', note: 'א'.repeat(501) })),
    ).toEqual({
      full_name: ['נא למלא שם'],
      topic: ['נא לבחור נושא'],
      note: ['ההערה ארוכה מדי'],
    });
  });

  it('a schema speaks through the t it was given', () => {
    // A real second language: the line comes from its resources, so a message that ignored `t` would still read Hebrew.
    const i18n = createInstance();
    void i18n.init({
      lng: 'en',
      initAsync: false,
      resources: { en: { public: { validation: { name: { required: 'Please enter a name' } } } } },
    });

    expect(
      fieldErrors(callbackIntakeSchema(i18n.getFixedT('en', 'public')).safeParse({ full_name: 'א', topic: 'מכירות' })),
    ).toEqual({ full_name: ['Please enter a name'] });
  });
});

describe('toInquiryTopic', () => {
  it('keeps a known topic and reads anything else as אחר', () => {
    for (const topic of INQUIRY_TOPICS) expect(toInquiryTopic(topic)).toBe(topic);
    expect(toInquiryTopic(null)).toBe('אחר');
    expect(toInquiryTopic('')).toBe('אחר');
    expect(toInquiryTopic('נושא שהוסר')).toBe('אחר');
  });

  it('callbackIntakeSchema drops a submitted phone and keeps the other answers', () => {
    const parsed = callbackIntakeSchema(t).parse({ full_name: 'דנה לוי', topic: 'מכירות', phone: '0501234567' });
    expect(parsed).toEqual({ full_name: 'דנה לוי', topic: 'מכירות', preference: 'asap' });
  });
});
