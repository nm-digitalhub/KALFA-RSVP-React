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
  const body = `# KALFA

> מערכת ישראלית לניהול אישורי הגעה (RSVP) לאירועים פרטיים — בעברית, מימין לשמאל.
> KALFA is an Israeli RSVP management platform for private events (weddings,
> bar/bat mitzvahs, family and company events). Hebrew-first, RTL.

## מה המערכת עושה (יכולות אמיתיות) / What it does

- ניהול רשימת מוזמנים: קבוצות, מלווים, הערות וסטטוסים — Guest-list management:
  groups, companions (plus-ones), notes and RSVP statuses.
- ייבוא מוזמנים מקובץ או מוואטסאפ — Guest import from a spreadsheet file or WhatsApp.
- שליחת הזמנות ותזכורות אישיות — Personal invitations and automatic reminders.
- מעקב תשובות בזמן אמת ודוחות למארגן — Real-time response tracking and reports.
- כל מוזמן עונה דרך קישור אישי ומאובטח משלו — Each guest replies via their own
  private, secure link.

## עמודים / Pages

- [דף הבית / Home](${origin}/)
- [יצירת קשר / Contact](${origin}/contact)
- [תקנון / Terms](${origin}/terms)
- [מדיניות פרטיות / Privacy](${origin}/privacy)
- [מדיניות עוגיות / Cookies](${origin}/cookies)

## הערות / Notes

- שפת המוצר: עברית. Product language: Hebrew.
- אזורי הלקוחות והאורחים דורשים הזדהות או קישור אישי ואינם מיועדים לאינדוקס —
  Customer and guest areas require authentication or a personal link and are
  not for indexing (see robots.txt).
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
