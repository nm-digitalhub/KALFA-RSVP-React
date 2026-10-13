// The list's URL params, validated (admin-panel ב.3, spec §3): the detail page carries
// them back to the list, but ONLY through this whitelist — never a free client-supplied
// return URL. Unknown keys are dropped; values are pattern-checked; the base path is
// fixed to the assignments list.

const PATTERNS: Record<string, RegExp> = {
  q: /^[^\/\\<>"']{1,120}$/,
  status: /^(waiting|bound|consumed|cancelled|expired|guard)$/,
  source: /^(agent|staff)$/,
  offer: /^[0-9a-f-]{36}$/i,
  sort: /^(newest|oldest|expiry)$/,
  page: /^[0-9]{1,4}$/,
};

export type ListParams = Partial<Record<'q' | 'status' | 'source' | 'offer' | 'sort' | 'page', string>>;

/** The sanitized query string ("" or "?k=v&…") — safe to append to the fixed list path. */
export function sanitizedListSearch(raw: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(PATTERNS)) {
    const value = raw[key];
    if (typeof value === 'string' && PATTERNS[key].test(value)) params.set(key, value);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** The back-to-list href: ALWAYS the list path plus validated params only. */
export function listBackHref(raw: Record<string, string | string[] | undefined>): string {
  return `/admin/assignments${sanitizedListSearch(raw)}`;
}

/** The detail page's query: the validated list params (re-sanitized here — the caller's
 *  string is never trusted) plus one `notice` code. */
export function detailSearch(rawListSearch: string, notice: string): string {
  const incoming = Object.fromEntries(new URLSearchParams(rawListSearch));
  const params = new URLSearchParams(sanitizedListSearch(incoming).slice(1));
  params.set('notice', notice);
  return `?${params.toString()}`;
}
