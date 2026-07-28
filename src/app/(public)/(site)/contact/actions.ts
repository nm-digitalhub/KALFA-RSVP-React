'use server';

import { headers } from 'next/headers';

import { INQUIRY_SUBMIT_RATE } from '@/lib/constants';
import { getUser } from '@/lib/auth/dal';
import {
  createCallbackRequest,
  createContactMessage,
} from '@/lib/data/inquiries';
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
// fire a generate_lead conversion. The UI reads notice; analytics reads
// leadSource.

export type InquiryFormState =
  | {
      error?: string;
      notice?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      leadSource?: (typeof LEAD_SOURCES)[keyof typeof LEAD_SOURCES];
    }
  | null;

const RATE_ERROR = 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.';
const GENERIC_ERROR = 'שליחת הפנייה נכשלה. נסו שוב בעוד רגע.';
const CONTACT_SUCCESS = 'הפנייה נשלחה. נחזור אליכם בהקדם!';
const CALLBACK_SUCCESS = 'הבקשה נשלחה. נתקשר אליכם בהקדם!';

function trimmedOrUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function submitContactAction(
  _prevState: InquiryFormState,
  formData: FormData,
): Promise<InquiryFormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  if (!rateLimit(`inquiry:contact:${ip}`, INQUIRY_SUBMIT_RATE).allowed) {
    return { error: RATE_ERROR };
  }

  // Honeypot: real users never see/fill "company". Pretend success, write nothing.
  if (trimmedOrUndefined(formData.get('company'))) {
    return { notice: CONTACT_SUCCESS };
  }

  const parsed = contactMessageSchema.safeParse({
    name: formData.get('name'),
    email: trimmedOrUndefined(formData.get('email')),
    phone: trimmedOrUndefined(formData.get('phone')),
    topic: formData.get('topic'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Identity comes from the verified server session only (null = anonymous).
  const user = await getUser();
  const result = await createContactMessage(parsed.data, user?.id ?? null);
  if (!result.ok) {
    return { error: GENERIC_ERROR };
  }
  return { notice: CONTACT_SUCCESS, leadSource: LEAD_SOURCES.contact };
}

export async function submitCallbackAction(
  _prevState: InquiryFormState,
  formData: FormData,
): Promise<InquiryFormState> {
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders.get.bind(requestHeaders));
  if (!rateLimit(`inquiry:callback:${ip}`, INQUIRY_SUBMIT_RATE).allowed) {
    return { error: RATE_ERROR };
  }

  if (trimmedOrUndefined(formData.get('company'))) {
    return { notice: CALLBACK_SUCCESS };
  }

  const parsed = callbackRequestSchema.safeParse({
    full_name: formData.get('full_name'),
    phone: formData.get('phone'),
    topic: formData.get('topic'),
    note: trimmedOrUndefined(formData.get('note')),
    // An unchecked radio group posts nothing at all; the schema's default
    // turns that into 'asap', which is exactly what the form did before this
    // field existed.
    preference: trimmedOrUndefined(formData.get('preference')),
  });
  if (!parsed.success) {
    return {
      error: 'נא לבדוק את הפרטים שמולאו.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await getUser();
  const result = await createCallbackRequest(parsed.data, user?.id ?? null);
  if (!result.ok) {
    return { error: GENERIC_ERROR };
  }
  return { notice: CALLBACK_SUCCESS, leadSource: LEAD_SOURCES.callback };
}
