// What the admin sees for each value a template variable can be mapped to
// (the paths come from template-route.ts sendValuePaths — never listed here as
// a source of truth). User-facing copy only: a path missing from this table is
// still offered, under its technical id, so a value added to the send context
// never disappears from the picker.

export type ValueKind = 'text' | 'person' | 'date' | 'time' | 'place' | 'link' | 'image';

export type ValueLabel = { label: string; group: string; subtext?: string; kind: ValueKind };

const EVENT = 'פרטי האירוע';
const GUEST = 'פרטי האורח';
const BRIT = 'נוסח לברית';
const LEAD = 'פרטי הליד';

export const VALUE_LABELS: Record<string, ValueLabel> = {
  'guest.greeting_name': { label: 'פנייה לאורח', group: GUEST, subtext: 'שם האורח, או "משפחה וחברים יקרים" כשאין שם', kind: 'person' },
  'guest.first_name': { label: 'שם פרטי של האורח', group: GUEST, subtext: 'חסר = השליחה נעצרת', kind: 'person' },

  'event.type_label': { label: 'סוג האירוע', group: EVENT, subtext: 'חתונה, בר מצווה…', kind: 'text' },
  'event.celebrants_text': { label: 'בעלי השמחה', group: EVENT, subtext: 'לפי סוג האירוע', kind: 'person' },
  'event.groom': { label: 'שם החתן', group: EVENT, kind: 'person' },
  'event.bride': { label: 'שם הכלה', group: EVENT, kind: 'person' },
  'event.weekday': { label: 'יום בשבוע', group: EVENT, subtext: 'למשל: יום שלישי', kind: 'date' },
  'event.date_hebrew': { label: 'תאריך עברי', group: EVENT, kind: 'date' },
  'event.date_gregorian': { label: 'תאריך לועזי', group: EVENT, kind: 'date' },
  'event.date_hebrew_and_gregorian': { label: 'תאריך עברי ולועזי', group: EVENT, subtext: 'שניהם יחד', kind: 'date' },
  'event.time': { label: 'שעה', group: EVENT, kind: 'time' },
  'event.venue': { label: 'מקום האירוע', group: EVENT, subtext: 'שם האולם וכתובתו', kind: 'place' },
  'event.gift_payment_url': { label: 'קישור למתנה', group: EVENT, kind: 'link' },
  'event.gift_link_token': { label: 'סיומת קישור המתנה', group: EVENT, subtext: 'לכפתור קישור בתבנית', kind: 'link' },
  'event.invite_image': { label: 'תמונת ההזמנה', group: EVENT, subtext: 'לכותרת תמונה בלבד', kind: 'image' },

  'brit.invite_line': { label: 'שורת הזמנה לברית', group: BRIT, kind: 'text' },
  'brit.reminder_line': { label: 'שורת תזכורת לברית', group: BRIT, kind: 'text' },
  'brit.closing': { label: 'חתימת הזמנה לברית', group: BRIT, kind: 'text' },
  'brit.thanks_line': { label: 'שורת תודה לברית', group: BRIT, kind: 'text' },
  'brit.family_signature': { label: 'חתימת המשפחה', group: BRIT, kind: 'person' },

  'lead.full_name': { label: 'שם הליד', group: LEAD, kind: 'person' },
  'lead.signup_ref': { label: 'סיומת קישור ההרשמה', group: LEAD, subtext: 'לכפתור קישור בתבנית', kind: 'link' },
};

export function valueLabel(path: string): ValueLabel {
  return VALUE_LABELS[path] ?? { label: path, group: 'אחר', kind: 'text' };
}
