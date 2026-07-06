// Single source of truth for the downloadable guest-import template. Kept as
// code (not a static asset) so the header row can never drift from the import
// parser's column aliases — import-actions.test.ts round-trips this exact
// content through importGuestsAction and fails the build if they diverge.

// Excel opens a UTF-8 CSV with Hebrew intact only when the BOM is present,
// and CRLF is the safest row terminator across spreadsheet apps.
const BOM = '\uFEFF';
const CRLF = '\r\n';

export const TEMPLATE_DOWNLOAD_FILENAME = 'תבנית-מוזמנים.csv';

// One row = one invitation (a household), not one person: `כמות` is how many
// people the invitation covers, and a family shares one phone. Several rows
// may even share the same phone — each still gets its own personal RSVP link,
// while billing counts the unique phone once.
const HEADER = ['שם מלא', 'טלפון', 'כמות', 'קבוצה'];
const SAMPLE_ROWS = [
  ['משפחת כהן', '0501234567', '4', 'משפחה'],
  ['דנה לוי', '0521112222', '2', 'חברים'],
  ['סבתא רחל', '', '1', 'משפחה'],
];

export function buildTemplateCsv(): string {
  return (
    BOM + [HEADER, ...SAMPLE_ROWS].map((r) => r.join(',')).join(CRLF) + CRLF
  );
}
