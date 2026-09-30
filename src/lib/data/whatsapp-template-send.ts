import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import type { ResolvedTemplate } from '@/lib/data/message-templates-resolve';
import { signedInviteImageUrl } from '@/lib/storage/event-media';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  bindTemplateParameters,
  carriesRsvpQuickReplies,
  pickTemplateRoute,
  type TemplateParameterRow,
  type TemplateRouteRow,
} from '@/lib/whatsapp/template-route';
import {
  buildSendContext,
  readSendContextPath,
  type SendContext,
  type SendContextInput,
  type SendContextPath,
} from '@/lib/whatsapp/template-spec';

// The ONE place a WhatsApp send decides which Meta template goes out and what
// fills its variables — step 7 (cutover) of
// docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md.
//
// Reads the step (message_templates: active + channel), its routes
// (message_template_routes), the Meta mirror row and that template's variable
// rows (whatsapp_template_parameters) in ONE query, picks the route
// (event type + image → default + image → event type → default), and binds the
// variables from the send context. Every send site calls this; nothing else
// resolves a template.
//
// Failure is never silent: a step whose template is not in Meta any more, not
// APPROVED, or whose mapping names a value that does not exist, is reported to
// Slack (deduplicated) as well as returned to the caller, which records it in
// its failure sink exactly as before.

export type WhatsAppSendValues = {
  event?: SendContextInput['event'];
  guestFirstName?: string | null;
  // Values that are not part of an event: the sales-closing lead.
  lead?: { full_name?: string | null; signup_ref?: string | null };
};

export type ResolvedWhatsAppSend =
  | {
      kind: 'ok';
      template: ResolvedTemplate;
      templateId: string;
      bodyParams: string[];
      extras: { headerImage?: { link: string }; urlButtonParam?: string };
    }
  | { kind: 'template_missing' }
  // The step exists but is not a WhatsApp step (e.g. a call touchpoint).
  | { kind: 'channel_mismatch' }
  | { kind: 'params_incomplete'; missing: string[] };

type MirrorRow = {
  id: string;
  name: string;
  language: string;
  status: string | null;
  components: unknown;
  whatsapp_template_parameters: TemplateParameterRow[];
};

type StepPlan = {
  channel: string;
  routes: Array<TemplateRouteRow & { template: MirrorRow | null }>;
};

const MIRROR_SELECT =
  'id, name, language, status, components, whatsapp_template_parameters(whatsapp_template_id, type, sub_type, index, position, parameter_name, source_path)';

async function loadStepPlan(messageKey: string): Promise<StepPlan | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_templates')
    .select(
      `channel, message_template_routes(message_key, event_type, with_media, whatsapp_template_id, whatsapp_message_templates(${MIRROR_SELECT}))`,
    )
    .eq('message_key', messageKey)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  return {
    channel: data.channel,
    routes: (data.message_template_routes ?? []).map((r) => ({
      message_key: r.message_key,
      event_type: r.event_type,
      with_media: r.with_media,
      whatsapp_template_id: r.whatsapp_template_id,
      template: (r.whatsapp_message_templates as MirrorRow | null) ?? null,
    })),
  };
}

// A template deleted in Meta and re-created under the same name + language gets
// a new id; the sync marks the old row DELETED. The route still points at the
// old id, so send the live row with the same name + language — and say so.
async function liveTwin(template: MirrorRow): Promise<MirrorRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('whatsapp_message_templates')
    .select(MIRROR_SELECT)
    .eq('name', template.name)
    .eq('language', template.language)
    .neq('status', 'DELETED')
    .maybeSingle();
  return (data as MirrorRow | null) ?? null;
}

// Re-alert the same problem at most every 6 hours per process (the drip engine
// resolves once per recipient; one broken step must not page once per guest).
const REALERT_MS = 6 * 60 * 60 * 1000;
const lastAlertAt = new Map<string, number>();
function alertOnce(key: string, title: string, fields: Record<string, string>): void {
  const now = Date.now();
  const last = lastAlertAt.get(key);
  if (last !== undefined && now - last < REALERT_MS) return;
  lastAlertAt.set(key, now);
  void sendSlackAlert({
    level: 'warn',
    category: 'send_health',
    source: 'whatsapp-template-send',
    title,
    fields,
  });
}

function reader(ctx: SendContext | null, extra: Record<string, string | null>) {
  return (path: string): string | null | undefined => {
    if (path in extra) return extra[path];
    // Unknown = not a path the send context has at all (a typo in a mapping),
    // as opposed to a known path whose value is missing for this event (null).
    const [group, key] = path.split('.');
    if (!ctx || !(group in ctx) || !key || !(key in ctx[group as keyof SendContext])) {
      return undefined;
    }
    return readSendContextPath(ctx, path as SendContextPath);
  };
}

