import {
  buildTemplateCsv,
  TEMPLATE_DOWNLOAD_FILENAME,
} from '@/lib/guests/import-template';

// GET /guest-list-template.csv — the SAME guest-list template the
// signed-in import screen offers (/app/events/[id]/guests/import/template),
// served publicly for the marketing page next to it.
//
// It deliberately shares buildTemplateCsv() rather than shipping a static file
// in public/: the header row must stay identical to what the import parser
// accepts, and import-actions.test.ts round-trips that exact string through
// importGuestsAction. A copied asset would drift silently the first time a
// column is renamed, and a visitor would download a template the product then
// rejects.
//
// CSV, not .xlsx, on purpose. Excel opens a UTF-8 CSV with Hebrew intact once
// the BOM is present (buildTemplateCsv writes one), while the guest importer
// actively REJECTS .xlsx uploads by magic-byte sniffing (src/lib/csv.ts) — so
// an .xlsx template would be a file our own product refuses. It would also
// mean a new dependency, which src/lib/csv.ts's header rules out.
//
// The dot-suffixed segment is the same shape as src/app/llms.txt/route.ts, and
// it is deliberate twice over: the URL reads as a file to a human, and it
// keeps the handler out of the pages tree. Nested under the marketing page as
// /guest-list-template/download it tripped @next/next/no-html-link-for-pages —
// the rule treats the folder as a page and demands <Link>, which would try a
// client-side navigation to something that is not a page at all. Renaming was
// the fix; an eslint-disable would have papered over a real mismatch.
//
// No guest data is involved and nothing here is request-dependent, so the
// response is prerendered — GET handlers are dynamic by default (same note as
// src/app/llms.txt/route.ts).
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(buildTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // RFC 5987 filename* carries the Hebrew name; the plain filename is an
      // ASCII fallback for agents that ignore filename*. Same pair the
      // in-app template handler sends.
      'Content-Disposition': `attachment; filename="kalfa-guests-template.csv"; filename*=UTF-8''${encodeURIComponent(TEMPLATE_DOWNLOAD_FILENAME)}`,
    },
  });
}
