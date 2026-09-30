import 'server-only';

import type { Tables, TablesUpdate } from '@/lib/supabase/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  templateStatusUpdateSchema,
  templateCategoryUpdateSchema,
  templateCategoryMisuseSchema,
  templateQualityUpdateSchema,
} from '@/lib/validation/whatsapp-template-health';

type WebhookInboxRow = Tables<'webhook_inbox'>;

// Applies the 4 template-health webhook events (see route.ts's
// normalizeTemplateHealthRows) to the Meta mirror (whatsapp_message_templates,
// by Meta's template id — every template, since 2026-09-30) and, until the
// admin screen reads the mirror, also to the legacy message_templates row. The
// legacy half below: Matched by
// (name, language) — Meta's payload never carries our internal message_key.
// A row with no match (a template not tracked in our admin config, or a
// name/language mismatch) is a silent no-op: nothing to update, and alerting
// on an untracked template would be noise, not signal.
//
// isCategoryDowngraded lives in src/lib/whatsapp/template-health.ts (shared
// with the reconciliation poll) so both paths agree on what "downgraded"
// means.
import { isCategoryDowngraded } from '@/lib/whatsapp/template-health';

async function findTemplateRowId(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  language: string,
): Promise<{ id: string; requested_category: string; message_key: string } | null> {
  const { data } = await admin
    .from('message_templates')
    .select('id, requested_category, message_key')
    .eq('name', name)
    .eq('language', language)
    .maybeSingle();
  return data ?? null;
}

// The Meta mirror row this webhook is about (by Meta's template id), with
// whether any step sends it (message_template_routes) and the category it was
// requested under (whatsapp_template_settings). Since 2026-09-30 every routed
// template is watched — the event-type and image variants included, not only a
// step's base template (which is all findTemplateRowId can see).
type MirrorTarget = { id: string; requestedCategory: string | null; messageKeys: string[] };
async function findMirrorTemplate(
  admin: ReturnType<typeof createAdminClient>,
  templateId: string,
): Promise<MirrorTarget | null> {
  const { data } = await admin
    .from('whatsapp_message_templates')
    .select('id, whatsapp_template_settings(requested_category), message_template_routes(message_key)')
    .eq('id', templateId)
    .maybeSingle();
  if (!data) return null;
  const settings = data.whatsapp_template_settings as
    | { requested_category: string | null }
    | Array<{ requested_category: string | null }>
    | null;
  const requested = Array.isArray(settings) ? settings[0]?.requested_category : settings?.requested_category;
  const routes = (data.message_template_routes ?? []) as Array<{ message_key: string }>;
  return {
    id: data.id,
    requestedCategory: requested ?? null,
    messageKeys: [...new Set(routes.map((r) => r.message_key))],
  };
}

async function updateMirror(
  admin: ReturnType<typeof createAdminClient>,
  target: MirrorTarget | null,
  patch: TablesUpdate<'whatsapp_message_templates'>,
): Promise<void> {
  if (!target) return;
  await admin
    .from('whatsapp_message_templates')
    .update({ ...patch, synced_at: new Date().toISOString() })
    .eq('id', target.id);
}

// What an alert names: the step(s) sending the template, else the legacy row's.
function alertLabel(target: MirrorTarget | null, legacy: { message_key: string } | null): string | null {
  if (target && target.messageKeys.length > 0) return target.messageKeys.join(', ');
  return legacy?.message_key ?? null;
}

