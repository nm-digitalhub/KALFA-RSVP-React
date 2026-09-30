import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { QUEUES } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums, Json } from '@/lib/supabase/types';
import {
  anySendValuePaths,
  carriesRsvpQuickReplies,
  parameterCoverageProblems,
  sendValuePaths,
  templateSlots,
  type TemplateSlot,
} from '@/lib/whatsapp/template-route';

// Admin surface of the WhatsApp template model (step 8 of
// docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md): which
// Meta template each step sends (message_template_routes) and what fills each
// of its variables (whatsapp_template_parameters).
//
// These tables are revoked from `authenticated`, so they are read and written
// with the service-role client, strictly AFTER requirePlatformPermission.
// Every write changes what guests receive, so each one:
//   - re-proves the invariant the backfill proved once (APPROVED template,
//     every variable mapped exactly once to a value the step has);
//   - is recorded with logActivity (ids and paths only, no personal data).

type EventType = Enums<'event_type'>;

export type AdminTemplateParameter = TemplateSlot & { source_path: string | null };

export type AdminMetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string | null;
  category: string | null;
  components: Json | null;
  requestedCategory: string | null;
  rsvpQuickReplies: boolean;
  // One entry per variable the template has, with its current value (null =
  // not mapped yet), plus what the sender cannot fill.
  parameters: AdminTemplateParameter[];
  unsupported: string[];
};

export type AdminStepRoute = { eventType: EventType | null; withMedia: boolean; templateId: string };

export type AdminWhatsAppStep = {
  messageKey: string;
  label: string;
  active: boolean;
  // What a variable of a template sent by this step may be mapped to.
  valuePaths: string[];
  routes: AdminStepRoute[];
};

export type WhatsAppTemplateAdmin = {
  steps: AdminWhatsAppStep[];
  templates: AdminMetaTemplate[];
  lastSyncedAt: string | null;
};

type ParamRow = {
  id: string;
  type: string;
  sub_type: string | null;
  index: number | null;
  position: number | null;
  source_path: string;
};

const slotKey = (s: { type: string; sub_type: string | null; index: number | null; position: number | null }) =>
  `${s.type}|${s.sub_type ?? ''}|${s.index ?? ''}|${s.position ?? ''}`;

export async function loadWhatsAppTemplateAdmin(): Promise<WhatsAppTemplateAdmin> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const [stepsRes, templatesRes] = await Promise.all([
    admin
      .from('message_templates')
      .select('message_key, label, active, message_template_routes(event_type, with_media, whatsapp_template_id)')
      .eq('channel', 'whatsapp')
      .order('message_key'),
    admin
      .from('whatsapp_message_templates')
      .select(
        'id, name, language, status, category, components, synced_at, whatsapp_template_settings(requested_category), whatsapp_template_parameters(id, type, sub_type, index, position, source_path), message_template_routes(id)',
      )
      .order('name'),
  ]);
  if (stepsRes.error || templatesRes.error) throw new Error('טעינת התבניות נכשלה');

  const steps: AdminWhatsAppStep[] = (stepsRes.data ?? []).map((s) => ({
    messageKey: s.message_key,
    label: s.label ?? s.message_key,
    active: s.active,
    valuePaths: sendValuePaths(s.message_key),
    routes: (s.message_template_routes ?? []).map((r) => ({
      eventType: r.event_type,
      withMedia: r.with_media,
      templateId: r.whatsapp_template_id,
    })),
  }));

  let lastSyncedAt: string | null = null;
  const templates: AdminMetaTemplate[] = [];
  for (const t of templatesRes.data ?? []) {
    const routed = (t.message_template_routes ?? []).length > 0;
    // A template deleted in Meta is shown only while a step still points at it.
    if (t.status === 'DELETED' && !routed) continue;
    if (!lastSyncedAt || t.synced_at > lastSyncedAt) lastSyncedAt = t.synced_at;
    const settings = t.whatsapp_template_settings as
      | { requested_category: string | null }
      | Array<{ requested_category: string | null }>
      | null;
    const requested = Array.isArray(settings) ? settings[0]?.requested_category : settings?.requested_category;
    const rows = new Map((t.whatsapp_template_parameters ?? []).map((p) => [slotKey(p), p.source_path]));
    const { slots, unsupported } = templateSlots(t.components);
    templates.push({
      id: t.id,
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      components: t.components,
      requestedCategory: requested ?? null,
      rsvpQuickReplies: carriesRsvpQuickReplies(t.components),
      parameters: slots.map((s) => ({ ...s, source_path: rows.get(slotKey(s)) ?? null })),
      unsupported,
    });
  }
  return { steps, templates, lastSyncedAt };
}

