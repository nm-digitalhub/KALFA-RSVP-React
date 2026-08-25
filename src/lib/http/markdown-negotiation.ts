import type { NextRequest } from 'next/server';

// Content negotiation for serving Markdown to AI agents on a small, fixed set
// of public marketing/legal pages, per RFC 9110 §12.5.1 (Accept) — not a
// substring check. Every other route (app, admin, api, auth, token pages,
// static assets, RSC/prefetch/Server Action traffic) is untouched; the
// allowlist below is the only gate that matters, the exclusions in
// `isNegotiableRequest` are defense-in-depth for requests that could
// otherwise land on an allowlisted path (a soft-nav RSC fetch of `/faq`, a
// prefetch of `/`).

export const MARKDOWN_NEGOTIABLE_PATHS = new Set<string>([
  '/',
  '/faq',
  '/contact',
  '/terms',
  '/privacy',
  '/cookies',
]);

// Headers Next.js's own client router sets on a soft-navigation/prefetch
// fetch to one of these paths — never convert those, only a fresh top-level
// GET should trigger negotiation. Names observed live on beta.kalfa.me
// (is-agentic scan, 2026-08-24: "Vary: rsc, next-router-state-tree,
// next-router-prefetch, next-router-segment-prefetch, accept-encoding").
const ROUTER_INTERNAL_HEADERS = [
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'next-action',
];

// The method + header checks that apply to any markdown-negotiable request
// regardless of path — split out so the catch-all 404 handler
// (app/[...catchAll]/route.ts) can reuse the exact same RSC/prefetch
// exclusions without duplicating them. That handler negotiates over every
// path NOT in MARKDOWN_NEGOTIABLE_PATHS by construction (Next only ever
// invokes it when nothing more specific matched), so it has no path check of
// its own to apply.
export function isEligibleRequestMethod(request: NextRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  for (const name of ROUTER_INTERNAL_HEADERS) {
    if (request.headers.has(name)) return false;
  }
  const purpose = request.headers.get('purpose') ?? request.headers.get('sec-purpose') ?? '';
  if (purpose.toLowerCase().includes('prefetch')) return false;
  return true;
}

export function isNegotiableRequest(request: NextRequest): boolean {
  return MARKDOWN_NEGOTIABLE_PATHS.has(request.nextUrl.pathname) && isEligibleRequestMethod(request);
}

type MediaRange = { type: string; subtype: string; q: number };

// Parses an Accept header into media ranges with their q values. Ignores
// parameters other than q (none of the types we negotiate over use any).
// Malformed entries are skipped rather than thrown on — a client that sends
// garbage should fall through to the HTML default, not 500.
function parseAccept(accept: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const raw of accept.split(',')) {
    const parts = raw.split(';').map((p) => p.trim());
    const mediaType = parts[0];
    if (!mediaType) continue;
    const [type, subtype] = mediaType.split('/');
    if (!type || !subtype) continue;
    let q = 1;
    for (const param of parts.slice(1)) {
      const [key, value] = param.split('=').map((s) => s.trim());
      if (key === 'q' && value !== undefined) {
        const parsed = Number(value);
        // RFC 9110 §12.4.2: qvalue is 0.000–1.000. Clamp rather than reject
        // the whole range — a client sending an out-of-spec q (2, -1, NaN)
        // should not get MORE or LESS priority than the spec's own bounds
        // allow, in either direction.
        if (Number.isFinite(parsed)) q = Math.min(1, Math.max(0, parsed));
      }
    }
    ranges.push({ type: type.toLowerCase(), subtype: subtype.toLowerCase(), q });
  }
  return ranges;
}

// Specificity per RFC 9110 §12.4.2: an exact type/subtype match outranks
// type/*, which outranks */*. Among ranges that match the same candidate at
// different specificities, only the MOST SPECIFIC one governs — q values are
// not combined across ranges.
function specificity(range: MediaRange, type: string, subtype: string): number {
  if (range.type === type && range.subtype === subtype) return 3;
  if (range.type === type && range.subtype === '*') return 2;
  if (range.type === '*' && range.subtype === '*') return 1;
  return 0;
}

// The effective quality Accept assigns to one candidate representation. No
// Accept header at all means "accepts anything" (RFC 9110 §12.5.1) — q=1.
// An Accept header that says nothing matching the candidate means q=0: the
// header was explicit, and being explicit and silent about a type is a
// rejection of it, same as this repo's other fail-closed guards.
function qualityFor(ranges: MediaRange[], type: string, subtype: string): number {
  if (ranges.length === 0) return 1;
  let bestSpecificity = -1;
  let bestQ = 0;
  for (const range of ranges) {
    const s = specificity(range, type, subtype);
    if (s > bestSpecificity) {
      bestSpecificity = s;
      bestQ = range.q;
    }
  }
  return bestSpecificity <= 0 ? 0 : bestQ;
}

export type NegotiationDecision = 'markdown' | 'html' | 'not-acceptable';

// Decides between text/markdown and text/html. A strictly higher quality for
// markdown wins; a tie (including the common `Accept: */*` and missing-header
// cases, both q=1/q=1) defaults to HTML — markdown is the opt-in
// representation for agents, not the default for browsers. Both explicitly
// rejected (q=0/q=0, only reachable with a real Accept header) is 406.
export function negotiateMarkdown(acceptHeader: string | null): NegotiationDecision {
  const ranges = parseAccept(acceptHeader ?? '');
  const markdownQ = qualityFor(ranges, 'text', 'markdown');
  const htmlQ = qualityFor(ranges, 'text', 'html');
  if (markdownQ === 0 && htmlQ === 0 && ranges.length > 0) return 'not-acceptable';
  return markdownQ > htmlQ ? 'markdown' : 'html';
}

// Appends `value` to a Vary header without duplicating an already-present
// token (case-insensitive, per RFC 9110 §12.5.5 field-name comparison) and
// without disturbing any existing token's casing or order.
export function addVary(headers: Headers, value: string): void {
  const existing = headers.get('vary');
  if (!existing) {
    headers.set('vary', value);
    return;
  }
  const tokens = existing.split(',').map((t) => t.trim());
  if (tokens.some((t) => t.toLowerCase() === value.toLowerCase())) return;
  headers.set('vary', `${existing}, ${value}`);
}
