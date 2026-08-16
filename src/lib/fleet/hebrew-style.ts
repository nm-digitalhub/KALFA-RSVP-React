// Hebrew punctuation and layout rules for anything the drafter writes to a
// customer — the Academy of the Hebrew Language rules, as grounding rather than
// as prose the agent has to infer.
//
// WHY THIS IS A CODE FILE AND NOT A PARAGRAPH IN THE ROLE.
//
// MEASURED 16.08 across two live drafts: editing `business-facts.ts` changed
// what the next draft said, within nineteen minutes of deploy, with no owner
// action. Editing `.claude/fleet/roles/**` is owner-only and needs a manual
// step every time. So the rules that will be REVISED — and punctuation rules
// always are, as new failure modes turn up — belong on the side that iterates
// freely. The role file only needs one durable line: "run this verb".
//
// Same contract as buildBusinessFacts(): PURE, bundle-safe, no DB, no PII, no
// secrets. Consumed by `npm run fleet:agent -- style`.
//
// This is deliberately NOT a linter. The drafter writes the prose; these are
// the rules it composes against. Mechanical checking of the fixed strings WE
// own is a separate concern.

export interface StyleRule {
  /** The mark or structure this rule governs. */
  mark: string;
  /** What to do, phrased as an instruction the drafter can apply directly. */
  rule: string;
  /** Minimal correct example. */
  good?: string;
  /** Minimal incorrect example — always paired with why it is wrong. */
  bad?: string;
}

export interface HebrewStyleGuide {
  punctuation: StyleRule[];
  structure: StyleRule[];
  typography: StyleRule[];
  /** Traps observed in REAL drafts, not hypotheticals. */
  measured_mistakes: string[];
}

// Each entry is one rule. Splitting them (rather than one prose blob) is what
// lets the drafter apply them individually instead of paraphrasing the lot.
const PUNCTUATION: StyleRule[] = [
  {
    mark: 'פסיק — מתי כן',
    rule: 'לפני מילת קישור ניגודית או תוצאתית המחברת שני משפטים עצמאיים (אך, אבל, לכן, ולכן).',
    good: 'ירד גשם כבד, לכן נשארנו בבית.',
  },
  {
    mark: 'פסיק — מתי כן',
    rule: 'להפרדת פסוקית (משפט משנה) מהמשפט העיקרי.',
    good: 'דמי ההפעלה חלים על עצם הפעלת השירות, גם אם לא נענה אף איש קשר.',
  },
  {
    mark: 'פסיק — מתי כן',
    rule: 'בין איברים ברשימה. האיבר האחרון מקבל ו״ו החיבור, ולפניה אין פסיק.',
    good: 'הזמנה עשרה ימים לפני, תזכורת שישה ימים לפני ושיחה יומיים לפני.',
    bad: 'הזמנה עשרה ימים לפני, תזכורת שישה ימים לפני, ושיחה יומיים לפני. — פסיק לפני ו״ו',
  },
  {
    mark: 'פסיק — מתי כן',
    rule: 'אחרי פנייה או מילת הסגר (מילה המביעה את עמדת הכותב).',
    good: 'לצערי, לא נוכל לעמוד בתאריך הזה.',
  },
  {
    mark: 'פסיק — מתי אסור',
    rule: 'לעולם לא בין נושא לנשוא, ולא בין נשוא לתיאור שצמוד אליו.',
    bad: 'ניהול אישורי הגעה לאירוע, בשני ערוצים — הפסיק מנתק את הנשוא מהתיאור שלו.',
    good: 'ניהול אישורי הגעה לאירוע בשני ערוצים.',
  },
  {
    mark: 'פסיק — מתי אסור',
    rule: 'לא לפני ו״ו החיבור, אלא אם היא נושאת משמעות ניגודית או תוצאתית. אם ו״ו מחברת שני משפטים עצמאיים בלי ניגוד — עדיף לפצל לשני משפטים.',
    bad: 'איש קשר הוא מספר טלפון אחד, ולעיתים הוא מייצג כמה אורחים.',
    good: 'איש קשר הוא מספר טלפון אחד. הוא עשוי לייצג כמה אורחים באותו בית.',
  },
  {
    mark: 'נקודה',
    rule: 'כל משפט חיווי נסגר בנקודה — כולל המשפט האחרון בתשובה.',
  },
  {
    mark: 'נקודתיים',
    rule: 'לפני פירוט, לפני ציטוט, או לפני הסבר/תוצאה של מה שנאמר לפניהן.',
    good: 'הפנייה נעשית בשני ערוצים: וואטסאפ ושיחת AI.',
  },
  {
    mark: 'נקודה־ופסיק',
    rule: 'רק בין שני משפטים שלמים הקרובים בתוכן. בין צירופים שמניים חסרי נשוא — נקודה או פסיק, לעולם לא נקודה־ופסיק.',
    good: 'חצי מהקבוצה פנתה ימינה; החצי השני המשיך ישר.',
    bad: 'ללא דמי מנוי; מחיר סופי — שני צירופים שמניים, לא משפטים.',
  },
];

