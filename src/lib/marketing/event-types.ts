// Content catalogue for the public event-type marketing pages
// (/wedding, /bar-mitzva, /brit, /event).
//
// WHY A CATALOGUE AND NOT FOUR HAND-WRITTEN PAGES: four pages about the same
// product are a duplicate-content risk, and duplicate marketing pages rank
// worse than the single page they were split from. Keeping the copy here, in
// one file, makes the differences between the four visible at a glance and
// hard to let rot into a template with one word swapped. Every entry below
// describes a problem that is genuinely specific to that kind of event — a
// brit's date is not known until the birth, a bar mitzva counts children and
// adults separately, a wedding merges two families' lists.
//
// TRUTHFULNESS RULE — read before editing: only real, shipped capabilities may
// appear here. KALFA manages guest lists (groups, companions, notes,
// statuses), imports from a spreadsheet or WhatsApp, sends personal
// invitations and automatic reminders, tracks replies in real time via a
// per-guest private link, and reports to the organiser. It does NOT do
// seating charts or table planning, does not sell tickets and does not manage
// the venue. A seating claim was already published here once and had to be
// removed; do not reintroduce it.
//
// Each page targets ONLY its own long-tail phrase ("אישורי הגעה ל<סוג>").
// The generic head term "אישורי הגעה" belongs to the home page — repeating it
// as a page's own target would put these pages in competition with it.

export type EventTypeSlug = 'wedding' | 'bar-mitzva' | 'brit' | 'event';

export type EventTypeFaq = {
  readonly q: string;
  readonly a: string;
};

export type EventTypeContent = {
  readonly slug: EventTypeSlug;
  /** Route path. Also the canonical URL suffix. */
  readonly path: `/${string}`;
  /** <title> — the long-tail phrase first, brand appended by the layout. */
  readonly title: string;
  /** <meta name="description"> — one sentence, ~150 chars. */
  readonly description: string;
  /** Short label used in the home page's audience grid and the footer. */
  readonly navLabel: string;
  readonly h1: string;
  readonly lede: string;
  /** The eyebrow above the "what makes this event different" section. */
  readonly eyebrow: string;
  readonly challengesTitle: string;
  readonly challenges: readonly { readonly t: string; readonly d: string }[];
  /** When to send what — the single most-asked practical question. */
  readonly timingTitle: string;
  readonly timing: readonly string[];
  readonly faq: readonly EventTypeFaq[];
};

const WEDDING: EventTypeContent = {
  slug: 'wedding',
  path: '/wedding',
  title: 'אישור הגעה לחתונה — ניהול רשימת המוזמנים',
  description:
    'ניהול אישורי הגעה לחתונה: איחוד רשימות שני הצדדים, ספירת מלווים, תזכורות אוטומטיות למי שטרם השיב ומעקב תשובות בזמן אמת.',
  navLabel: 'חתונות',
  h1: 'אישורי הגעה לחתונה',
  lede: 'שתי משפחות, רשימה אחת. במקום שני קבצים שנשלחים הלוך ושוב בוואטסאפ — רשימה מסודרת אחת שמתעדכנת מעצמה.',
  eyebrow: 'למה חתונה שונה',
  challengesTitle: 'ארבע בעיות שחוזרות כמעט בכל חתונה',
  challenges: [
    {
      t: 'שתי רשימות שצריך לאחד',
      d: 'כל צד מנהל את המוזמנים שלו בנפרד, והחברים המשותפים מופיעים פעמיים. ייבוא של שתי הרשימות למקום אחד חושף את הכפילויות במקום להסתיר אותן.',
    },
    {
      t: 'לא יודעים כמה מלווים יגיעו',
      d: 'הזמנה אחת למשפחה יכולה להיות שני אנשים או שישה. כשכל מוזמן מדווח בעצמו כמה מגיעים איתו, המספר מפסיק להיות ניחוש.',
    },
    {
      t: 'הפער בין "אישרתי" למי שבאמת בא',
      d: 'חלק מהמאשרים לא מגיעים, וחלק מהשותקים כן. מעקב רציף אחרי מי טרם השיב מצמצם את קבוצת האלמונים לפני שסוגרים מספרים.',
    },
    {
      t: 'מאות תזכורות ידניות',
      d: 'לרדוף אחרי 300 איש בטלפון זה עבודה של שבוע. תזכורת אוטומטית יוצאת רק למי שעוד לא ענה — ולא מטרידה את מי שכבר השיב.',
    },
  ],
  timingTitle: 'מתי לשלוח מה',
  timing: [
    'ההזמנה האישית — כארבעה עד שישה שבועות לפני התאריך.',
    'תזכורת ראשונה לממתינים — כשבוע עד עשרה ימים לפני.',
    'סבב אחרון לפני סגירת מספרים — יומיים־שלושה לפני, לפי מועד ההתחשבנות עם המקום.',
    'הודעת תודה אחרי האירוע — נשלחת אוטומטית למי שהגיע.',
  ],
  faq: [
    {
      q: 'מתי כדאי לשלוח אישורי הגעה לחתונה?',
      a: 'ההזמנה האישית יוצאת בדרך כלל ארבעה עד שישה שבועות לפני התאריך, ותזכורת לממתינים כשבוע עד עשרה ימים לפני. מוקדם מדי והתשובה נשכחת, מאוחר מדי ולא נשאר זמן לסבב שני.',
    },
    {
      q: 'איך מאחדים את רשימת המוזמנים של שני הצדדים?',
      a: 'אפשר לייבא כל רשימה בנפרד — מקובץ או מוואטסאפ — ולסמן אותה כקבוצה משלה. מוזמן שמופיע בשתי הרשימות מזוהה לפי מספר הטלפון, כך שלא נשלחות אליו שתי הזמנות.',
    },
    {
      q: 'האם כל מוזמן מקבל קישור אישי?',
      a: 'כן. לכל מוזמן נוצר קישור פרטי משלו, והוא רואה רק את הפרטים שלו — לא את רשימת המוזמנים ולא את תשובות האחרים.',
    },
  ],
};

