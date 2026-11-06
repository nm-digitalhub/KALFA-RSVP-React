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
//
// slug and path stay at module scope because the sitemap needs them with no
// language. The copy is built per call from a `t` the caller passes: a page
// passes the request's t from @/i18n.server, and force-static code such as
// /llms.txt passes the fixed Hebrew one from @/lib/i18n. That is why this file
// imports neither.

import type { TFunction } from 'i18next';

export type EventTypeSlug = 'wedding' | 'bar-mitzva' | 'brit' | 'event';

export type EventTypeFaq = {
  readonly q: string;
  readonly a: string;
};

export type EventTypeRoute = {
  readonly slug: EventTypeSlug;
  /** Route path. Also the canonical URL suffix. */
  readonly path: `/${string}`;
};

export type EventTypeContent = EventTypeRoute & {
  /** <title> — the long-tail phrase first, brand appended by the layout. */
  readonly title: string;
  /** <meta name="description"> — one sentence, ~150 chars. */
  readonly description: string;
  /** Short label used in the footer. */
  readonly navLabel: string;
  readonly h1: string;
  readonly lede: string;
  /** The eyebrow above the "what makes this event different" section. */
  readonly eyebrow: string;
  readonly challengesTitle: string;
  readonly challenges: readonly { readonly title: string; readonly d: string }[];
  /**
   * The in-depth guide section: answer-first paragraphs that give the page the
   * substance a searcher (and an AI answer engine) actually came for. Each
   * paragraph opens with the direct answer, then the detail. Same
   * truthfulness rule as everything else in this file.
   */
  readonly guideTitle: string;
  readonly guide: readonly { readonly h: string; readonly p: string }[];
  /**
   * The ORGANISER's planning steps — what to do when. It must never promise a
   * send date for KALFA's own messages: that cadence is admin-configured on
   * the campaign package and rendered live by EventTypePage from
   * getPublicBusinessFacts(), so a hand-typed "the invitation goes out N weeks
   * before" here would contradict the product the moment it ships.
   */
  readonly timingTitle: string;
  readonly timing: readonly string[];
  readonly faq: readonly EventTypeFaq[];
};

type EventTypeCopy = Omit<EventTypeContent, keyof EventTypeRoute>;

