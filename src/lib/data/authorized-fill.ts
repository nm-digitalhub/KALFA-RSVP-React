import 'server-only';

import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';

// The first fill of a quota campaign's authorized list (SQL: fill_authorized_set). Service-role and request-free: the
// caller has already authorized the campaign. Request-free so the worker can import it too.

const count = z.number().int().nonnegative();

const fillResultSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('filled'), admitted: count, size: count, quota: count, waiting: count }),
  z.object({ verdict: z.literal('no_campaign') }),
  z.object({ verdict: z.literal('event_mismatch') }),
  z.object({ verdict: z.literal('not_operational') }),
  z.object({ verdict: z.literal('no_quota') }),
]);

export type FillResult = z.infer<typeof fillResultSchema>;

export async function fillAuthorizedSet(eventId: string, campaignId: string, actor: string): Promise<FillResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('fill_authorized_set', {
    p_event: eventId,
    p_campaign: campaignId,
    p_actor: actor,
  });
  if (error) throw new Error('מילוי רשימת אנשי הקשר נכשל');
  const parsed = fillResultSchema.safeParse(data);
  if (!parsed.success) throw new Error('מילוי רשימת אנשי הקשר החזיר תשובה לא מוכרת');
  return parsed.data;
}