const BAR_MITZVA: EventTypeContent = {
  slug: 'bar-mitzva',
  path: '/bar-mitzva',
  title: 'אישורי הגעה לבר מצווה ובת מצווה',
  description:
    'ניהול אישורי הגעה לבר מצווה ולבת מצווה: ספירה נפרדת של ילדים ומבוגרים, רשימת חברי הכיתה, תזכורות אוטומטיות ומעקב בזמן אמת.',
  navLabel: 'בר/בת מצווה',
  h1: 'אישורי הגעה לבר מצווה ולבת מצווה',
  lede: 'שלוש רשימות שונות באירוע אחד — משפחה, חברי הכיתה והעבודה של ההורים. כל אחת מתנהגת אחרת, וכולן צריכות להסתדר במספר אחד.',
  eyebrow: 'למה בר מצווה שונה',
  challengesTitle: 'מה שמסבך דווקא באירוע הזה',
  challenges: [
    {
      t: 'ילדים ומבוגרים נספרים בנפרד',
      d: 'הקייטרינג רוצה לדעת כמה מנות ילדים. כששדה הכמות נפרד לכל הזמנה, אפשר לראות את שתי הספירות בלי לגזור אותן ידנית מהרשימה.',
    },
    {
      t: 'ההורים עונים במקום הילדים',
      d: 'חבר מהכיתה לא עונה על הודעות — ההורה שלו כן. ההזמנה יוצאת למספר של ההורה, והתשובה נרשמת על שם הילד.',
    },
    {
      t: 'רשימת הכיתה מגיעה כרשימת וואטסאפ',
      d: 'אפשר לייבא את אנשי הקשר של קבוצת הכיתה במקום להקליד שלושים שמות ומספרים ידנית.',
    },
    {
      t: 'שלוש קבוצות עם התנהגות שונה',
      d: 'המשפחה עונה מהר, העבודה עונה מאוחר והכיתה כמעט לא עונה. חלוקה לקבוצות מראה איפה בדיוק תקוע אחוז ההיענות.',
    },
  ],
  timingTitle: 'מתי לשלוח מה',
  timing: [
    'ההזמנה האישית — כשלושה עד ארבעה שבועות לפני.',
    'תזכורת ממוקדת לקבוצת הכיתה — היא תמיד האיטית ביותר.',
    'סבב אחרון לפני מסירת מספרים לקייטרינג.',
  ],
  faq: [
    {
      q: 'איך סופרים ילדים ומבוגרים בנפרד?',
      a: 'כל הזמנה נושאת כמות משלה ואפשר לשייך אותה לקבוצה — למשל "כיתה" מול "משפחה". הדוח מציג את הספירה לכל קבוצה, כך שאפשר למסור לקייטרינג מספר מנות ילדים נפרד.',
    },
    {
      q: 'מה עושים כשחבר של הילד לא עונה?',
      a: 'ההזמנה נשלחת למספר של ההורה, ותזכורת אוטומטית יוצאת רק למי שטרם השיב. אפשר לשלוח תזכורת לקבוצת הכיתה בלבד בלי להטריד את שאר המוזמנים.',
    },
  ],
};