export async function processTemplateStatusRow(row: WebhookInboxRow): Promise<void> {
  const parsed = templateStatusUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return; // malformed/unexpected payload — nothing to apply
  const v = parsed.data;
  const admin = createAdminClient();
  const target = await findMirrorTemplate(admin, v.message_template_id);
  const template = await findTemplateRowId(admin, v.message_template_name, v.message_template_language);
  const label = alertLabel(target, template);
  if (!label) return; // neither sent by any step nor a legacy base row — nothing to watch
  await updateMirror(admin, target, {
    status: v.event,
    rejected_reason: v.rejection_info?.reason ?? v.reason ?? null,
  });

  if (template) await admin
    .from('message_templates')
    .update({
      meta_template_id: v.message_template_id,
      meta_status: v.event,
      rejected_reason: v.rejection_info?.reason ?? v.reason ?? null,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', template.id);

  if (v.event === 'REJECTED' || v.event === 'DISABLED') {
    await sendSlackAlert({
      level: v.event === 'DISABLED' ? 'error' : 'warn',
      category: 'send_health',
      source: 'whatsapp-template-status',
      title:
        v.event === 'DISABLED'
          ? `תבנית WhatsApp הושבתה: ${label}`
          : `תבנית WhatsApp נדחתה: ${label}`,
      detail: v.rejection_info?.recommendation,
      fields: {
        message_key: label,
        template_name: v.message_template_name,
        reason: v.rejection_info?.reason ?? v.reason ?? 'לא צוין',
      },
    });
  }
}

export async function processTemplateCategoryRow(row: WebhookInboxRow): Promise<void> {
  const parsed = templateCategoryUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const admin = createAdminClient();
  const target = await findMirrorTemplate(admin, v.message_template_id);
  const template = await findTemplateRowId(admin, v.message_template_name, v.message_template_language);
  const label = alertLabel(target, template);
  if (!label) return; // neither sent by any step nor a legacy base row — nothing to watch
  const requested = target?.requestedCategory ?? template?.requested_category ?? null;
  await updateMirror(
    admin,
    target,
    v.category_update_timestamp != null
      ? { correct_category: v.correct_category ?? null }
      : {
          category: v.new_category ?? v.correct_category ?? null,
          ...(v.previous_category ? { previous_category: v.previous_category } : {}),
        },
  );

  const isImpending = v.category_update_timestamp != null;

  if (isImpending) {
    // Meta's ~24h advance warning — nothing has changed YET.
    if (template) await admin
      .from('message_templates')
      .update({
        meta_template_id: v.message_template_id,
        pending_category_change_at: new Date(v.category_update_timestamp! * 1000).toISOString(),
        pending_correct_category: v.correct_category ?? null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', template.id);

    await sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'whatsapp-template-category',
      title: `תבנית WhatsApp צפויה לרדת בקטגוריה בעוד כ-24 שעות: ${label}`,
      detail: `${v.new_category ?? '?'} → ${v.correct_category ?? '?'} בעוד 24 שעות. ניתן לתקן ולהגיש מחדש לפני שהשינוי נכנס לתוקף.`,
      fields: {
        message_key: label,
        template_name: v.message_template_name,
        from: v.new_category ?? 'לא צוין',
        to: v.correct_category ?? 'לא צוין',
      },
    });
    return;
  }

  // Completed change — the new category is live now.
  const newCategory = v.new_category ?? v.correct_category ?? null;
  if (template) await admin
    .from('message_templates')
    .update({
      meta_template_id: v.message_template_id,
      category: newCategory,
      pending_category_change_at: null,
      pending_correct_category: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', template.id);

  if (newCategory && requested && isCategoryDowngraded(requested, newCategory)) {
    await sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-template-category',
      title: `תבנית WhatsApp ירדה בקטגוריה: ${label}`,
      detail: `Meta סיווגה מחדש מ-${requested} ל-${newCategory} — עלות השליחה עשויה לעלות.`,
      fields: {
        message_key: label,
        template_name: v.message_template_name,
        requested: requested,
        actual: newCategory,
      },
    });
  }
}

export async function processTemplateCategoryMisuseRow(row: WebhookInboxRow): Promise<void> {
  const parsed = templateCategoryMisuseSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const admin = createAdminClient();
  const target = await findMirrorTemplate(admin, v.message_template_id);
  const template = await findTemplateRowId(admin, v.message_template_name, v.message_template_language);
  const label = alertLabel(target, template);
  if (!label) return; // neither sent by any step nor a legacy base row — nothing to watch
  await updateMirror(admin, target, { correct_category: v.correct_category });

  if (template) await admin
    .from('message_templates')
    .update({
      meta_template_id: v.message_template_id,
      // A misuse detection is Meta's live signal of the category it WILL
      // correct to; surfaced as "pending" (same fields template_category_update
      // uses for its impending warning) so the admin UI has one place to show it.
      pending_correct_category: v.correct_category,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', template.id);

  await sendSlackAlert({
    level: 'warn',
    category: 'send_health',
    source: 'whatsapp-template-category-misuse',
    title: `Meta זיהתה ניצול קטגוריה שגוי: ${label}`,
    detail: `מסווגת כ-${v.category}, Meta ממליצה על ${v.correct_category}.`,
    fields: {
      message_key: label,
      template_name: v.message_template_name,
      current: v.category,
      recommended: v.correct_category,
    },
  });
}

export async function processTemplateQualityRow(row: WebhookInboxRow): Promise<void> {
  const parsed = templateQualityUpdateSchema.safeParse(row.payload);
  if (!parsed.success) return;
  const v = parsed.data;
  const admin = createAdminClient();
  const target = await findMirrorTemplate(admin, v.message_template_id);
  const template = await findTemplateRowId(admin, v.message_template_name, v.message_template_language);
  const label = alertLabel(target, template);
  if (!label) return; // neither sent by any step nor a legacy base row — nothing to watch
  await updateMirror(admin, target, {
    quality_score: { score: v.new_quality_score, date: Math.floor(Date.now() / 1000) },
  });

  if (template) await admin
    .from('message_templates')
    .update({
      meta_template_id: v.message_template_id,
      quality_score: v.new_quality_score,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', template.id);

  // RED = Meta will start pausing sends on this template (error 132015).
  // Recovering FROM red is worth a (lower-severity) note too.
  if (v.new_quality_score === 'RED') {
    await sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-template-quality',
      title: `איכות תבנית WhatsApp ירדה ל-RED: ${label}`,
      detail: 'שליחות עם התבנית הזו עלולות להיחסם (שגיאה 132015) עד שהאיכות תשתפר.',
      fields: {
        message_key: label,
        template_name: v.message_template_name,
        previous: v.previous_quality_score ?? 'לא ידוע',
      },
    });
  } else if (v.previous_quality_score === 'RED' && v.new_quality_score !== 'RED') {
    await sendSlackAlert({
      level: 'info',
      category: 'send_health',
      source: 'whatsapp-template-quality',
      title: `איכות תבנית WhatsApp התאוששה: ${label}`,
      fields: { message_key: label, new_score: v.new_quality_score },
    });
  }
}
