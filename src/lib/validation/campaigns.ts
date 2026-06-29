import { z } from 'zod';

// Campaign CREATION takes no owner input: the canonical template, the derived
// activity window, price, max_contacts and channels are all resolved
// server-side (§17/§18.7/§7) — so there is no create-terms schema. The schemas
// below cover the approval + outreach actions only.

// Approval requires the three consents (§18) + the ToS version that was shown.
export const approveCampaignSchema = z.object({
  campaign_id: z.string().uuid({ error: 'מזהה קמפיין לא תקין' }),
  tos_version: z.string().trim().min(1, { error: 'גרסת תנאי שירות חסרה' }),
  terms_accepted: z.literal(true, { error: 'יש לאשר את התקנון' }),
  privacy_accepted: z.literal(true, { error: 'יש לאשר את מדיניות הפרטיות' }),
  authorization_accepted: z.literal(true, {
    error: 'יש לאשר את הרשאת החיוב',
  }),
});
export type ApproveCampaignInput = z.infer<typeof approveCampaignSchema>;

// Route A J5 hold: the browser submits ONLY the single-use card token (payments.js
// injects the `og-token` hidden field). The campaign id is the route param and the
// hold amount is the server-derived ceiling — neither is trusted from the form.
export const authorizeHoldSchema = z.object({
  'og-token': z.string().trim().min(1, { error: 'פרטי תשלום חסרים' }),
});
export type AuthorizeHoldInput = z.infer<typeof authorizeHoldSchema>;

// B3 manual WhatsApp-send trigger: the form supplies the outreach message_key
// (which template to send). The campaign id is the route param.
export const whatsappSendSchema = z.object({
  message_key: z.string().trim().min(1, { error: 'נא לבחור תבנית הודעה' }),
});
export type WhatsappSendInput = z.infer<typeof whatsappSendSchema>;
