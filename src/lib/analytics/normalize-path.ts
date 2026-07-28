// URL normalization for GA4 (plans/ga4-url-normalization.md): internal UUIDs
// must never reach page_location/page_path/page_referrer — each UUID path
// segment is replaced with a stable placeholder named after the preceding
// segment. Pure module, no I/O — client-safe and unit-tested.

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Placeholder per PRECEDING path segment (the resource the id belongs to).
const SEGMENT_LABELS: Record<string, string> = {
  events: '[event-id]',
  campaign: '[campaign-id]',
  guests: '[guest-id]',
};

export function normalizeAnalyticsPath(pathname: string): string {
  const segments = pathname.split('/');
  return segments
    .map((segment, i) =>
      UUID_SEGMENT.test(segment)
        ? (SEGMENT_LABELS[segments[i - 1] ?? ''] ?? '[id]')
        : segment,
    )
    .join('/');
}

// Full-URL variant for page_location / page_referrer: normalizes the path
// segment-aware AND scrubs UUIDs from query-string values. A string that does
// not parse as a URL (edge: about:blank, empty referrer) falls back to a
// global UUID scrub — fail-closed: no UUID survives either branch.
export function normalizeAnalyticsUrl(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.pathname = normalizeAnalyticsPath(u.pathname);
    u.search = u.search.replace(UUID_ANYWHERE, '[id]');
    u.hash = u.hash.replace(UUID_ANYWHERE, '[id]');
    return u.toString();
  } catch {
    return url.replace(UUID_ANYWHERE, '[id]');
  }
}