function weddingCopy(t: TFunction<'public'>): EventTypeCopy {
  return {
    title: t('site.eventType.wedding.meta.title', 'אישור הגעה לחתונה — ניהול רשימת המוזמנים'),
    description: t('site.eventType.wedding.meta.description', 'ניהול אישורי הגעה לחתונה: איחוד רשימות שני הצדדים, ספירת מלווים, תזכורות אוטומטיות למי שטרם השיב ומעקב תשובות בזמן אמת.'),
    navLabel: t('site.eventType.wedding.navLabel', 'חתונות'),
    h1: t('site.eventType.wedding.hero.title', 'אישורי הגעה לחתונה'),
    lede: t('site.eventType.wedding.hero.lede', 'שתי משפחות, רשימה אחת. במקום שני קבצים שנשלחים הלוך ושוב בוואטסאפ — רשימה מסודרת אחת שמתעדכנת מעצמה.'),
    eyebrow: t('site.eventType.wedding.challenges.eyebrow', 'למה חתונה שונה'),
    challengesTitle: t('site.eventType.wedding.challenges.title', 'ארבע בעיות שחוזרות כמעט בכל חתונה'),
    challenges: [
      {
        title: t('site.eventType.wedding.challenges.c1.title', 'שתי רשימות שצריך לאחד'),
        d: t('site.eventType.wedding.challenges.c1.body', 'כל צד מנהל את המוזמנים שלו בנפרד, והחברים המשותפים מופיעים פעמיים. ייבוא של שתי הרשימות למקום אחד חושף את הכפילויות במקום להסתיר אותן.'),
      },
      {
        title: t('site.eventType.wedding.challenges.c2.title', 'לא יודעים כמה מלווים יגיעו'),
        d: t('site.eventType.wedding.challenges.c2.body', 'הזמנה אחת למשפחה יכולה להיות שני אנשים או שישה. כשכל מוזמן מדווח בעצמו כמה מגיעים איתו, המספר מפסיק להיות ניחוש.'),
      },
      {
        title: t('site.eventType.wedding.challenges.c3.title', 'הפער בין "אישרתי" למי שבאמת בא'),
        d: t('site.eventType.wedding.challenges.c3.body', 'חלק מהמאשרים לא מגיעים, וחלק מהשותקים כן. מעקב רציף אחרי מי טרם השיב מצמצם את קבוצת האלמונים לפני שסוגרים מספרים.'),
      },
      {
        title: t('site.eventType.wedding.challenges.c4.title', 'מאות תזכורות ידניות'),
        d: t('site.eventType.wedding.challenges.c4.body', 'לרדוף אחרי 300 איש בטלפון זה עבודה של שבוע. תזכורת אוטומטית יוצאת רק למי שעוד לא ענה — ולא מטרידה את מי שכבר השיב.'),
      },
    ],
    guideTitle: t('site.eventType.wedding.guide.title', 'המדריך לאישורי הגעה לחתונה'),
    guide: [
      {
        h: t('site.eventType.wedding.guide.g1.heading', 'מה זה אישור הגעה לחתונה'),
        p: t('site.eventType.wedding.guide.g1.body', 'אישור הגעה הוא התשובה של כל מוזמן: האם הוא מגיע, וכמה אנשים מגיעים איתו. מסכום התשובות נגזר המספר שמוסרים לאולם ולקייטרינג, ולכן כדאי לאסוף אותו במקום אחד ולא בעשרות שיחות נפרדות. ב‑KALFA מוזמן יכול להשיב בלחיצה בהודעת הוואטסאפ, או דרך קישור אישי שבו הוא בוחר מגיע, אולי או לא מגיע, מדווח כמה מבוגרים וכמה ילדים ומוסיף הערה אם יש.'),
      },
      {
        h: t('site.eventType.wedding.guide.g2.heading', 'הזמנה מודפסת, Save the Date ואישור הגעה — שלושה דברים שונים'),
        p: t('site.eventType.wedding.guide.g2.body', 'ההזמנה המודפסת וה‑Save the Date מודיעים על התאריך, ולכן נשלחים שבועות מראש. אישור ההגעה שואל מי באמת מגיע, ולכן הוא עובד הכי טוב קרוב לתאריך — כשהמוזמנים כבר יודעים מה התוכניות שלהם. ב‑KALFA סבב אישורי ההגעה יוצא אוטומטית בימים שלפני החתונה, לפי לוח הזמנים שמופיע בהמשך העמוד.'),
      },
      {
        h: t('site.eventType.wedding.guide.g3.heading', 'איך מאחדים רשימת מוזמנים של שני צדדים'),
        p: t('site.eventType.wedding.guide.g3.body', 'מייבאים את הרשימה של כל צד בנפרד — מקובץ CSV (אקסל שומר בפורמט הזה) או מוואטסאפ — ומשייכים כל שורה לקבוצה כמו "צד החתן", "צד הכלה" או "חברים". לפני שהייבוא נכנס לרשימה רואים טיוטה, ומספר טלפון שכבר קיים אצל מוזמן אחר מסומן בה עם שם המוזמן הקיים, כך שכפילות מתגלה לפני השליחה ולא אחריה.'),
      },
      {
        h: t('site.eventType.wedding.guide.g4.heading', 'מה קורה עם מי שלא עונה'),
        p: t('site.eventType.wedding.guide.g4.body', 'מי שכבר השיב לא מקבל עוד תזכורות; התזכורות האוטומטיות ממשיכות רק אל מי שעוד לא ענה. תמונת המצב מתעדכנת בכל תשובה, כך שרואים בכל רגע כמה אישרו וכמה עוד ממתינים, ואפשר לסנן את הרשימה לפי צד או קבוצה כדי לראות מי מתוכה עוד לא ענה.'),
      },
    ],
    timingTitle: t('site.eventType.wedding.timing.title', 'מה עושים ומתי'),
    timing: [
      t('site.eventType.wedding.timing.t1', 'סגירת רשימת המוזמנים של שני הצדדים — כחודש וחצי לפני, כדי שיישאר זמן לאחד כפילויות ולהשלים מספרי טלפון חסרים.'),
      t('site.eventType.wedding.timing.t2', 'Save the Date או הזמנה מודפסת, אם שולחים — שבועות מראש. זה נפרד מסבב אישורי ההגעה.'),
      t('site.eventType.wedding.timing.t3', 'ייבוא הרשימה ל‑KALFA והפעלת אישורי ההגעה — מספיק זמן לפני תחילת הסבב שמופיע בלוח הזמנים למטה.'),
      t('site.eventType.wedding.timing.t4', 'סגירת המספרים מול האולם — אחרי ההודעה האחרונה בסבב, לפי המועד שסוכם עם המקום.'),
      t('site.eventType.wedding.timing.t5', 'הודעת תודה אחרי האירוע — נשלחת אוטומטית למי שהגיע.'),
    ],
    faq: [
      {
        q: t('site.eventType.wedding.faq.q1.question', 'מתי שולחים אישורי הגעה לחתונה?'),
        a: t('site.eventType.wedding.faq.q1.answer', 'את ההזמנה או ה‑Save the Date שולחים שבועות מראש, אבל את השאלה "מי מגיע" עדיף לשאול קרוב לתאריך, כשהתשובות כבר מדויקות. ב‑KALFA סבב אישורי ההגעה והתזכורות יוצא אוטומטית בימים שלפני החתונה, ולא נשלחות הודעות בשבת ובחג.'),
      },
      {
        q: t('site.eventType.wedding.faq.q2.question', 'איך מאחדים את רשימת המוזמנים של שני הצדדים?'),
        a: t('site.eventType.wedding.faq.q2.answer', 'אפשר לייבא כל רשימה בנפרד — מקובץ או מוואטסאפ — ולסמן אותה כקבוצה משלה. מספר טלפון שכבר קיים ברשימה מסומן בטיוטת הייבוא עם שם המוזמן הקיים, כך שאפשר להחליט לפני השליחה ולא לשלוח לאותו אדם פעמיים.'),
      },
      {
        q: t('site.eventType.wedding.faq.q3.question', 'האם כל מוזמן מקבל קישור אישי?'),
        a: t('site.eventType.wedding.faq.q3.answer', 'כן. לכל מוזמן נוצר קישור פרטי משלו, והוא רואה רק את הפרטים שלו — לא את רשימת המוזמנים ולא את תשובות האחרים.'),
      },
      {
        q: t('site.eventType.wedding.faq.q4.question', 'האם המוזמנים צריכים להתקין אפליקציה?'),
        a: t('site.eventType.wedding.faq.q4.answer', 'לא. ההודעה מגיעה בוואטסאפ, והתשובה נשלחת בלחיצה או דרך הקישור האישי שנפתח בדפדפן בטלפון. אין צורך בהרשמה או בהתקנה.'),
      },
      {
        q: t('site.eventType.wedding.faq.q5.question', 'כמה עולה ניהול אישורי הגעה לחתונה?'),
        a: t('site.eventType.wedding.faq.q5.answer', 'הפירוט המלא — החבילות, המחיר של כל אחת ומה כלול בה — מופיע בעמוד השאלות הנפוצות, והוא מתעדכן ישירות מהחבילות שבמערכת.'),
      },
    ],
  };
}

