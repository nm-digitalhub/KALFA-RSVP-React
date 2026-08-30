import { z } from 'zod';

// Public CSAT submission (/rate/[token]). Score is a closed 1-3 scale
// (unhappy/neutral/happy — see inquiry-rating.ts); comment is optional and
// capped well below sendInquiryReplySchema's 4000 (a customer's optional
// aside, not a staff-authored reply).
export const submitRatingSchema = z.object({
  score: z.coerce
    .number()
    .int()
    .refine((n): n is 1 | 2 | 3 => n === 1 || n === 2 || n === 3, {
      error: 'דירוג לא תקין',
    }),
  comment: z
    .string()
    .trim()
    .max(500, { error: 'ההערה ארוכה מדי' })
    .optional()
    .or(z.literal('')),
});
export type SubmitRatingInput = z.infer<typeof submitRatingSchema>;
