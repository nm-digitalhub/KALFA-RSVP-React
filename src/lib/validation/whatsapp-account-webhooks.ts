import { z } from 'zod';

// Payload shapes for the WhatsApp Business Account webhook fields that describe
// the ACCOUNT and its phone number, not a message or a template
// (account_review_update / account_update / phone_number_quality_update).
// None of them is in Meta's published OpenAPI specs (checked 2026-09-30:
// incoming-webhook, message-templates and whatsapp-business-account), so they
// are validated here against the webhook reference pages
// (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/<field>,
// read 2026-09-30). Values stay open strings: Meta adds events and states
// (ACCOUNT_OFFBOARDED / ACCOUNT_RECONNECTED were added this year), and a value
// we do not know yet must still be recorded and reported, not rejected.
//
// `entry_waba_id` is not Meta's: the route copies entry.id (the WABA the change
// is about) onto the stored row under that name, because the value itself does
// not carry it (account_review_update is `{ decision }` and nothing else).

const entryWabaId = z.string().optional();

export const accountReviewUpdateSchema = z.object({
  decision: z.string(),
  entry_waba_id: entryWabaId,
});
export type AccountReviewUpdatePayload = z.infer<typeof accountReviewUpdateSchema>;

export const accountUpdateSchema = z.object({
  event: z.string(),
  entry_waba_id: entryWabaId,
  ban_info: z
    .object({ waba_ban_state: z.string().optional(), waba_ban_date: z.string().optional() })
    .optional(),
  violation_info: z.object({ violation_type: z.string().optional() }).optional(),
  restriction_info: z
    .array(
      z.object({
        restriction_type: z.string().optional(),
        expiration: z.number().optional(),
        remediation: z.string().optional(),
      }),
    )
    .optional(),
});
export type AccountUpdatePayload = z.infer<typeof accountUpdateSchema>;

export const phoneNumberQualityUpdateSchema = z.object({
  event: z.string(),
  entry_waba_id: entryWabaId,
  display_phone_number: z.string().optional(),
  // The current field. current_limit / old_limit were announced for removal in
  // February 2026 and are read only as a fallback.
  max_daily_conversations_per_business: z.string().optional(),
  current_limit: z.string().optional(),
  old_limit: z.string().optional(),
});
export type PhoneNumberQualityUpdatePayload = z.infer<typeof phoneNumberQualityUpdateSchema>;
