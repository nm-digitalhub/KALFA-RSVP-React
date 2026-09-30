// Data-driven template resolution for WhatsApp sends — the replacement for the
// message_templates.components mapping (variants / media_variants /
// param_contract / rsvp_quick_reply) and the code builders in template-spec.ts.
// Step 6/7 of docs/superpowers/plans/2026-09-30-whatsapp-templates-meta-mirror.md.
//
// PURE (no I/O, no 'server-only'): the caller loads the rows — routes
// (message_template_routes), the Meta mirror (whatsapp_message_templates) and
// the variable rows (whatsapp_template_parameters) — and these functions decide.

import { RSVP_QUICK_REPLY } from '@/lib/whatsapp/rsvp-buttons';

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

type MetaButton = { type?: string; url?: string };
type MetaComponent = { type?: string; buttons?: MetaButton[] };

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
 * Whether a send must inject the RSVP quick-reply payloads, read from the Meta
 * template itself instead of a hand-set flag: its buttons are exactly the
 * RSVP_QUICK_REPLY count of QUICK_REPLY buttons and nothing else (a URL button
 * cannot coexist with the injected payloads — client.ts's conflict guard).
 * Unknown/empty components → false.
 */
export function carriesRsvpQuickReplies(components: unknown): boolean {
  if (!Array.isArray(components)) return false;
  const buttons = (components as MetaComponent[])
    .filter((c) => c?.type === 'BUTTONS')
    .flatMap((c) => c.buttons ?? []);
  return (
    buttons.length === RSVP_QUICK_REPLY.length &&
    buttons.every((b) => b.type === 'QUICK_REPLY')
  );
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
