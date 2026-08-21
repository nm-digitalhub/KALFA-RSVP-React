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
    resolutionNote: z.string().trim().min(5, 'נא לנסח הודעה ללקוח').max(4000),
  })
  .refine((v) => (v.resolution === 'partial_charge' ? v.resolutionAmount !== undefined : true), {
    message: 'יש להזין סכום עבור חיוב חלקי',
    path: ['resolutionAmount'],
  })
  .refine((v) => (v.resolution !== 'partial_charge' ? v.resolutionAmount === undefined : true), {
    message: 'סכום רלוונטי רק לחיוב חלקי',
    path: ['resolutionAmount'],
  });