function barMitzvaCopy(t: TFunction<'public'>): EventTypeCopy {
  return {
    title: t('site.eventType.barMitzva.meta.title', 'אישורי הגעה לבר מצווה ובת מצווה'),
    description: t('site.eventType.barMitzva.meta.description', 'ניהול אישורי הגעה לבר מצווה ולבת מצווה: ספירה נפרדת של ילדים ומבוגרים, רשימת חברי הכיתה, תזכורות אוטומטיות ומעקב בזמן אמת.'),
    navLabel: t('site.eventType.barMitzva.navLabel', 'בר/בת מצווה'),
    h1: t('site.eventType.barMitzva.hero.title', 'אישורי הגעה לבר מצווה ולבת מצווה'),
    lede: t('site.eventType.barMitzva.hero.lede', 'שלוש רשימות שונות באירוע אחד — משפחה, חברי הכיתה והעבודה של ההורים. כל אחת מתנהגת אחרת, וכולן צריכות להסתדר במספר אחד.'),
    eyebrow: t('site.eventType.barMitzva.challenges.eyebrow', 'למה בר מצווה שונה'),
    challengesTitle: t('site.eventType.barMitzva.challenges.title', 'מה שמסבך דווקא באירוע הזה'),
    challenges: [
      {
        title: t('site.eventType.barMitzva.challenges.c1.title', 'ילדים ומבוגרים נספרים בנפרד'),
        d: t('site.eventType.barMitzva.challenges.c1.body', 'הקייטרינג רוצה לדעת כמה מנות ילדים. מי שעונה דרך הקישור האישי מדווח בנפרד כמה מבוגרים וכמה ילדים מגיעים, והפירוט מופיע ליד שמו ברשימה. תשובה בהודעת וואטסאפ נרשמת כמספר כולל.'),
      },
      {
        title: t('site.eventType.barMitzva.challenges.c2.title', 'ההורים עונים במקום הילדים'),
        d: t('site.eventType.barMitzva.challenges.c2.body', 'חבר מהכיתה לא עונה על הודעות — ההורה שלו כן. ההזמנה יוצאת למספר של ההורה, והתשובה נרשמת על שם הילד.'),
      },
      {
        title: t('site.eventType.barMitzva.challenges.c3.title', 'רשימת הכיתה מגיעה כרשימת וואטסאפ'),
        d: t('site.eventType.barMitzva.challenges.c3.body', 'אפשר לייבא את אנשי הקשר של קבוצת הכיתה במקום להקליד שלושים שמות ומספרים ידנית.'),
      },
      {
        title: t('site.eventType.barMitzva.challenges.c4.title', 'שלוש קבוצות עם התנהגות שונה'),
        d: t('site.eventType.barMitzva.challenges.c4.body', 'המשפחה עונה מהר, העבודה עונה מאוחר והכיתה כמעט לא עונה. סינון הרשימה לפי קבוצה ולפי סטטוס מראה בדיוק איפה התשובות תקועות.'),
      },
    ],
    guideTitle: t('site.eventType.barMitzva.guide.title', 'המדריך לאישורי הגעה לבר מצווה ולבת מצווה'),
    guide: [
      {
        h: t('site.eventType.barMitzva.guide.g1.heading', 'שלושה מעגלים, קצב תשובה שונה'),
        p: t('site.eventType.barMitzva.guide.g1.body', 'ברוב החגיגות יש שלושה מעגלים: המשפחה, חברי הכיתה ואנשי העבודה של ההורים. כששמים כל מעגל בקבוצה משלו, אפשר לסנן את הרשימה לפי קבוצה ולפי סטטוס ולראות מוקדם איזה מעגל עוד לא ענה.'),
      },
      {
        h: t('site.eventType.barMitzva.guide.g2.heading', 'ההזמנה לחבר מהכיתה נשלחת להורה'),
        p: t('site.eventType.barMitzva.guide.g2.body', 'את חברי הכיתה מזמינים דרך הטלפון של ההורה, והשם ברשימה הוא שם הילד. ההורה מקבל את ההודעה, עונה בשם הילד, ומדווח גם אם אח או הורה מגיעים איתו.'),
      },
      {
        h: t('site.eventType.barMitzva.guide.g3.heading', 'עלייה לתורה ומסיבה — שני אירועים, שתי רשימות'),
        p: t('site.eventType.barMitzva.guide.g3.body', 'כשהעלייה לתורה והמסיבה מתקיימות בימים שונים ולקהל שונה, כל אחת מהן היא אירוע נפרד ב‑KALFA עם רשימה ותשובות משלה. כך מי שמוזמן רק לבית הכנסת לא נספר בטעות גם במסיבה.'),
      },
    ],
    timingTitle: t('site.eventType.barMitzva.timing.title', 'מה עושים ומתי'),
    timing: [
      t('site.eventType.barMitzva.timing.t1', 'איסוף רשימת הכיתה מההורים או מקבוצת הוואטסאפ — כחודש לפני, זה החלק שלוקח הכי הרבה זמן.'),
      t('site.eventType.barMitzva.timing.t2', 'חלוקה לקבוצות (משפחה, כיתה, עבודה) וייבוא ל‑KALFA — לפני תחילת סבב אישורי ההגעה.'),
      t('site.eventType.barMitzva.timing.t3', 'מעקב אחרי קבוצת הכיתה — היא בדרך כלל האחרונה לענות, ושם כדאי לבדוק מי עוד חסר.'),
      t('site.eventType.barMitzva.timing.t4', 'מסירת מספרים לקייטרינג — אחרי ההודעה האחרונה בסבב, עם פירוט מבוגרים וילדים.'),
    ],
    faq: [
      {
        q: t('site.eventType.barMitzva.faq.q1.question', 'איך סופרים ילדים ומבוגרים בנפרד?'),
        a: t('site.eventType.barMitzva.faq.q1.answer', 'בטופס שנפתח מהקישור האישי יש שדה נפרד למבוגרים ושדה נפרד לילדים, והמספרים מופיעים ליד שם המוזמן ברשימה. מי שמשיב ישירות בהודעת הוואטסאפ מדווח מספר כולל, בלי פיצול.'),
      },
      {
        q: t('site.eventType.barMitzva.faq.q2.question', 'מה עושים כשחבר של הילד לא עונה?'),
        a: t('site.eventType.barMitzva.faq.q2.answer', 'ההזמנה נשלחת למספר של ההורה, והתזכורות האוטומטיות ממשיכות רק אל מי שעוד לא השיב. סינון הרשימה לקבוצת הכיתה ולסטטוס "ממתין" מראה בדיוק מי מבני הכיתה עוד לא ענה.'),
      },
      {
        q: t('site.eventType.barMitzva.faq.q3.question', 'אפשר לנהל בת מצווה באותה מערכת?'),
        a: t('site.eventType.barMitzva.faq.q3.answer', 'כן. אין הבדל בניהול בין בר מצווה לבת מצווה — אותה רשימה, אותן קבוצות ואותו מעקב תשובות. את שם האירוע ואת פרטי בעלי השמחה ממלאים כשיוצרים את האירוע.'),
      },
    ],
  };
}