const BRIT: EventTypeContent = {
  slug: 'brit',
  path: '/brit',
  title: 'אישורי הגעה לברית — כשיש רק כמה ימים',
  description:
    'ניהול אישורי הגעה לברית בלוח זמנים קצר: הקמת האירוע בדקות, שליחה מיידית לכל המוזמנים ומעקב תשובות עד הרגע האחרון.',
  navLabel: 'ברית',
  h1: 'אישורי הגעה לברית',
  lede: 'התאריך נודע רק בלידה, והאירוע מתקיים תוך ימים ספורים. כאן מהירות ההקמה חשובה יותר מכל יכולת אחרת.',
  eyebrow: 'למה ברית שונה',
  challengesTitle: 'אירוע שכל הלוח זמנים שלו דחוס',
  challenges: [
    {
      t: 'אין שבועות — יש ימים',
      d: 'בין ההודעה לאירוע עוברים לרוב יומיים־שלושה. אין זמן לבנות רשימה מאפס, ולכן ייבוא רשימה קיימת הוא כל ההבדל.',
    },
    {
      t: 'ההורים לא פנויים לנהל רשימה',
      d: 'הימים האלה עסוקים בדברים אחרים לגמרי. אחרי השליחה, התזכורות והמעקב ממשיכים לרוץ בלי שמישהו יושב מולם.',
    },
    {
      t: 'המספרים זזים עד הרגע האחרון',
      d: 'תשובות ממשיכות להיכנס גם בבוקר האירוע. תמונת מצב חיה עדיפה על רשימה שהודפסה אתמול.',
    },
    {
      t: 'צריך להגיע לכולם מהר',
      d: 'הודעה אישית לכל המוזמנים יוצאת בבת אחת, במקום להעתיק את אותו טקסט לעשרות שיחות נפרדות.',
    },
  ],
  timingTitle: 'לוח זמנים ריאלי',
  timing: [
    'הקמת האירוע וייבוא הרשימה — תוך דקות מרגע שהתאריך ידוע.',
    'ההודעה האישית — מיד לאחר מכן, באותו יום.',
    'תזכורת לממתינים — בערב שלפני או בבוקר האירוע.',
  ],
  faq: [
    {
      q: 'כמה זמן לוקח להקים אירוע ולשלוח?',
      a: 'הקמת האירוע היא עניין של דקות, וייבוא רשימה קיימת מקובץ או מוואטסאפ חוסך את ההקלדה. אפשר לשלוח את ההודעה באותו יום שבו נקבע התאריך.',
    },
    {
      q: 'אפשר לשלוח הזמנות לברית באותו היום?',
      a: 'כן. אין תקופת המתנה — ברגע שהרשימה נטענה והאירוע נוצר, ההודעות יוצאות.',
    },
  ],
};

const GENERAL_EVENT: EventTypeContent = {
  slug: 'event',
  path: '/event',
  title: 'אישורי הגעה לאירוע — עסקי, משפחתי או כנס',
  description:
    'ניהול אישורי הגעה לאירוע עסקי, כנס או אירוע משפחתי: רשימה מדויקת לכניסה, חלוקה לקבוצות, תזכורות אוטומטיות ודוח למארגן.',
  navLabel: 'אירועים וכנסים',
  h1: 'אישורי הגעה לאירוע',
  lede: 'כנס, ערב חברה או אירוע משפחתי גדול — כשיש קיבולת מוגבלת, רשימה מדויקת שווה יותר מהערכה.',
  eyebrow: 'למה אירוע מאורגן שונה',
  challengesTitle: 'מה שמארגן אירוע צריך ולא תמיד מקבל',
  challenges: [
    {
      t: 'קיבולת שאי אפשר לחרוג ממנה',
      d: 'לאולם או לחדר יש מספר מקומות סופי. מעקב רציף אחרי מספר המאשרים מונע גילוי מאוחר מדי שנרשמו יותר מדי.',
    },
    {
      t: 'רשימה מדויקת לכניסה',
      d: 'ברשימת כניסה, "בערך" לא עובד. הרשימה המעודכנת זמינה בכל רגע, בלי לייצא גרסה שמתיישנת מיד.',
    },
    {
      t: 'קבוצות ומחלקות',
      d: 'חלוקה לקבוצות מאפשרת לראות היענות לפי מחלקה או לפי סוג מוזמן, ולשלוח תזכורת רק לקבוצה שפיגרה.',
    },
    {
      t: 'דוח שאפשר להעביר הלאה',
      d: 'סיכום מספרים ברור למי שמזמין את האוכל, מנהל את הכניסה או צריך לדווח הלאה.',
    },
  ],
  timingTitle: 'מתי לשלוח מה',
  timing: [
    'ההזמנה — שבועיים עד ארבעה שבועות לפני, לפי גודל האירוע.',
    'תזכורת לממתינים — כשבוע לפני.',
    'סגירת רשימת כניסה — יום לפני, מהתמונה המעודכנת.',
  ],
  faq: [
    {
      q: 'אפשר לחלק את המוזמנים לקבוצות?',
      a: 'כן. כל מוזמן יכול להשתייך לקבוצה — מחלקה, סוג מוזמן או כל חלוקה אחרת — ואחוז ההיענות מוצג לכל קבוצה בנפרד.',
    },
    {
      q: 'איך יודעים כמה אנשים באמת יגיעו?',
      a: 'כל מוזמן מדווח בעצמו כמה אנשים ההזמנה שלו מכסה, והמספר מתעדכן בזמן אמת. מי שטרם השיב מסומן בנפרד, כך שברור כמה מהמספר עדיין לא ודאי.',
    },
  ],
};

export const EVENT_TYPES: readonly EventTypeContent[] = [
  WEDDING,
  BAR_MITZVA,
  BRIT,
  GENERAL_EVENT,
];

export function getEventType(slug: EventTypeSlug): EventTypeContent {
  const found = EVENT_TYPES.find((e) => e.slug === slug);
  // Unreachable via the four page files (each passes a literal slug), but a
  // typo in a future page would otherwise render an empty page rather than
  // fail the build.
  if (!found) throw new Error(`unknown event type: ${slug}`);
  return found;
}
