import { z } from 'zod';

export const createCancellationRequestSchema = z.object({
  reason: z.string().trim().min(5, 'נא לפרט את סיבת הביטול').max(2000),
  smsConsent: z.boolean().default(false),
});

export const RESOLUTION_VALUES = ['full_cancellation', 'partial_charge', 'declined'] as const;

export const resolveCancellationRequestSchema = z
  .object({
    resolution: z.enum(RESOLUTION_VALUES),
    resolutionAmount: z.coerce.number().positive().optional(),
    // The fee as a PERCENTAGE instead of an amount (partial_charge only). The server turns it into an amount from a base
    // it determines itself (resolveCancellationRequest) — the browser never submits a computed amount in this mode.
    resolutionPercent: z.coerce
      .number()
      .gt(0, 'האחוז חייב להיות גדול מ-0')
      .max(100, 'האחוז לא יכול לעלות על 100')
      .optional(),
    resolutionNote: z.string().trim().min(5, 'נא לנסח הודעה ללקוח').max(4000),
  })
  .refine(
    (v) => (v.resolution === 'partial_charge' ? v.resolutionAmount !== undefined || v.resolutionPercent !== undefined : true),
    { message: 'יש להזין סכום או אחוז עבור חיוב חלקי', path: ['resolutionAmount'] },
  )
  .refine((v) => !(v.resolutionAmount !== undefined && v.resolutionPercent !== undefined), {
    message: 'יש להזין סכום או אחוז, לא את שניהם',
    path: ['resolutionPercent'],
  })
  .refine((v) => (v.resolution !== 'partial_charge' ? v.resolutionAmount === undefined : true), {
    message: 'סכום רלוונטי רק לחיוב חלקי',
    path: ['resolutionAmount'],
  })
  .refine((v) => (v.resolution !== 'partial_charge' ? v.resolutionPercent === undefined : true), {
    message: 'אחוז רלוונטי רק לחיוב חלקי',
    path: ['resolutionPercent'],
  });
