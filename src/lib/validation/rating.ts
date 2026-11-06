import type { TFunction } from 'i18next';
import { z } from 'zod';

// Public CSAT submission (/rate/[token]). Score is a closed 1-3 scale
// (unhappy/neutral/happy — see inquiry-rating.ts); comment is optional and
// capped well below sendInquiryReplySchema's 4000 (a customer's optional
// aside, not a staff-authored reply). Built with the caller's `t`, so the
// messages follow the language of the request (see inquiries.ts).
export function submitRatingSchema(t: TFunction<'public'>) {
  return z.object({
    score: z.coerce
      .number()
      .int()
      .refine((n): n is 1 | 2 | 3 => n === 1 || n === 2 || n === 3, {
        error: () => t('validation.rating.score.invalid', 'דירוג לא תקין'),
      }),
    comment: z
      .string()
      .trim()
      .max(500, { error: () => t('validation.note.tooLong', 'ההערה ארוכה מדי') })
      .optional()
      .or(z.literal('')),
  });
}
export type SubmitRatingInput = z.infer<ReturnType<typeof submitRatingSchema>>;
