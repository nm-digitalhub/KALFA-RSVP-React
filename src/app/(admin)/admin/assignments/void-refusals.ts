// The closed set of reasons the void RPC refuses with, and the Hebrew text staff see.
// Shared by the void action (which carries the code to the detail page) and the detail page
// (which renders it) — the URL only ever carries a code from this map, never free text.
export const VOID_REFUSALS: Record<string, string> = {
  held_by_payment: 'ההטבה מוחזקת על ידי תשלום פתוח — לא ניתן לבטל עד שהתשלום יוכרע.',
  held_by_review: 'ההטבה מוחזקת עד סיום בדיקת התשלום.',
  held_by_approved_terms: 'ההטבה קשורה לתנאים מאושרים — היא משולמת בתוקפה או פגה (אין ביטול).',
  already_ended: 'ההטבה כבר הסתיימה — אין מה לבטל.',
  needs_investigation: 'קיימת תנועת כסף או חריגת מימוש — אין ביטול; נדרשת בדיקה מול התשלומים.',
};

export const VOID_REFUSED_NOTICE_PREFIX = 'void_refused_';

export function voidRefusalFromNotice(notice: string): string | null {
  if (!notice.startsWith(VOID_REFUSED_NOTICE_PREFIX)) return null;
  const code = notice.slice(VOID_REFUSED_NOTICE_PREFIX.length);
  return Object.hasOwn(VOID_REFUSALS, code) ? VOID_REFUSALS[code] : null;
}
