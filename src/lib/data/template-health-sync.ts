import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import {
  fetchTemplateHealth,
  isCategoryDowngraded,
  type MetaTemplate,
} from '@/lib/whatsapp/template-health';
import type { Json, TablesInsert } from '@/lib/supabase/types';
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
// Meta template → whatsapp_message_templates row. The columns ARE Meta's
// keys, so this is a straight copy; a template without id/name/language
// cannot be keyed and is left out.
export function toMirrorRow(
  t: MetaTemplate,
  syncedAt: string,
): TablesInsert<'whatsapp_message_templates'> | null {
  // Meta ids are numeric strings; anything else is refused (it is also
  // interpolated into the PostgREST `not.in` filter below).
  if (!t.id || !/^\d+$/.test(t.id) || !t.name || !t.language) return null;
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    status: t.status ?? null,
    category: t.category ?? null,
    sub_category: t.sub_category ?? null,
    components: (t.components ?? null) as Json,
    parameter_format: t.parameter_format ?? null,
    quality_score: (t.quality_score ?? null) as Json,
    rejected_reason: t.rejected_reason ?? null,
    correct_category: t.correct_category ?? null,
    previous_category: t.previous_category ?? null,
    message_send_ttl_seconds: t.message_send_ttl_seconds ?? null,
    library_template_name: t.library_template_name ?? null,
    disable_ios_autofill: t.disable_ios_autofill ?? null,
    is_primary_device_delivery_only: t.is_primary_device_delivery_only ?? null,
    synced_at: syncedAt,
  };
}

// Mirror EVERY template on the WABA (not only the ones a step uses) into
// whatsapp_message_templates, in two writes:
//   1. A mirrored template Meta no longer returns was deleted there → marked
//      status 'DELETED' (kept, not removed: routes/params reference it with ON
//      DELETE RESTRICT). This must run FIRST: a template re-created under the
//      same name + language has a NEW id, and the unique index on (name,
//      language) covers only non-DELETED rows.
//   2. Upsert of everything Meta returned, by Meta's id.
// An empty list from Meta is never read as "everything was deleted".
// Never throws — a failed write alerts and leaves the health sync below
// unaffected.
async function mirrorTemplates(
  admin: ReturnType<typeof createAdminClient>,
  templates: MetaTemplate[],
  syncedAt: string,
): Promise<number> {
  const rows = templates
    .map((t) => toMirrorRow(t, syncedAt))
    .filter((r): r is TablesInsert<'whatsapp_message_templates'> => r !== null);
  if (rows.length === 0) return 0;

  const fail = async (step: string, code: string | undefined) => {
    await sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'whatsapp-template-health-sync',
      title: 'שמירת תבניות WhatsApp מ-Meta נכשלה',
      detail: `${step}: ${code ?? 'שגיאה לא ידועה'}`,
    });
    return 0;
  };

  const liveIds = rows.map((r) => r.id);
  const { error: goneError } = await admin
    .from('whatsapp_message_templates')
    .update({ status: 'DELETED', synced_at: syncedAt })
    .not('id', 'in', `(${liveIds.join(',')})`)
    .or('status.is.null,status.neq.DELETED');
  if (goneError) return fail('mark_deleted', goneError.code);

  const { error } = await admin
    .from('whatsapp_message_templates')
    .upsert(rows, { onConflict: 'id' });
  if (error) return fail('upsert', error.code);
  return rows.length;
}

type WatchedTemplate = {
  id: string;
  name: string;
  requested: string;
  previousCategory: string | null;
  messageKeys: string[];
};

// Every template some step sends, with the category it was requested under and
// the category stored before this sync.
async function loadWatchedTemplates(
  admin: ReturnType<typeof createAdminClient>,
): Promise<WatchedTemplate[]> {
  const { data, error } = await admin
    .from('whatsapp_template_settings')
    .select(
      'whatsapp_template_id, requested_category, whatsapp_message_templates(name, category, message_template_routes(message_key))',
    );
  if (error || !data) return [];
  const out: WatchedTemplate[] = [];
  for (const row of data) {
    const t = row.whatsapp_message_templates as {
      name: string;
      category: string | null;
      message_template_routes: Array<{ message_key: string }> | null;
    } | null;
    if (!t || !row.requested_category) continue;
    out.push({
      id: row.whatsapp_template_id,
      name: t.name,
      requested: row.requested_category,
      previousCategory: t.category,
      messageKeys: [...new Set((t.message_template_routes ?? []).map((r) => r.message_key))],
    });
  }
  return out;
}

// Alert once per genuine transition into a downgrade (was not, now is).
async function alertNewDowngrades(
  watched: WatchedTemplate[],
  metaTemplates: MetaTemplate[],
): Promise<number> {
  let count = 0;
  for (const w of watched) {
    const live = metaTemplates.find((t) => t.id === w.id);
    if (!live) continue;
    const was = isCategoryDowngraded(w.requested, w.previousCategory);
    const now = isCategoryDowngraded(w.requested, live.category ?? null);
    if (was || !now) continue;
    count += 1;
    const label = w.messageKeys.join(', ') || w.name;
    await sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-template-health-sync',
      title: `תבנית WhatsApp ירדה בקטגוריה (התגלה בסנכרון יומי): ${label}`,
      detail: `Meta מסווגת כעת כ-${live.category} במקום ${w.requested} — לא התקבל webhook על השינוי הזה.`,
      fields: {
        message_key: label,
        template_name: w.name,
        requested: w.requested,
        actual: live.category ?? 'לא ידוע',
      },
    });
  }
  return count;
}

export async function runTemplateHealthSync(): Promise<{
  synced: number;
  skipped: number;
  newDowngrades: number;
  mirrored: number;
}> {
  const config = await getWhatsAppConfig();
  if (!config?.wabaId) return { synced: 0, skipped: 0, newDowngrades: 0, mirrored: 0 };

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from('message_templates')
    .select('id, name, language, requested_category, category, message_key')
    .eq('channel', 'whatsapp')
    .neq('name', '');
  if (error || !rows || rows.length === 0) return { synced: 0, skipped: 0, newDowngrades: 0, mirrored: 0 };

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
    return { synced: 0, skipped: rows.length, newDowngrades: 0, mirrored: 0 };
  }

  const now = new Date().toISOString();
  // Category as stored BEFORE this sync, for every template a step sends — so a
  // downgrade is alerted once, on the transition, for the event-type / image
  // variants too, not only a step's base template.
  const watched = await loadWatchedTemplates(admin);
  const mirrored = await mirrorTemplates(admin, metaTemplates, now);
  const newDowngrades = await alertNewDowngrades(watched, metaTemplates);

  let synced = 0;
  let skipped = 0;

  for (const row of rows) {
    const match = metaTemplates.find(
      (t) => t.name === row.name && t.language === row.language,
    );
    if (!match) {
      skipped += 1;
      continue;
    }

    // Legacy row, kept current for the admin screen until it reads the mirror.
    // Downgrade alerts come from alertNewDowngrades above.
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

  }

  return { synced, skipped, newDowngrades, mirrored };
}
