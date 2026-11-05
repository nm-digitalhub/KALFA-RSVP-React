'use server';

import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { headers } from 'next/headers';
import { returnValidationErrors } from 'next-safe-action';

import { getT } from '@/i18n.server';
import { INQUIRY_SUBMIT_RATE } from '@/lib/constants';
import { getUser } from '@/lib/auth/dal';
import {
  createCallbackRequest,
  createContactMessage,
} from '@/lib/data/inquiries';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import {
  callbackRequestSchema,
  contactMessageSchema,
} from '@/lib/validation/inquiries';
import { LEAD_SOURCES } from '@/lib/analytics/ga-event-contracts';

// Public inquiry actions (contact form + call-me-back). Order per form:
// IP rate-limit → honeypot → Zod → server-side session attach → write.
// Errors are generic (no DB/provider detail); the honeypot returns the SAME
// success notice as a real submission so bots learn nothing, but writes
// nothing.
//
// `leadSource` (analytics contract): set ONLY on a REAL persisted lead — the
// honeypot's fake success deliberately carries no flag, so a bot can never
// fire a generate_lead conversion. The UI reads data.notice; analytics reads
// data.leadSource.

// Read per request: the language comes from the header src/proxy.ts sets for the /en and /fr URLs.
async function inquiryMessages() {
  const { t } = await getT('public');
  return {
    rateLimited: t('site.contact.errors.rateLimited', 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.'),
    sendFailed: t('site.contact.errors.sendFailed', 'שליחת הפנייה נכשלה. נסו שוב בעוד רגע.'),
    contactSent: t('site.contact.success.contact', 'הפנייה נשלחה. נחזור אליכם בהקדם!'),
    callbackSent: t('site.contact.success.callback', 'הבקשה נשלחה. נתקשר אליכם בהקדם!'),
    checkFields: t('site.contact.errors.checkFields', 'נא לבדוק את הפרטים שמולאו.'),
  };
}

// The order above is the abuse protection. The IP rate limit is a
// pre-validation middleware (use() runs before the input is parsed); the
// honeypot and the real schemas run in the body. So the fields are taken as
// posted, untouched (z.unknown) — declared only so they survive zfd's object
// (undeclared keys are dropped) and so the field errors the form reads are
// typed.
const contactForm = zfd.formData({
  company: z.unknown().optional(),
  name: z.unknown().optional(),
  email: z.unknown().optional(),
  phone: z.unknown().optional(),
  topic: z.unknown().optional(),
  message: z.unknown().optional(),
});

const callbackForm = zfd.formData({
  company: z.unknown().optional(),
  full_name: z.unknown().optional(),
  phone: z.unknown().optional(),
  topic: z.unknown().optional(),
  note: z.unknown().optional(),
  preference: z.unknown().optional(),
});

function trimmedOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const submitContactAction = actionClient
  .use(async ({ next }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
    if (!(await rateLimit(`inquiry:contact:${ip}`, INQUIRY_SUBMIT_RATE)).allowed) {
      returnUserError((await inquiryMessages()).rateLimited);
    }
    return next();
  })
  .inputSchema(contactForm)
  .stateAction(async ({ parsedInput: input }) => {
    const messages = await inquiryMessages();
    // Honeypot: real users never see/fill "company". Pretend success, write nothing.
    if (trimmedOrUndefined(input.company)) {
      return { notice: messages.contactSent };
    }

    const { t } = await getT('public');
    const schema = contactMessageSchema(t);
    const parsed = schema.safeParse({
      name: input.name,
      email: trimmedOrUndefined(input.email),
      phone: trimmedOrUndefined(input.phone),
      topic: input.topic,
      message: input.message,
    });
    if (!parsed.success) {
      returnValidationErrors(schema, { ...z.formatError(parsed.error), _errors: [messages.checkFields] });
    }

    // Identity comes from the verified server session only (null = anonymous).
    const user = await getUser();
    const result = await createContactMessage(parsed.data, user?.id ?? null);
    if (!result.ok) {
      returnUserError(messages.sendFailed);
    }
    return { notice: messages.contactSent, leadSource: LEAD_SOURCES.contact };
  });

export const submitCallbackAction = actionClient
  .use(async ({ next }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
    if (!(await rateLimit(`inquiry:callback:${ip}`, INQUIRY_SUBMIT_RATE)).allowed) {
      returnUserError((await inquiryMessages()).rateLimited);
    }
    return next();
  })
  .inputSchema(callbackForm)
  .stateAction(async ({ parsedInput: input }) => {
    const messages = await inquiryMessages();
    if (trimmedOrUndefined(input.company)) {
      return { notice: messages.callbackSent };
    }

    const { t } = await getT('public');
    const schema = callbackRequestSchema(t);
    const parsed = schema.safeParse({
      full_name: input.full_name,
      phone: input.phone,
      topic: input.topic,
      note: trimmedOrUndefined(input.note),
      // An unchecked radio group posts nothing at all; the schema's default
      // turns that into 'asap'.
      preference: trimmedOrUndefined(input.preference),
    });
    if (!parsed.success) {
      returnValidationErrors(schema, { ...z.formatError(parsed.error), _errors: [messages.checkFields] });
    }

    const user = await getUser();
    const result = await createCallbackRequest(parsed.data, user?.id ?? null);
    if (!result.ok) {
      returnUserError(messages.sendFailed);
    }
    return { notice: messages.callbackSent, leadSource: LEAD_SOURCES.callback };
  });