function britCopy(t: TFunction<'public'>): EventTypeCopy {
  return {
    title: t('site.eventType.brit.meta.title', 'אישורי הגעה לברית ולבריתה — כשיש רק כמה ימים'),
    description: t('site.eventType.brit.meta.description', 'ניהול אישורי הגעה לברית ולבריתה בלוח זמנים קצר: הקמת האירוע בדקות, פנייה אוטומטית לכל המוזמנים ומעקב תשובות עד הרגע האחרון.'),
    navLabel: t('site.eventType.brit.navLabel', 'ברית'),
    h1: t('site.eventType.brit.hero.title', 'אישורי הגעה לברית'),
    lede: t('site.eventType.brit.hero.lede', 'התאריך נודע רק בלידה, והאירוע מתקיים תוך ימים ספורים. כאן מהירות ההקמה חשובה יותר מכל יכולת אחרת.'),
    eyebrow: t('site.eventType.brit.challenges.eyebrow', 'למה ברית שונה'),
    challengesTitle: t('site.eventType.brit.challenges.title', 'אירוע שכל לוח הזמנים שלו דחוס'),
    challenges: [
      {
        title: t('site.eventType.brit.challenges.c1.title', 'אין שבועות — יש ימים'),
        d: t('site.eventType.brit.challenges.c1.body', 'בין ההודעה לאירוע עוברים לרוב יומיים־שלושה. אין זמן לבנות רשימה מאפס, ולכן ייבוא רשימה קיימת הוא כל ההבדל.'),
      },
      {
        title: t('site.eventType.brit.challenges.c2.title', 'ההורים לא פנויים לנהל רשימה'),
        d: t('site.eventType.brit.challenges.c2.body', 'הימים האלה עסוקים בדברים אחרים לגמרי. אחרי השליחה, התזכורות והמעקב ממשיכים לרוץ בלי שמישהו יושב מולם.'),
      },
      {
        title: t('site.eventType.brit.challenges.c3.title', 'המספרים זזים עד הרגע האחרון'),
        d: t('site.eventType.brit.challenges.c3.body', 'תשובות ממשיכות להיכנס גם בבוקר האירוע. תמונת מצב חיה עדיפה על רשימה שהודפסה אתמול.'),
      },
      {
        title: t('site.eventType.brit.challenges.c4.title', 'צריך להגיע לכולם מהר'),
        d: t('site.eventType.brit.challenges.c4.body', 'הפנייה יוצאת אוטומטית לכל הרשימה, במקום להעתיק את אותו טקסט לעשרות שיחות נפרדות.'),
      },
    ],
    guideTitle: t('site.eventType.brit.guide.title', 'המדריך לאישורי הגעה לברית ולבריתה'),
    guide: [
      {
        h: t('site.eventType.brit.guide.g1.heading', 'למה ברית נסגרת בימים ולא בשבועות'),
        p: t('site.eventType.brit.guide.g1.body', 'ברית מילה נערכת ביום השמיני ללידה, ולכן בין הרגע שבו התאריך ידוע לבין האירוע עוברים ימים ספורים. זה הופך את מהירות ההקמה לדבר החשוב ביותר: רשימה קיימת שמייבאים מקובץ או מוואטסאפ חוסכת את ההקלדה, והאירוע מוכן תוך דקות.'),
      },
      {
        h: t('site.eventType.brit.guide.g2.heading', 'גם לבריתה ולזבד הבת'),
        p: t('site.eventType.brit.guide.g2.body', 'בבריתה או בזבד הבת התאריך גמיש יותר, אבל הרשימה דומה: משפחה קרובה, חברים ושכנים. אותו תהליך עובד גם כאן — יוצרים אירוע, מייבאים את הרשימה ומפעילים את אישורי ההגעה.'),
      },
      {
        h: t('site.eventType.brit.guide.g3.heading', 'כשהברית נופלת סמוך לשבת או לחג'),
        p: t('site.eventType.brit.guide.g3.body', 'הודעות לא נשלחות בשבת, בחג ובשעות הלילה. הודעה שמועדה נופל בזמן כזה מתוזמנת מחדש אוטומטית לחלון השליחה הבא, כך שאף מוזמן לא מקבל הודעה בשבת.'),
      },
    ],
    timingTitle: t('site.eventType.brit.timing.title', 'לוח זמנים ריאלי'),
    timing: [
      t('site.eventType.brit.timing.t1', 'הקמת האירוע וייבוא הרשימה — תוך דקות מרגע שהתאריך ידוע.'),
      t('site.eventType.brit.timing.t2', 'הפעלת אישורי ההגעה — מיד לאחר מכן, כדי לתפוס את נקודות הזמן שעוד נותרו בלוח השליחה.'),
      t('site.eventType.brit.timing.t3', 'מעקב אחרי התשובות — עד הערב שלפני, לפני שמוסרים מספר לבית הכנסת או לאולם.'),
    ],
    faq: [
      {
        q: t('site.eventType.brit.faq.q1.question', 'כמה זמן לוקח להקים אירוע ולשלוח?'),
        a: t('site.eventType.brit.faq.q1.answer', 'הקמת האירוע היא עניין של דקות, וייבוא רשימה קיימת מקובץ או מוואטסאפ חוסך את ההקלדה. אפשר להפעיל את אישורי ההגעה באותו יום שבו נקבע התאריך.'),
      },
      {
        q: t('site.eventType.brit.faq.q2.question', 'אפשר להפעיל אישורי הגעה לברית ימים ספורים לפני?'),
        a: t('site.eventType.brit.faq.q2.answer', 'כן. אחרי ההפעלה הפניות יוצאות לפי נקודות הזמן שעוד נותרו עד האירוע בלוח השליחה — ולא בשבת, בחג או בלילה. נקודת זמן שכבר עברה לא נשלחת באיחור.'),
      },
      {
        q: t('site.eventType.brit.faq.q3.question', 'האם אותו דבר מתאים לבריתה?'),
        a: t('site.eventType.brit.faq.q3.answer', 'כן. בריתה, זבד הבת וברית מילה מנוהלים באותו אופן: אירוע, רשימת מוזמנים ומעקב תשובות. ההבדל היחיד הוא בדרך כלל שיש יותר זמן להתארגן.'),
      },
    ],
  };
}

