import { z } from 'zod';

// Campaign CREATION takes no owner-chosen terms: the canonical template, the
// derived activity window, price, max_contacts and channels are all resolved
// server-side (§17/§18.7/§7) — so there is no create-terms schema. The only
// creation input is WHICH fixed-price package (choosePackageSchema below). The
// schemas below cover the setup, approval, payment and outreach actions.

// Approval requires the consents + the ToS version that was shown.
//
// The billing authorization is NOT a third checkbox here: the agreement being
// signed already carries it as §4 ("אמצעי תשלום, מועד חיוב והרשאת חיוב"), with §3
// covering the ceiling — and the signature, content_hash and PDF are what
// actually record consent. A checkbox would not be persisted either
// (signed_agreements has no column for it), so it would add friction without
// adding evidence.
export const approveCampaignSchema = z.object({
  campaign_id: z.uuid({ error: 'מזהה קמפיין לא תקין' }),
  tos_version: z.string().trim().min(1, { error: 'גרסת תנאי שירות חסרה' }),
  terms_accepted: z.literal(true, { error: 'יש לאשר את התקנון' }),
  privacy_accepted: z.literal(true, { error: 'יש לאשר את מדיניות הפרטיות' }),
});
export type ApproveCampaignInput = z.infer<typeof approveCampaignSchema>;

// The owner's explicit acknowledgments at "אישור פרטי האירוע", recorded on the
// activity log. They are checkboxes posted as 'on' (an unchecked box posts
// nothing), and they are enforced HERE — the disabled button in the form is only
// convenience. The wording the owner saw is the UI's; what is recorded is the
// key, so a rewording never changes what was acknowledged.
export const SETUP_ACKNOWLEDGMENT_KEYS = ['ack_datetime', 'ack_venue', 'ack_lock'] as const;
export const setupAcknowledgmentsSchema = z.object({
  ack_datetime: z.literal('on'),
  ack_venue: z.literal('on'),
  ack_lock: z.literal('on'),
});

// Route A J5 hold: the browser submits ONLY the single-use card token (payments.js
// injects the `og-token` hidden field). The campaign id is the route param and the
// hold amount is derived on the server — neither is trusted from the form.
export const authorizeHoldSchema = z.object({
  'og-token': z.string().trim().min(1, { error: 'פרטי תשלום חסרים' }),
});
export type AuthorizeHoldInput = z.infer<typeof authorizeHoldSchema>;

// Package purchase: the same single field. The price charged is the campaign's own `package_price`, read on the server
// — the browser submits only the single-use card token, and any other field is dropped by the parse.
export const purchasePackageSchema = z.object({
  'og-token': z.string({ error: 'פרטי תשלום חסרים' }).trim().min(1, { error: 'פרטי תשלום חסרים' }),
});
export type PurchasePackageInput = z.infer<typeof purchasePackageSchema>;

// Choosing a fixed-price package in the setup flow: the browser submits only WHICH package. The price, the quota and
// whether it is on offer at all are read on the server by createCampaign.
export const choosePackageSchema = z.object({
  package_id: z.uuid({ error: 'יש לבחור חבילה' }),
});
export type ChoosePackageInput = z.infer<typeof choosePackageSchema>;

// Manual WhatsApp-send trigger: the form supplies the outreach message_key
// (which template to send). The campaign id is the route param.
export const whatsappSendSchema = z.object({
  message_key: z.string().trim().min(1, { error: 'נא לבחור תבנית הודעה' }),
});
export type WhatsappSendInput = z.infer<typeof whatsappSendSchema>;

// Auto-thankyou owner controls: opt-in toggle + an editable Israel wall-clock
// date/time (composed server-side via ilWallTimeToIso, same as event_date).
// Both empty together clears the schedule (the sweep just skips a null); a
// partial pair (one filled, one blank) is rejected rather than guessed.
export const thankyouScheduleSchema = z
  .object({
    auto_enabled: z.boolean(),
    send_date: z.string().trim(),
    send_time: z.string().trim(),
  })
  .refine((v) => (v.send_date === '') === (v.send_time === ''), {
    error: 'יש למלא גם תאריך וגם שעה, או להשאיר את שניהם ריקים',
    path: ['send_date'],
  });
export type ThankyouScheduleInput = z.infer<typeof thankyouScheduleSchema>;

// Staff reschedule of a live event (admin surface on the campaign board). The
// reason is REQUIRED and is not a formality: it is the only human account of why
// a customer's date moved, and it lands in the support access log beside the
// staff id.
export const rescheduleEventSchema = z.object({
  event_date: z.string().trim().min(1, { error: 'יש לבחור תאריך' }),
  event_time: z.string().trim().min(1, { error: 'יש לבחור שעה' }),
  reason: z
    .string()
    .trim()
    .min(10, { error: 'יש לפרט את הסיבה לשינוי המועד (10 תווים לפחות)' })
    .max(500, { error: 'הסיבה ארוכה מדי' }),
});
export type RescheduleEventInput = z.infer<typeof rescheduleEventSchema>;