export type AdminWriteResult = { ok: true; warning?: string } | { ok: false; problems: string[] };

async function loadTemplateForWrite(admin: ReturnType<typeof createAdminClient>, templateId: string) {
  const { data, error } = await admin
    .from('whatsapp_message_templates')
    .select('id, name, status, category, components, whatsapp_template_parameters(id, type, sub_type, index, position, source_path)')
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw new Error('טעינת התבנית נכשלה');
  return data;
}

/**
 * Point one route of a step (default or one event type, text or with the
 * invite image) at a Meta template.
 */
export async function setTemplateRoute(input: {
  messageKey: string;
  eventType: EventType | null;
  withMedia: boolean;
  templateId: string;
}): Promise<AdminWriteResult> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();

  const { data: step, error: stepError } = await admin
    .from('message_templates')
    .select('message_key, channel')
    .eq('message_key', input.messageKey)
    .maybeSingle();
  if (stepError) throw new Error('טעינת השלב נכשלה');
  if (!step || step.channel !== 'whatsapp') return { ok: false, problems: ['השלב לא נמצא או שאינו שלב WhatsApp'] };

  const template = await loadTemplateForWrite(admin, input.templateId);
  if (!template) return { ok: false, problems: ['התבנית לא נמצאה. סנכרנו מול Meta ונסו שוב.'] };

  const problems: string[] = [];
  if (template.status !== 'APPROVED') problems.push('אפשר לבחור רק תבנית שמאושרת ב-Meta');
  const hasImageHeader = templateSlots(template.components).slots.some((s) => s.type === 'header');
  if (input.withMedia && !hasImageHeader) problems.push('למסלול עם תמונה צריך תבנית שיש לה תמונה בכותרת');
  if (!input.withMedia && hasImageHeader) problems.push('תבנית עם תמונה בכותרת מתאימה רק למסלול עם תמונה');
  problems.push(
    ...parameterCoverageProblems(
      template.components,
      template.whatsapp_template_parameters ?? [],
      sendValuePaths(input.messageKey),
    ),
  );
  if (problems.length > 0) return { ok: false, problems };

  let existingQuery = admin
    .from('message_template_routes')
    .select('id, whatsapp_template_id, whatsapp_message_templates(components)')
    .eq('message_key', input.messageKey)
    .eq('with_media', input.withMedia);
  existingQuery = input.eventType === null ? existingQuery.is('event_type', null) : existingQuery.eq('event_type', input.eventType);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw new Error('טעינת המסלול נכשלה');
  if (existing?.whatsapp_template_id === input.templateId) return { ok: true };

  const write = existing
    ? admin.from('message_template_routes').update({ whatsapp_template_id: input.templateId }).eq('id', existing.id)
    : admin.from('message_template_routes').insert({
        message_key: input.messageKey,
        event_type: input.eventType,
        with_media: input.withMedia,
        whatsapp_template_id: input.templateId,
      });
  const { error: writeError } = await write;
  if (writeError) throw new Error('שמירת המסלול נכשלה');

  // A template first used here gets its settings row, so the category-downgrade
  // alert (template-health) watches it too. Requested = what Meta approved now.
  const { error: settingsError } = await admin
    .from('whatsapp_template_settings')
    .upsert(
      { whatsapp_template_id: input.templateId, requested_category: template.category },
      { onConflict: 'whatsapp_template_id', ignoreDuplicates: true },
    );
  if (settingsError) throw new Error('שמירת הגדרות התבנית נכשלה');

  await logActivity({
    action: 'admin.templates.route_set',
    meta: {
      message_key: input.messageKey,
      event_type: input.eventType,
      with_media: input.withMedia,
      from_template_id: existing?.whatsapp_template_id ?? null,
      to_template_id: input.templateId,
    },
  });

  const before = existing
    ? carriesRsvpQuickReplies(
        (existing.whatsapp_message_templates as { components: Json | null } | null)?.components ?? null,
      )
    : null;
  const after = carriesRsvpQuickReplies(template.components);
  if (before === true && !after) {
    return {
      ok: true,
      warning: 'לתבנית החדשה אין את שלושת כפתורי אישור ההגעה. לחיצה של אורח לא תירשם עוד כתשובה.',
    };
  }
  return { ok: true };
}

/**
 * Remove an event-type or image route. The step's default text route cannot be
 * removed: without it the step has nothing to send.
 */
