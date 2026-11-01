'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformAction } from '@/lib/auth/platform-ability';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';

const reprocessSchema = z.object({ id: z.uuid({ error: 'מזהה אירוע לא תקין' }) });

// Admin-only: re-queue a webhook_inbox row for the worker. Clears the terminal
// markers (processed_at / last_error) and resets the retry budget so the
// claim_webhook_events RPC (processed_at IS NULL AND attempts < 5) picks it up
// again on the next drain. Safe to run on an already-processed row — the worker
// is idempotent and the DB UNIQUE(channel, provider_id) prevents double-billing.
export const reprocessWebhookEventAction = actionClient
  // Webhook.replay (src/lib/casl.ts), NOT WebhookInbox.read. Reprocessing
  // re-runs the pipeline's side effects — RSVP writes and billing among them —
  // so a VIEW permission is the wrong shape for it. The gate runs before the id
  // is validated (use() runs before validation), as it always did.
  .use(async ({ next }) => {
    await requirePlatformAction('replay', 'Webhook');
    return next();
  })
  .inputSchema(zfd.formData(reprocessSchema))
  .action(async ({ parsedInput: { id } }) => {
    const admin = createAdminClient();
    const { error } = await admin
      .from('webhook_inbox')
      .update({ processed_at: null, last_error: null, attempts: 0 })
      .eq('id', id);
    if (error) {
      return returnUserError('עיבוד מחדש של האירוע נכשל');
    }

    // Best-effort audit (non-PII: the webhook id only).
    await logActivity({
      action: 'webhook.reprocess',
      meta: { webhookId: id },
    });

    revalidatePath('/admin/webhooks');
  });
