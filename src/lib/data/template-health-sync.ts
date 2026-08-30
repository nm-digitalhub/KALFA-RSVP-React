import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { fetchTemplateHealth, isCategoryDowngraded } from '@/lib/whatsapp/template-health';
import { sendSlackAlert } from '@/lib/alerts/slack';

// Daily reconciliation sweep (worker/main.ts, QUEUES.templateHealthSync) — the
// safety net for the webhook path in template-health-processing.ts: it can
// only see a template's CURRENT state (no "impending" 24h warning — that
// exists only as a webhook), but it needs no Meta App webhook-subscription
// config to work at all, and it doubles as the one-time backfill for
// templates that predate this feature (category/quality_score/meta_status
// start out null until the first successful sync).
//
// Only fires an alert on a genuine TRANSITION into a downgraded/red state
// (comparing the freshly-fetched value against what was already stored),
// never on every daily run for an already-known problem — the webhook path
// already alerted once when it happened; this sweep's job is to not miss one.
export async function runTemplateHealthSync(): Promise<{
  synced: number;
  skipped: number;
  newDowngrades: number;
}> {
  const config = await getWhatsAppConfig();
  if (!config?.wabaId) return { synced: 0, skipped: 0, newDowngrades: 0 };

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from('message_templates')
    .select('id, name, language, requested_category, category, message_key')
    .eq('channel', 'whatsapp')
    .neq('name', '');
  if (error || !rows || rows.length === 0) return { synced: 0, skipped: 0, newDowngrades: 0 };

  let metaTemplates: Awaited<ReturnType<typeof fetchTemplateHealth>>;
  try {
    metaTemplates = await fetchTemplateHealth({
      wabaId: config.wabaId,
      accessToken: config.accessToken,
    });
  } catch (err) {
    await sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'whatsapp-template-health-sync',
      title: 'סנכרון בריאות תבניות WhatsApp נכשל',
      detail: err instanceof Error ? err.message : 'שגיאה לא ידועה',
    });
    return { synced: 0, skipped: rows.length, newDowngrades: 0 };
  }

  let synced = 0;
  let skipped = 0;
  let newDowngrades = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const match = metaTemplates.find(
      (t) => t.name === row.name && t.language === row.language,
    );
    if (!match) {
      skipped += 1;
      continue;
    }

    const wasDowngraded = isCategoryDowngraded(row.requested_category, row.category);
    const isNowDowngraded = isCategoryDowngraded(
      row.requested_category,
      match.category ?? null,
    );

    await admin
      .from('message_templates')
      .update({
        meta_template_id: match.id,
        category: match.category ?? null,
        quality_score: match.quality_score?.score ?? null,
        meta_status: match.status ?? null,
        rejected_reason: match.rejected_reason ?? null,
        last_synced_at: now,
      })
      .eq('id', row.id);
    synced += 1;

    if (!wasDowngraded && isNowDowngraded) {
      newDowngrades += 1;
      await sendSlackAlert({
        level: 'error',
        category: 'send_health',
        source: 'whatsapp-template-health-sync',
        title: `תבנית WhatsApp ירדה בקטגוריה (התגלה בסנכרון יומי): ${row.message_key}`,
        detail: `Meta מסווגת כעת כ-${match.category} במקום ${row.requested_category} — לא התקבל webhook על השינוי הזה.`,
        fields: {
          message_key: row.message_key,
          template_name: row.name,
          requested: row.requested_category,
          actual: match.category ?? 'לא ידוע',
        },
      });
    }
  }

  return { synced, skipped, newDowngrades };
}
