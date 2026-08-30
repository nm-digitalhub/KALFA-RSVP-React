import { z } from 'zod';

// Payload shapes for the 4 WhatsApp template-health webhook fields
// (message_template_status_update / template_category_update /
// template_correct_category_detection / message_template_quality_update).
// whatsapp-api-js does not type these (it only models "messages"/"calls"), so
// they're validated here against the live-doc-verified Meta shapes
// (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks,
// checked 2026-08-27) before src/lib/data/template-health-processing.ts trusts
// any field off row.payload. `message_template_id` arrives as a JSON number
// but can exceed Number.MAX_SAFE_INTEGER on Meta's side — coerced to string
// immediately so nothing does numeric math on it.
const templateIdField = z.union([z.string(), z.number()]).transform(String);

export const templateStatusUpdateSchema = z.object({
  event: z.string(),
  message_template_id: templateIdField,
  message_template_name: z.string(),
  message_template_language: z.string(),
  reason: z.string().optional(),
  message_template_category: z.string().optional(),
  disable_info: z.object({ disable_date: z.string().optional() }).optional(),
  rejection_info: z
    .object({ reason: z.string().optional(), recommendation: z.string().optional() })
    .optional(),
});
export type TemplateStatusUpdatePayload = z.infer<typeof templateStatusUpdateSchema>;

export const templateCategoryUpdateSchema = z.object({
  message_template_id: templateIdField,
  message_template_name: z.string(),
  message_template_language: z.string(),
  new_category: z.string().optional(),
  correct_category: z.string().optional(),
  previous_category: z.string().optional(),
  // Unix seconds when Meta will apply an impending downgrade; absent = the
  // change already happened (this IS the completed-change payload).
  category_update_timestamp: z.number().optional(),
});
export type TemplateCategoryUpdatePayload = z.infer<typeof templateCategoryUpdateSchema>;

export const templateCategoryMisuseSchema = z.object({
  message_template_id: templateIdField,
  message_template_name: z.string(),
  message_template_language: z.string(),
  category: z.string(),
  correct_category: z.string(),
});
export type TemplateCategoryMisusePayload = z.infer<typeof templateCategoryMisuseSchema>;

export const templateQualityUpdateSchema = z.object({
  message_template_id: templateIdField,
  message_template_name: z.string(),
  message_template_language: z.string(),
  previous_quality_score: z.string().optional(),
  new_quality_score: z.string(),
});
export type TemplateQualityUpdatePayload = z.infer<typeof templateQualityUpdateSchema>;
