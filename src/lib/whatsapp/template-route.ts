// Data-driven template resolution for WhatsApp sends — the replacement for the
// message_templates.components mapping (variants / media_variants /
// param_contract / rsvp_quick_reply) and the code builders in template-spec.ts.
// Step 6/7 of docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md.
//
// PURE (no I/O, no 'server-only'): the caller loads the rows — routes
// (message_template_routes), the Meta mirror (whatsapp_message_templates) and
// the variable rows (whatsapp_template_parameters) — and these functions decide.

import type { components } from '@/lib/whatsapp/generated/message-templates';
import { RSVP_QUICK_REPLY } from '@/lib/whatsapp/rsvp-buttons';
import { buildSendContext, type SendContext, type SendContextInput } from '@/lib/whatsapp/template-spec';

export type TemplateRouteRow = {
  message_key: string;
  event_type: string | null;
  with_media: boolean;
  whatsapp_template_id: string;
};

export type TemplateParameterRow = {
  whatsapp_template_id: string;
  type: string;
  sub_type: string | null;
  index: number | null;
  position: number | null;
  parameter_name: string | null;
  source_path: string;
};

/**
 * One part of a Meta template (header, body, footer, buttons, …) — the type
 * generated from Meta's published spec (`npm run meta:types`). The mirror keeps
 * `components` as jsonb, so a reader casts the column to this.
 */
export type MetaTemplateComponent = NonNullable<components['schemas']['MessageTemplate']['components']>[number];

/** The mirrored `components` column as Meta's parts; anything else = none. */
export function metaComponents(value: unknown): MetaTemplateComponent[] {
  return Array.isArray(value) ? (value as MetaTemplateComponent[]) : [];
}

/**
 * Which template a step sends. Resolution order, most specific first:
 * event type + image → default + image → event type → default. The image rows
 * are considered only when the event actually has a usable image (today's
 * fail-open: no image, or a signing failure, sends the text template).
 */
