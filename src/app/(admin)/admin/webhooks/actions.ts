'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';

const reprocessSchema = z.object({ id: z.uuid() });

// Admin-only: re-queue a webhook_inbox row for the worker. Clears the terminal
// markers (processed_at / last_error) and resets the retry budget so the
// claim_webhook_events RPC (processed_at IS NULL AND attempts < 5) picks it up
// again on the next drain. Safe to run on an already-processed row — the worker
// is idempotent and the DB UNIQUE(channel, provider_id) prevents double-billing.
export async function reprocessWebhookEventAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  const parsed = reprocessSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) {
    throw new Error('מזהה אירוע לא תקין');
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('webhook_inbox')
    .update({ processed_at: null, last_error: null, attempts: 0 })
    .eq('id', parsed.data.id);
  if (error) {
    throw new Error('עיבוד מחדש של האירוע נכשל');
  }

  // Best-effort audit (non-PII: the webhook id only).
  await logActivity({
    action: 'webhook.reprocess',
    meta: { webhookId: parsed.data.id },
  });

  revalidatePath('/admin/webhooks');
}
