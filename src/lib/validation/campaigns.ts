import { z } from 'zod';

// Validation for campaign creation (outcome-billing). Almost everything is
// server-authoritative, NOT owner input: the price comes from the template
// (§18.7/§18.8), max_contacts is derived from the unique-contact count (§7), the
// channels and the attempt/escalation policy come from the template (§17/§8.2).
// The owner only chooses the template and the activity window.

export const campaignTermsSchema = z.object({
  template_id: z.string().uuid({ error: 'יש לבחור מסלול שירות' }),
  start_at: z.string().trim().min(1).optional(),
  close_at: z.string().trim().min(1).optional(),
});
export type CampaignTermsInput = z.infer<typeof campaignTermsSchema>;

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
