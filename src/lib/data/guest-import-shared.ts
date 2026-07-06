// Shared guest-import helpers (screen upload + WhatsApp channel): the header
// aliases and the candidate-row shape both channels feed into importRowSchema.
export type GuestImportColumn = 'full_name' | 'phone' | 'group' | 'expected_count';

export function guestImportHeaderKey(raw: string): GuestImportColumn | null {
  const h = raw.trim().toLowerCase();
  if (['name', 'full_name', 'שם', 'שם מלא'].includes(h)) return 'full_name';
  if (['phone', 'mobile', 'טלפון', 'נייד', 'מספר'].includes(h)) return 'phone';
  if (['group', 'קבוצה'].includes(h)) return 'group';
  if (['count', 'expected_count', 'כמות', 'מספר משתתפים', 'משתתפים'].includes(h))
    return 'expected_count';
  return null;
}

// Canonical display form of a group name: trimmed, inner whitespace collapsed.
// The DB unique index guest_groups_event_name_key applies the SAME
// normalization (plus lower()) — app and DB always agree on "the same name".
// Comparison keys should use normalizeGroupName(x).toLowerCase().
export function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

// Canonical MATCH key for a GUEST name — used ONLY to detect "probably the same
// person" for merge suggestions (never to change the stored name, and never a
// DB constraint: guest names are legitimately non-unique). Unifies the Hebrew
// geresh ׳ (U+05F3) and gershayim ״ (U+05F4) plus curly apostrophes/quotes with
// their ASCII forms (the live geresh-vs-apostrophe collision that motivated
// this), strips niqqud/cantillation and bidi control marks, collapses
// whitespace, and lowercases (for Latin names). Two names with the same key are
// merge CANDIDATES, nothing more.
export function normalizeGuestName(name: string): string {
  return name
    .normalize('NFC')
    // niqqud, cantillation and Hebrew punctuation marks (U+0591–U+05C7) —
    // this range holds NO letters (letters start at U+05D0), so it is safe.
    .replace(/[֑-ׇ]/g, '')
    // bidi control characters that can silently ride along in shared contacts.
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    // geresh + curly/modifier apostrophes → ASCII apostrophe.
    .replace(/[׳‘’ʼ]/g, "'")
    // gershayim + curly quotes → ASCII quote.
    .replace(/[״“”]/g, '"')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