const STRUCTURE: StyleRule[] = [
  {
    mark: 'ירידת שורה',
    rule: 'פסקה חדשה בכל מעבר לרעיון מרכזי חדש. פסקה שמחזיקה שני רעיונות — לפצל.',
  },
  {
    mark: 'כותרות',
    rule: 'אם חלק מהתשובה מחולק לבלוקים עם כותרות `**כותרת**`, כל בלוק יקבל כותרת. פסקה יתומה בלי כותרת בין בלוקים מכותרים נראית כשגיאה.',
  },
  {
    mark: 'אורך משפט',
    rule: 'משפט שנושא שלושה רעיונות — לפצל. במיוחד כשיש בתוכו מקף כפול (— … —) שכבר נושא הסגר.',
  },
  {
    mark: 'צעד המשך',
    rule: 'תשובה שאין בה מה לעשות הלאה מסתיימת בלא־כלום. לסיים בצעד קונקרטי, ככל שהוא קיים.',
  },
];

const TYPOGRAPHY: StyleRule[] = [
  {
    mark: 'גרשיים',
    rule: 'בראשי תיבות עבריים משתמשים בגרשיים (״), לא בגרש כפול ישר (").',
    good: 'מע״מ · צה״ל · ד״ר',
    bad: 'מע"מ',
  },
  {
    mark: 'גרש',
    rule: 'בקיצור מילה עברית משתמשים בגרש (׳), לא באפוסטרוף ישר (\').',
    good: 'וכו׳ · פרופ׳',
  },
  {
    mark: 'מגדר',
    rule: 'הפונה אינו ידוע במגדרו. לנסח ניטרלית — לשון רבים או פנייה בגוף סתמי — ולא לפנות בזכר כברירת מחדל.',
    bad: 'שאלת לגבי 150 אורחים.',
    good: 'השאלה הייתה על 150 אורחים.',
  },
];

// Every line here is a mistake that reached a real draft. Kept concrete on
// purpose: a rule stated abstractly gets paraphrased away, an example that
// actually happened does not.
const MEASURED_MISTAKES: string[] = [
  'ברכת פתיחה בגוף התשובה — המעטפת כבר מרנדרת כותרת ו"שלום {שם},". לפתוח ישירות בעניין.',
  'חתימה בגוף התשובה ("— צוות KALFA") — המעטפת מוסיפה חתימה משלה. לא לחתום.',
  'מציין־מקום כמו "[נציג יפרט…]" כשהתשובה כבר קיימת ב-FAQ המפורסם. להריץ את הפועל faq ולענות.',
  'כתובת URL גולמית בתוך פסקה עברית — היא נשברת ב-bidi. לכתוב [טקסט](/נתיב), נתיב פנימי בלבד.',
  'ציטוט מספרי מחיר מהזיכרון. תמיד להריץ business-facts ולצטט את summary_he כלשונו.',
];

export function buildHebrewStyleGuide(): HebrewStyleGuide {
  return {
    punctuation: PUNCTUATION,
    structure: STRUCTURE,
    typography: TYPOGRAPHY,
    measured_mistakes: MEASURED_MISTAKES,
  };
}
