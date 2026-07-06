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
