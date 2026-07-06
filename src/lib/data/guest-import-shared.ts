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