export async function removeTemplateRoute(input: {
  messageKey: string;
  eventType: EventType | null;
  withMedia: boolean;
}): Promise<AdminWriteResult> {
  await requirePlatformPermission('manage_settings');
  if (input.eventType === null && !input.withMedia) {
    return { ok: false, problems: ['אי אפשר להסיר את מסלול ברירת המחדל של השלב'] };
  }
  const admin = createAdminClient();
  let query = admin
    .from('message_template_routes')
    .delete()
    .eq('message_key', input.messageKey)
    .eq('with_media', input.withMedia);
  query = input.eventType === null ? query.is('event_type', null) : query.eq('event_type', input.eventType);
  const { data, error } = await query.select('whatsapp_template_id');
  if (error) throw new Error('הסרת המסלול נכשלה');
  if (!data || data.length === 0) return { ok: false, problems: ['המסלול לא נמצא'] };

  await logActivity({
    action: 'admin.templates.route_removed',
    meta: {
      message_key: input.messageKey,
      event_type: input.eventType,
      with_media: input.withMedia,
      from_template_id: data[0].whatsapp_template_id,
    },
  });
  return { ok: true };
}

/**
 * Set what fills each variable of a Meta template. The mapping must cover every
 * variable exactly once, and — for every step that already sends the template —
 * only with values that step has.
 */
export async function saveTemplateParameters(input: {
  templateId: string;
  values: Array<{ type: string; sub_type: string | null; index: number | null; position: number; source_path: string }>;
}): Promise<AdminWriteResult> {
  await requirePlatformPermission('manage_settings');
  const admin = createAdminClient();
  const template = await loadTemplateForWrite(admin, input.templateId);
  if (!template) return { ok: false, problems: ['התבנית לא נמצאה. סנכרנו מול Meta ונסו שוב.'] };

  const { data: routes, error: routesError } = await admin
    .from('message_template_routes')
    .select('message_key')
    .eq('whatsapp_template_id', input.templateId);
  if (routesError) throw new Error('טעינת המסלולים נכשלה');
  const keys = [...new Set((routes ?? []).map((r) => r.message_key))];
  // Not routed yet: any value a step can have (setTemplateRoute re-checks
  // against the step it is routed to).
  const allowed = keys.length > 0
    ? keys.map(sendValuePaths).reduce((a, b) => a.filter((p) => b.includes(p)))
    : anySendValuePaths();
  const problems = parameterCoverageProblems(template.components, input.values, allowed);
  if (problems.length > 0) return { ok: false, problems };

  const current = new Map(((template.whatsapp_template_parameters ?? []) as ParamRow[]).map((p) => [slotKey(p), p]));
  const changed = input.values
    .filter((v) => current.get(slotKey(v))?.source_path !== v.source_path)
    .map((v) => ({ slot: slotKey(v), from: current.get(slotKey(v))?.source_path ?? null, to: v.source_path }));
  const wanted = new Set(input.values.map(slotKey));
  const stale = [...current.values()].filter((p) => !wanted.has(slotKey(p)));
  if (changed.length === 0 && stale.length === 0) return { ok: true };

  // One statement for the whole mapping, so a failure leaves it as it was —
  // never half old, half new. Conflict target = the table's unique key
  // (whatsapp_template_parameters_key, NULLS NOT DISTINCT).
  const { error: upsertError } = await admin.from('whatsapp_template_parameters').upsert(
    input.values.map((v) => ({
      whatsapp_template_id: input.templateId,
      type: v.type,
      sub_type: v.sub_type,
      index: v.index,
      position: v.position,
      parameter_name: null,
      source_path: v.source_path,
    })),
    { onConflict: 'whatsapp_template_id,type,index,position,parameter_name' },
  );
  if (upsertError) throw new Error('שמירת המשתנים נכשלה');
  // Rows for variables the template no longer has (it changed in Meta). If
  // this fails, the new mapping is already whole and the leftovers are the
  // ones that were there before.
  if (stale.length > 0) {
    const { error: staleError } = await admin
      .from('whatsapp_template_parameters')
      .delete()
      .in('id', stale.map((p) => p.id));
    if (staleError) throw new Error('שמירת המשתנים נכשלה');
  }

  await logActivity({
    action: 'admin.templates.parameters_set',
    meta: {
      whatsapp_template_id: input.templateId,
      template_name: template.name,
      changed,
      removed: stale.map((p) => ({ slot: slotKey(p), from: p.source_path })),
    },
  });
  return { ok: true };
}

/**
 * Ask the worker to mirror Meta's templates now, instead of waiting for the
 * nightly run. Queued, not run here: the worker owns the sync job.
 */
export async function requestTemplateSync(): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const boss = await getWebJobSender();
  await boss.send(QUEUES.templateHealthSync, {});
  await logActivity({ action: 'admin.templates.sync_requested' });
}