export function pickTemplateRoute(
  routes: readonly TemplateRouteRow[],
  messageKey: string,
  eventType: string | null,
  withImage: boolean,
): TemplateRouteRow | null {
  const candidates: Array<[string | null, boolean]> = [
    ...(withImage
      ? ([
          [eventType, true],
          [null, true],
        ] as Array<[string | null, boolean]>)
      : []),
    [eventType, false],
    [null, false],
  ];
  for (const [type, media] of candidates) {
    const hit = routes.find(
      (r) => r.message_key === messageKey && r.event_type === type && r.with_media === media,
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * What a send does with the template a route points at — the SAME rule for the
 * sender (whatsapp-template-send.ts) and the admin screen, so the screen never
 * says a step goes out when the sender would stop it, or the reverse.
 *
 * - DELETED in Meta: the live row with the same name + language (`liveTwin`,
 *   looked up by the caller only for a deleted template) is sent instead; no
 *   twin → the step is not sent.
 * - Anything but APPROVED (PENDING, REJECTED, PAUSED, DISABLED, a status Meta
 *   adds tomorrow…): the step is not sent. There is no fallback to the default
 *   route — a blocked template blocks the step.
 */
export type RoutedTemplateDecision<T> =
  | { send: true; template: T; deletedOriginal: T | null }
  | { send: false; reason: 'deleted_no_twin' | 'not_approved' | 'missing'; template: T | null; deletedOriginal: T | null };

export function decideRoutedTemplate<T extends { status: string | null }>(
  template: T | null,
  liveTwin: T | null,
): RoutedTemplateDecision<T> {
  let current = template;
  let deletedOriginal: T | null = null;
  if (current?.status === 'DELETED') {
    deletedOriginal = current;
    current = liveTwin;
    if (!current) return { send: false, reason: 'deleted_no_twin', template: null, deletedOriginal };
  }
  if (!current) return { send: false, reason: 'missing', template: null, deletedOriginal };
  if (current.status !== 'APPROVED') return { send: false, reason: 'not_approved', template: current, deletedOriginal };
  return { send: true, template: current, deletedOriginal };
}

/**
 * Whether a send must inject the RSVP quick-reply payloads, read from the Meta
 * template itself instead of a hand-set flag: its buttons are exactly the
 * RSVP_QUICK_REPLY count of QUICK_REPLY buttons and nothing else (a URL button
 * cannot coexist with the injected payloads — client.ts's conflict guard).
 * Unknown/empty components → false.
 */
export function carriesRsvpQuickReplies(components: unknown): boolean {
  const buttons = metaComponents(components)
    .filter((c) => c?.type === 'BUTTONS')
    .flatMap((c) => c.buttons ?? []);
  return (
    buttons.length === RSVP_QUICK_REPLY.length &&
    buttons.every((b) => b.type === 'QUICK_REPLY')
  );
}

// --- The values a template variable can be mapped to -------------------------
//
// ONE source for three readers: the admin "{" picker (what it offers), the admin
// save (what it accepts) and resolveWhatsAppSend (what it can read). Paths are
// DERIVED from the objects the sender builds, so a value added to
// buildSendContext appears in all three without another list to update.

// Steps sent to a sales lead, not to an event guest: their values are the
// lead's, and event values do not exist for them.
export const LEAD_MESSAGE_KEYS = new Set(['sales_signup_link']);

export type SendValueGroups = Record<string, Record<string, string | null>>;

export function buildLeadValues(lead?: { full_name?: string | null; signup_ref?: string | null }) {
  return {
    lead: {
      full_name: lead?.full_name?.trim() || null,
      signup_ref: lead?.signup_ref?.trim() || null,
    },
  };
}

// The event values plus the one value that exists only at send time: the signed
// link to the event's invite image (the IMAGE header).
export function buildEventValues(ctx: SendContext, inviteImageLink: string | null) {
  return { ...ctx, event: { ...ctx.event, invite_image: inviteImageLink } };
}

// Values that are an image link — the only thing an IMAGE header can carry.
export const IMAGE_VALUE_PATHS = new Set(['event.invite_image']);

const SAMPLE_EVENT: SendContextInput = {
  event: { event_type: 'wedding', celebrants: null },
  guestFirstName: null,
};

function pathsOf(groups: SendValueGroups): string[] {
  return Object.entries(groups).flatMap(([group, values]) =>
    Object.keys(values).map((key) => `${group}.${key}`),
  );
}

/** Every value a template sent by this step may be mapped to. */
export function sendValuePaths(messageKey: string): string[] {
  return pathsOf(
    LEAD_MESSAGE_KEYS.has(messageKey)
      ? buildLeadValues()
      : buildEventValues(buildSendContext(SAMPLE_EVENT), null),
  );
}

/** Every value any step has (event steps and lead steps together). */
export function anySendValuePaths(): string[] {
  return [
    ...pathsOf(buildEventValues(buildSendContext(SAMPLE_EVENT), null)),
    ...pathsOf(buildLeadValues()),
  ];
}

/** A path's value; undefined = not a path these values have (a bad mapping). */
export function readSendValue(groups: SendValueGroups, path: string): string | null | undefined {
  const dot = path.indexOf('.');
  if (dot < 1) return undefined;
  const values = groups[path.slice(0, dot)];
  const key = path.slice(dot + 1);
  if (!values || !Object.prototype.hasOwnProperty.call(values, key)) return undefined;
  return values[key];
}

// --- The variables a Meta template has, and whether a mapping covers them ---
//
// Read from Meta's own components (the mirror), limited to what the sender
// (client.ts buildTemplateMessage) can fill: an IMAGE header, positional
// {{n}} body variables and one URL-button suffix. Anything else is reported,
// never guessed — Meta rejects a send whose parameters do not match (132000).

export type TemplateSlot = {
  type: 'header' | 'body' | 'button';
  sub_type: string | null;
  index: number | null;
  position: number;
};

const VARIABLE = /\{\{\s*([^}\s]+)\s*\}\}/g;

export function templateSlots(components: unknown): { slots: TemplateSlot[]; unsupported: string[] } {
  const slots: TemplateSlot[] = [];
  const unsupported: string[] = [];
  for (const c of metaComponents(components)) {
    const vars = [...new Set([...(c.text ?? '').matchAll(VARIABLE)].map((m) => m[1]))];
    if (c.type === 'HEADER') {
      if (c.format === 'IMAGE') slots.push({ type: 'header', sub_type: null, index: null, position: 1 });
      else if (c.format && c.format !== 'TEXT') unsupported.push(`כותרת מסוג ${c.format}`);
      else if (vars.length > 0) unsupported.push('משתנה בכותרת טקסט');
    } else if (c.type === 'BODY') {
      for (const v of vars) {
        if (/^\d+$/.test(v)) slots.push({ type: 'body', sub_type: null, index: null, position: Number(v) });
        else unsupported.push(`משתנה בשם {{${v}}}`);
      }
    } else if (c.type === 'BUTTONS') {
      (c.buttons ?? []).forEach((b, index) => {
        if (b.type === 'URL' && /\{\{\s*1\s*\}\}/.test(b.url ?? '')) {
          slots.push({ type: 'button', sub_type: 'url', index, position: 1 });
        } else if (b.type !== 'URL' && b.type !== 'QUICK_REPLY' && b.type !== 'PHONE_NUMBER') {
          unsupported.push(`כפתור מסוג ${b.type ?? '?'}`);
        }
      });
    } else if (c.type !== 'FOOTER') {
      // CAROUSEL, LIMITED_TIME_OFFER and any part Meta adds later carry their
      // own parameters the sender does not build: reported, never skipped.
      unsupported.push(`חלק מסוג ${c.type ?? '?'}`);
    }
  }
  return { slots, unsupported };
}

const slotKey = (s: { type: string; sub_type: string | null; index: number | null; position: number | null }) =>
  `${s.type}|${s.sub_type ?? ''}|${s.index ?? ''}|${s.position ?? ''}`;

/**
 * Problems (Hebrew, for the admin) with mapping `rows` onto a template whose
 * components are `components`, for a step whose values are `allowedPaths`.
 * Empty = every variable is mapped exactly once to a value the sender has.
 */
export function parameterCoverageProblems(
  components: unknown,
  rows: ReadonlyArray<Pick<TemplateParameterRow, 'type' | 'sub_type' | 'index' | 'position' | 'source_path'>>,
  allowedPaths: readonly string[],
): string[] {
  const { slots, unsupported } = templateSlots(components);
  const problems = unsupported.map((u) => `התבנית כוללת ${u}, שהמערכת עדיין לא יודעת למלא`);
  const allowed = new Set(allowedPaths);
  // Two values for the same variable are refused, not silently merged.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const r of rows) {
    const k = slotKey(r);
    if (seen.has(k)) duplicated.add(k);
    seen.add(k);
  }
  for (const slot of slots) {
    if (duplicated.has(slotKey(slot))) {
      const label = slot.type === 'body' ? `{{${slot.position}}}` : slot.type === 'header' ? 'תמונת הכותרת' : 'סיומת הקישור בכפתור';
      problems.push(`יש יותר מערך אחד ל-${label}`);
    }
  }
  const byKey = new Map(rows.map((r) => [slotKey(r), r]));
  for (const slot of slots) {
    const row = byKey.get(slotKey(slot));
    const label = slot.type === 'body' ? `{{${slot.position}}}` : slot.type === 'header' ? 'תמונת הכותרת' : 'סיומת הקישור בכפתור';
    if (!row) problems.push(`חסר ערך ל-${label}`);
    else if (!allowed.has(row.source_path)) problems.push(`הערך של ${label} לא קיים בשלב הזה`);
    else if ((slot.type === 'header') !== IMAGE_VALUE_PATHS.has(row.source_path)) {
      problems.push(slot.type === 'header' ? 'תמונת הכותרת חייבת להיות תמונת ההזמנה' : `תמונה לא יכולה למלא את ${label}`);
    }
  }
  const slotKeys = new Set(slots.map(slotKey));
  if (rows.some((r) => !slotKeys.has(slotKey(r)))) problems.push('יש ערכים למשתנים שלא קיימים בתבנית');
  return problems;
}

export type BoundTemplateParams = {
  body: string[];
  headerImagePath?: string;
  urlButtonParam?: string;
};

/**
 * Bind a template's variable rows to values. `read` answers a source path
 * (null = unavailable). Fail-closed: any unavailable value → { missing } with
 * each path once, in position order; never an empty parameter.
 */
export function bindTemplateParameters(
  rows: readonly TemplateParameterRow[],
  read: (sourcePath: string) => string | null,
): BoundTemplateParams | { missing: string[] } {
  const missing: string[] = [];
  const body: Array<[number, string]> = [];
  let headerImagePath: string | undefined;
  let urlButtonParam: string | undefined;
  const ordered = [...rows].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.type.localeCompare(b.type),
  );
  for (const row of ordered) {
    const value = read(row.source_path);
    if (value === null) {
      if (!missing.includes(row.source_path)) missing.push(row.source_path);
      continue;
    }
    if (row.type === 'body') body.push([row.position ?? 0, value]);
    else if (row.type === 'header') headerImagePath = value;
    else if (row.type === 'button' && row.sub_type === 'url') urlButtonParam = value;
  }
  if (missing.length > 0) return { missing };
  return {
    body: body.sort((a, b) => a[0] - b[0]).map(([, v]) => v),
    ...(headerImagePath !== undefined ? { headerImagePath } : {}),
    ...(urlButtonParam !== undefined ? { urlButtonParam } : {}),
  };
}