function generalEventCopy(t: TFunction<'public'>): EventTypeCopy {
  return {
    title: t('site.eventType.event.meta.title', 'אישורי הגעה לאירוע — עסקי, משפחתי או כנס'),
    description: t('site.eventType.event.meta.description', 'ניהול אישורי הגעה לאירוע עסקי, כנס או אירוע משפחתי: רשימה מדויקת לכניסה, חלוקה לקבוצות, תזכורות אוטומטיות ודוח למארגן.'),
    navLabel: t('site.eventType.event.navLabel', 'אירועים וכנסים'),
    h1: t('site.eventType.event.hero.title', 'אישורי הגעה לאירוע'),
    lede: t('site.eventType.event.hero.lede', 'כנס, ערב חברה או אירוע משפחתי גדול — כשיש קיבולת מוגבלת, רשימה מדויקת שווה יותר מהערכה.'),
    eyebrow: t('site.eventType.event.challenges.eyebrow', 'למה אירוע מאורגן שונה'),
    challengesTitle: t('site.eventType.event.challenges.title', 'מה שמארגן אירוע צריך ולא תמיד מקבל'),
    challenges: [
      {
        title: t('site.eventType.event.challenges.c1.title', 'קיבולת שאי אפשר לחרוג ממנה'),
        d: t('site.eventType.event.challenges.c1.body', 'לאולם או לחדר יש מספר מקומות סופי. מעקב רציף אחרי מספר המאשרים מונע גילוי מאוחר מדי שנרשמו יותר מדי.'),
      },
      {
        title: t('site.eventType.event.challenges.c2.title', 'רשימה מדויקת לכניסה'),
        d: t('site.eventType.event.challenges.c2.body', 'ברשימת כניסה, "בערך" לא עובד. הרשימה המעודכנת זמינה בכל רגע, בלי לייצא גרסה שמתיישנת מיד.'),
      },
      {
        title: t('site.eventType.event.challenges.c3.title', 'קבוצות ומחלקות'),
        d: t('site.eventType.event.challenges.c3.body', 'חלוקה לקבוצות מאפשרת לסנן את הרשימה לפי מחלקה או לפי סוג מוזמן, ולראות בדיוק מי מכל קבוצה עוד לא ענה.'),
      },
      {
        title: t('site.eventType.event.challenges.c4.title', 'דוח שאפשר להעביר הלאה'),
        d: t('site.eventType.event.challenges.c4.body', 'סיכום מספרים ברור למי שמזמין את האוכל, מנהל את הכניסה או צריך לדווח הלאה.'),
      },
    ],
    guideTitle: t('site.eventType.event.guide.title', 'המדריך לאישורי הגעה לאירוע מאורגן'),
    guide: [
      {
        h: t('site.eventType.event.guide.g1.heading', 'איך שומרים על קיבולת'),
        p: t('site.eventType.event.guide.g1.body', 'מגדירים לכל הזמנה כמה אנשים היא כוללת. בטופס האישור אי אפשר לאשר יותר מהמספר הזה, ותשובה בוואטסאפ שחורגת ממנו מסומנת לבעל האירוע — כך חריגה מהקיבולת מתגלה מוקדם ולא בכניסה.'),
      },
      {
        h: t('site.eventType.event.guide.g2.heading', 'מה עושים עם "אולי"'),
        p: t('site.eventType.event.guide.g2.body', 'מוזמן יכול לענות "אולי", והתשובה הזאת נשמרת בנפרד מ"מגיע" ומ"לא מגיע". כך רואים כמה מקומות עדיין לא ודאיים, ולא סופרים אותם בטעות כמאושרים.'),
      },
      {
        h: t('site.eventType.event.guide.g3.heading', 'אירוע עסקי: מי הזמין את מי'),
        p: t('site.eventType.event.guide.g3.body', 'בכנס או בערב חברה המוזמנים מגיעים ממחלקות, מלקוחות ומשותפים. קבוצה לכל מקור מאפשרת לסנן את הרשימה ולראות מי מכל אחד מהם אישר, ומוזמן יכול לצרף הערה — למשל שם של מי שיגיע במקומו.'),
      },
    ],
    timingTitle: t('site.eventType.event.timing.title', 'מה עושים ומתי'),
    timing: [
      t('site.eventType.event.timing.t1', 'הודעה ראשונה על התאריך בערוצים הרגילים של הארגון — לפי גודל האירוע.'),
      t('site.eventType.event.timing.t2', 'בניית הרשימה, חלוקה לקבוצות וקביעת כמות לכל הזמנה — לפני הפעלת אישורי ההגעה.'),
      t('site.eventType.event.timing.t3', 'סגירת רשימת הכניסה — אחרי ההודעה האחרונה בסבב, מהתמונה המעודכנת.'),
    ],
    faq: [
      {
        q: t('site.eventType.event.faq.q1.question', 'אפשר לחלק את המוזמנים לקבוצות?'),
        a: t('site.eventType.event.faq.q1.answer', 'כן. כל מוזמן יכול להשתייך לקבוצה — מחלקה, סוג מוזמן או כל חלוקה אחרת — ואפשר לסנן את רשימת המוזמנים לפי קבוצה ולפי סטטוס התשובה.'),
      },
      {
        q: t('site.eventType.event.faq.q2.question', 'איך יודעים כמה אנשים באמת יגיעו?'),
        a: t('site.eventType.event.faq.q2.answer', 'כל מוזמן מדווח בעצמו כמה אנשים ההזמנה שלו מכסה, והמספר מתעדכן בזמן אמת. מי שטרם השיב ומי שענה "אולי" מוצגים בנפרד, כך שברור כמה מהמספר עדיין לא ודאי.'),
      },
      {
        q: t('site.eventType.event.faq.q3.question', 'מה קורה אם מוזמן מנסה לאשר יותר אנשים ממה שהוזמן?'),
        a: t('site.eventType.event.faq.q3.answer', 'אם הוגדרה כמות להזמנה, טופס האישור לא מאפשר לחרוג ממנה. תשובה בוואטסאפ עם מספר גבוה יותר נשמרת ומסומנת לבעל האירוע, שמחליט מה לעשות.'),
      },
    ],
  };
}

export const EVENT_TYPES: readonly EventTypeRoute[] = [
  { slug: 'wedding', path: '/wedding' },
  { slug: 'bar-mitzva', path: '/bar-mitzva' },
  { slug: 'brit', path: '/brit' },
  { slug: 'event', path: '/event' },
];

const COPY: Record<EventTypeSlug, (t: TFunction<'public'>) => EventTypeCopy> = {
  wedding: weddingCopy,
  'bar-mitzva': barMitzvaCopy,
  brit: britCopy,
  event: generalEventCopy,
};

export function getEventTypeContent(slug: EventTypeSlug, t: TFunction<'public'>): EventTypeContent {
  const found = EVENT_TYPES.find((e) => e.slug === slug);
  // Unreachable via the four page files (each passes a literal slug), but a
  // typo in a future page would otherwise render an empty page rather than
  // fail the build.
  if (!found) throw new Error(`unknown event type: ${slug}`);
  return { ...found, ...COPY[slug](t) };
}
