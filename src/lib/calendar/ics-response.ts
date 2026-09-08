// HTTP shape of the token-gated ICS routes. `inline` (not `attachment`) is the
// whole point: iOS Safari renders an inline `text/calendar` response as the
// Calendar preview ("Add All"), whereas an attachment / `download` anchor goes to
// the download manager and Files. Desktop and Android rows add `download` on
// the anchor themselves. `nosniff` + the exact MIME type: iOS hands the file to
// Calendar only for text/calendar (application/octet-stream does not work).
// Cache/robots/referrer headers repeat the route-group policy from next.config
// so the response is self-describing even if the header rules change.
export function icsResponse(ics: string, baseName: string): Response {
  // ASCII `filename=` for clients without RFC 5987 support; an all-Hebrew name
  // leaves only separators behind, so anything without a letter/digit falls
  // back to a fixed, readable name (no transliteration).
  const asciiCandidate = baseName.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim();
  const asciiName = /[A-Za-z0-9]/.test(asciiCandidate) ? asciiCandidate : 'kalfa-event';
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${asciiName}.ics"; filename*=UTF-8''${encodeURIComponent(baseName)}.ics`,
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
