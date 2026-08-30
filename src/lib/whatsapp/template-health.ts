import 'server-only';

// WhatsApp template health: category / quality-score / status tracking against
// Meta's live signals. Two complementary sources feed this, both landing on the
// same message_templates columns (see 20260827220000_message_templates_health_tracking.sql):
//   1. Webhooks (real-time, incl. Meta's ~24h advance downgrade warning) —
//      normalized in src/app/api/webhooks/whatsapp/route.ts, applied in
//      src/lib/data/template-health-processing.ts.
//   2. This module's reconciliation poll (GET .../message_templates) — a
//      safety net for missed/undelivered webhooks and the initial backfill,
//      since a poll alone cannot see an "impending" (not-yet-effective) change.
// Meta's API never exposes "what category did we originally request" — only
// the CURRENT one — so a downgrade is detected by comparing the live `category`
// against our own stored `requested_category` snapshot, not a Meta field.

const GRAPH = 'https://graph.facebook.com/v23.0';
const TIMEOUT_MS = 15_000;

export interface TemplateHealthCreds {
  wabaId: string;
  accessToken: string;
}

// Subset of the message-template resource's `fields=` we care about for
// health monitoring (live-doc-verified field list, 2026-08-27): id, name,
// language, category, correct_category, previous_category, quality_score,
// rejected_reason, status, sub_category.
export interface MetaTemplateHealthRow {
  id: string;
  name: string;
  language: string;
  category?: string;
  correct_category?: string;
  previous_category?: string;
  // Live-verified 2026-08-27: Meta returns this as a nested object
  // (`{ score, date }`), not the plain enum string the field name suggests —
  // unlike the webhook payload's new_quality_score/previous_quality_score,
  // which ARE plain strings. Store only `.score`.
  quality_score?: { score?: string; date?: number };
  rejected_reason?: string;
  status?: string;
}

/** Paginated GET of every template's current health fields for the WABA. */
export async function fetchTemplateHealth(
  creds: TemplateHealthCreds,
): Promise<MetaTemplateHealthRow[]> {
  const out: MetaTemplateHealthRow[] = [];
  let url: string | null =
    `${GRAPH}/${creds.wabaId}/message_templates?fields=id,name,language,category,correct_category,previous_category,quality_score,rejected_reason,status&limit=200`;
  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const res: Response = await fetch(url, {
      headers: { authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Meta template health fetch failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: MetaTemplateHealthRow[];
      paging?: { next?: string };
    };
    out.push(...(body.data ?? []));
    // paging.next already carries the access token as a query param on Meta's
    // side; we still send the header and never print the URL.
    url = body.paging?.next ?? null;
  }
  return out;
}

/** True when the live category has drifted from what we requested/intended —
 * the case that matters is UTILITY (cheap) silently becoming MARKETING
 * (expensive), but this flags ANY drift so a future AUTHENTICATION mix-up
 * would surface too. Null category (never synced) is never a downgrade. */
export function isCategoryDowngraded(
  requestedCategory: string,
  category: string | null,
): boolean {
  if (!category) return false;
  return category !== requestedCategory;
}