/**
 * Step-level check only: does this step have an approved template for this
 * event type (text route)? For a batch gate before any recipient is bound.
 */
export async function hasApprovedWhatsAppTemplate(
  messageKey: string,
  eventType: string | null,
): Promise<boolean> {
  const plan = await loadStepPlan(messageKey);
  if (!plan || plan.channel !== 'whatsapp') return false;
  const route = pickTemplateRoute(plan.routes, messageKey, eventType, false);
  const template = route ? plan.routes.find((r) => r === route)?.template ?? null : null;
  return template?.status === 'APPROVED' || template?.status === 'DELETED';
}

export async function resolveWhatsAppSend(input: {
  messageKey: string;
  eventType: string | null;
  inviteImagePath?: string | null;
  values: WhatsAppSendValues;
  // Injectable for the equivalence gate (no storage call).
  signImage?: (path: string) => Promise<string>;
}): Promise<ResolvedWhatsAppSend> {
  const { messageKey, eventType } = input;
  const plan = await loadStepPlan(messageKey);
  if (!plan) return { kind: 'template_missing' };
  if (plan.channel !== 'whatsapp') return { kind: 'channel_mismatch' };

  // Image first only when the event has one; a signing failure falls back to
  // the text template (a picture must never block a send — today's rule).
  let route = pickTemplateRoute(plan.routes, messageKey, eventType, !!input.inviteImagePath);
  let headerLink: string | null = null;
  if (route?.with_media && input.inviteImagePath) {
    try {
      headerLink = await (input.signImage ?? signedInviteImageUrl)(input.inviteImagePath);
    } catch (err) {
      console.error(
        `[whatsapp-template-send] invite media signing failed — sending text template instead: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      route = pickTemplateRoute(plan.routes, messageKey, eventType, false);
    }
  }
  if (!route) return { kind: 'template_missing' };

  let template = plan.routes.find((r) => r === route)?.template ?? null;
  if (template?.status === 'DELETED') {
    const twin = await liveTwin(template);
    alertOnce(
      `deleted:${messageKey}:${template.id}`,
      twin
        ? 'תבנית WhatsApp נמחקה ונוצרה מחדש ב-Meta — נשלחת הגרסה החדשה; יש לעדכן את השיוך'
        : 'תבנית WhatsApp נמחקה ב-Meta — השלב לא נשלח',
      { message_key: messageKey, template: template.name, event_type: eventType ?? 'default' },
    );
    template = twin;
  }
  if (!template || template.status !== 'APPROVED') {
    alertOnce(
      `unapproved:${messageKey}:${template?.id ?? 'none'}`,
      'תבנית WhatsApp לא מאושרת ב-Meta — השלב לא נשלח',
      {
        message_key: messageKey,
        template: template?.name ?? 'none',
        status: template?.status ?? 'missing',
        event_type: eventType ?? 'default',
      },
    );
    return { kind: 'template_missing' };
  }

  const ctx = input.values.event
    ? buildSendContext({ event: input.values.event, guestFirstName: input.values.guestFirstName ?? null })
    : null;
  const read = reader(ctx, {
    'event.invite_image': headerLink,
    'lead.full_name': input.values.lead?.full_name?.trim() || null,
    'lead.signup_ref': input.values.lead?.signup_ref?.trim() || null,
  });
  const unknown = template.whatsapp_template_parameters
    .map((p) => p.source_path)
    .filter((p) => read(p) === undefined);
  if (unknown.length > 0) {
    alertOnce(
      `unknown-path:${template.id}:${unknown.join(',')}`,
      'תבנית WhatsApp ממופה לערך שלא קיים — השלב לא נשלח',
      { message_key: messageKey, template: template.name, paths: unknown.join(', ') },
    );
    return { kind: 'params_incomplete', missing: unknown };
  }
  const bound = bindTemplateParameters(template.whatsapp_template_parameters, (p) => read(p) ?? null);
  if ('missing' in bound) return { kind: 'params_incomplete', missing: bound.missing };

  return {
    kind: 'ok',
    templateId: template.id,
    template: {
      name: template.name,
      language: template.language,
      channel: 'whatsapp',
      rsvpQuickReply: carriesRsvpQuickReplies(template.components),
    },
    bodyParams: bound.body,
    extras: {
      ...(bound.headerImagePath ? { headerImage: { link: bound.headerImagePath } } : {}),
      ...(bound.urlButtonParam ? { urlButtonParam: bound.urlButtonParam } : {}),
    },
  };
}
