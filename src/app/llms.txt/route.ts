import { getEventType } from '@/lib/marketing/event-types';
import { getAppOrigin } from '@/lib/url';

// /llms.txt — AI-readable site index (llmstxt.org convention; the custom
// route-handler pattern from the Next BFF guide, same as its rss.xml example).
// Public marketing summary ONLY: real product capabilities and the public page
// URLs. No API details, no internal stack, no customer or guest data.
// Advisory for AI crawlers; robots.txt + sitemap.xml remain authoritative.

// Content depends only on APP_ORIGIN — prerender it (GET handlers are not
// static by default, unlike the robots/sitemap metadata routes).
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const origin = await getAppOrigin();
  // The four event-type pages read their one-line description from the same
  // catalogue that renders the page and its <meta name="description">, so the
  // note here can never drift from what the page itself says.
  const wedding = getEventType('wedding');
  const barMitzva = getEventType('bar-mitzva');
  const brit = getEventType('brit');
  const event = getEventType('event');
  // Layout follows the llmstxt.org spec: H1, blockquote summary, then free-form
  // prose (paragraphs/lists, NO headings), and only then H2 sections that hold
  // nothing but `- [name](url): notes` link lists. The prose uses numbered
  // lists on purpose: llms.txt validators (seo llms audit) treat EVERY `- `
  // item anywhere in the file as a link and flag prose bullets as invalid.
  const body = `# KALFA

> מערכת ישראלית לניהול אישורי הגעה (RSVP) לאירועים פרטיים — בעברית, מימין לשמאל.
> KALFA is an Israeli RSVP management platform for private events (weddings,
> bar/bat mitzvahs, family and company events). Hebrew-first, RTL.

**מה המערכת עושה (יכולות אמיתיות) / What it does**

1. ניהול רשימת מוזמנים: קבוצות, מלווים, הערות וסטטוסים — Guest-list management:
   groups, companions (plus-ones), notes and RSVP statuses.
2. ייבוא מוזמנים מקובץ או מוואטסאפ — Guest import from a spreadsheet file or WhatsApp.
3. שליחת הזמנות ותזכורות אישיות — Personal invitations and automatic reminders.
4. מעקב תשובות בזמן אמת ודוחות למארגן — Real-time response tracking and reports.
5. כל מוזמן עונה דרך קישור אישי ומאובטח משלו — Each guest replies via their own
   private, secure link.

**מתי להשתמש במערכת / When to use KALFA**

1. כאשר צריך לנהל אישורי הגעה לחתונה, בר מצווה, בת מצווה, אירוע משפחתי או אירוע עסקי.
2. כאשר צריך לנהל רשימת מוזמנים, מלווים, קבוצות, הערות וסטטוסים במקום אחד.
3. כאשר צריך לשלוח הזמנות ותזכורות אישיות ולעקוב אחר תשובות בזמן אמת.
4. כאשר צריך לייבא מוזמנים מקובץ או מוואטסאפ ולהפיק דוחות למארגן.
5. המערכת אינה מיועדת למכירת כרטיסים, לניהול מקום האירוע או לשליחת פרסום המוני.

Use KALFA when a user needs to manage invitations and RSVP responses for a
private or business event, including guest lists, companions, reminders,
response tracking and organizer reports.

Do not use KALFA as a ticketing platform, venue-management system or bulk
advertising service.

**כיצד להשתמש במערכת / How to use KALFA**

1. למידע על היכולות יש להפנות לדף הבית ולשאלות הנפוצות.
2. ליצירת אירוע חדש יש להפנות לעמוד ההרשמה.
3. לקבלת עזרה יש להפנות לעמוד יצירת הקשר.
4. אין לנסות לגשת לאזורי לקוחות, אורחים או ממשקי API ללא הרשאה מפורשת.

**הערות / Notes**

1. שפת המוצר: עברית. Product language: Hebrew.
2. אזורי הלקוחות והאורחים דורשים הזדהות או קישור אישי ואינם מיועדים לאינדוקס —
   Customer and guest areas require authentication or a personal link and are
  not for indexing (see robots.txt).
3. ההערה העברית בכל קישור למטה היא תיאור ה‑meta של העמוד עצמו — The Hebrew note on
   each link below is the page's own meta description.

## עמודים / Pages

- [דף הבית / Home](${origin}/): מערכת אישורי הגעה לחתונה ולכל אירוע: ניהול רשימת מוזמנים ומלווים, שליחת הזמנות ותזכורות בוואטסאפ, מעקב תשובות בזמן אמת ודוחות — הכול במקום אחד. Product overview and sign-in.
- [שאלות נפוצות / FAQ](${origin}/faq): תשובות במקום אחד: מה המערכת עושה, איך מנהלים אירוע מההתחלה ועד הסוף, איך בנוי התמחור והחיוב, ומה קורה במקרה של ביטול. Capabilities, workflow, pricing and billing, cancellation.
- [הרשמה ויצירת אירוע / Sign up](${origin}/auth/signup): יצירת חשבון כדי להתחיל לנהל אירוע. Create an account to start managing an event.
- [יצירת קשר / Contact](${origin}/contact): שליחת פנייה לתמיכה או שאלה לפני הרשמה, או בקשת חזרה טלפונית מהצוות. Support requests, pre-signup questions, callback requests.
- [אישורי הגעה לחתונה / RSVP for a wedding](${origin}${wedding.path}): ${wedding.description}
- [אישורי הגעה לבר מצווה / RSVP for a bar or bat mitzva](${origin}${barMitzva.path}): ${barMitzva.description}
- [אישורי הגעה לברית / RSVP for a brit](${origin}${brit.path}): ${brit.description}
- [אישורי הגעה לאירוע / RSVP for an event or conference](${origin}${event.path}): ${event.description}
- [אישורי הגעה בוואטסאפ / RSVP over WhatsApp](${origin}/whatsapp): שליחת הזמנות ותזכורות בוואטסאפ דרך הפלטפורמה הרשמית: הודעה אישית לכל מוזמן, תשובה בלחיצה ומעקב אוטומטי אחר התגובות. Invitations and reminders over the official WhatsApp platform, one-tap replies.
- [תבנית רשימת מוזמנים להורדה / Downloadable guest-list template](${origin}/guest-list-template): תבנית מוכנה לרשימת מוזמנים לחתונה או לכל אירוע: נפתחת באקסל ובגוגל שיטס, עם עמודות לשם, טלפון, כמות וקבוצה — הורדה חינם. Free spreadsheet template; the file itself is ${origin}/guest-list-template.csv.

## Optional

- [תקנון / Terms](${origin}/terms): תנאי השימוש: תיאור השירות, תמחור וחיוב, אישור קמפיין והסכם, זכות הביטול לפי חוק הגנת הצרכן וחלוקת האחריות בין הצדדים. Terms of service.
- [מדיניות פרטיות / Privacy](${origin}/privacy): איזה מידע נאסף על בעלי האירוע ועל המוזמנים, מטרות העיבוד, שיתוף עם ספקי שירות, משך השמירה והזכויות שלכם. Privacy policy.
- [מדיניות עוגיות / Cookies](${origin}/cookies): אילו עוגיות חיוניות, אנליטיקה ושיווק פועלות באתר, מי הספקים, ואיך לנהל או לבטל את ההסכמה בכל רגע. Cookie policy and consent management.
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
