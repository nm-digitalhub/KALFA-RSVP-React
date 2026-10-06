import 'server-only';

// WhatsApp template health: category / quality-score / status tracking against
// Meta's live signals. Two complementary sources feed this, both landing on the
// same message_templates columns (see 20260827185340_message_templates_health_tracking.sql)
// and on the whatsapp_message_templates mirror:
//   1. Webhooks (real-time, incl. Meta's ~24h advance downgrade warning) —
//      normalized in src/app/api/webhooks/whatsapp/route.ts, applied in
//      src/lib/data/template-health-processing.ts.
//   2. This module's reconciliation poll (GET .../message_templates) — a
//      safety net for missed/undelivered webhooks and the initial backfill,
//      since a poll alone cannot see an "impending" (not-yet-effective) change.
// Meta's API never exposes "what category did we originally request" — only
// the CURRENT one — so a downgrade is detected by comparing the live `category`
// against our own stored `requested_category` snapshot, not a Meta field.

import type { components, paths } from '@/lib/whatsapp/generated/message-templates';
import { createMetaGraphClient } from '@/lib/whatsapp/graph-client';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

const TIMEOUT_MS = 15_000;

export interface TemplateHealthCreds {
  wabaId: string;
  accessToken: string;
}

/**
 * One message template as Graph returns it — the type generated from Meta's
 * published v25.0 spec (`npm run meta:types`, message-template-api). Note
 * `quality_score` is an object (`{ score, date }`), unlike the webhook's plain
 * strings; the sync stores `.score`.
 */
export type MetaTemplate = components['schemas']['MessageTemplate'];

// Every key whatsapp_message_templates mirrors. quality_score / rejected_reason
// / correct_category are NOT returned unless named here (verified live
// 2026-09-30). Checked against the generated type: a name Meta does not
// define fails to compile instead of failing the request.
const TEMPLATE_FIELDS = [
  'id', 'name', 'language', 'status', 'category', 'sub_category', 'components',
  'parameter_format', 'quality_score', 'rejected_reason', 'correct_category',
  'previous_category', 'message_send_ttl_seconds', 'library_template_name',
  'disable_ios_autofill', 'is_primary_device_delivery_only',
] as const satisfies readonly (keyof MetaTemplate)[];

/** Every template on the WABA, page by page (Graph's cursor paging). */
export async function fetchTemplateHealth(creds: TemplateHealthCreds): Promise<MetaTemplate[]> {
  const client = createMetaGraphClient<paths>(creds.accessToken);
  const out: MetaTemplate[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const { data, response } = await client.GET('/{Version}/{WABA-ID}/message_templates', {
      params: {
        header: { Authorization: `Bearer ${creds.accessToken.trim()}` },
        path: { Version: GRAPH_API_VERSION, 'WABA-ID': creds.wabaId },
        query: { fields: TEMPLATE_FIELDS.join(','), limit: 100, ...(after ? { after } : {}) },
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok || !data) throw new Error(`Meta template health fetch failed: HTTP ${response.status}`);
    out.push(...(data.data ?? []));
    // `paging.next` is present only while there is a next page.
    after = data.paging?.next ? data.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

// The drift rule lives with the other template states (template-status.ts,
// no 'server-only') so the admin screen uses the same one.
export { isCategoryDowngraded } from '@/lib/whatsapp/template-status';
