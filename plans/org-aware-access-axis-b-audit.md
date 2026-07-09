# Axis B — Org-aware access: owner-only leftovers audit (backlog)

**Status:** אבחון בלבד — backlog. **אין לתקן כאן:** אין קוד, אין migration, אין החלפת `requireOwnedEvent`→`requireEventAccess`. מסמך זה ממפה ומדרג בלבד.

**נוצר:** 2026-07-08 · **מקור:** אבחון "מדוע יעקב לא יכול לערוך פרמטרי אירוע" שהתרחב מעבר ל-events.

**תיקון ה-events (מחוץ למסמך זה):** באג עריכת פרמטרי-האירוע (`show_meal_pref` grant + `updateEvent` owner_id filter) מטופל בנפרד ב-`docs/event-edit-permission-fix-plan-2026-07-08.md`. מסמך זה = כל שאר המופעים.

---

## הדפוס (root pattern)

הרולאאוט של ריבוי-הדיירים (Phase 1–3) הפך **קריאות** ואת נתיב עריכת האירוע/המוזמן העיקרי ל-org-aware:
- קטלוג הרשאות עם פעלים granular: `events.{create,edit,delete,view}`, `guests.{…}`, `contacts.{create,edit,delete,view}`, `campaigns.{create,edit,delete,manage,view}`, `billing.view`, `reports.view`, `members.{manage,view}`, `organization.{edit,manage,view}`.
- שער org-aware `requireEventAccess(eventId, resource, action)` → `can_access_event()` (owner OR חבר-ארגון עם ההרשאה).
- מדיניות RLS org-aware (Phase 3, `20260705115539`): SELECT/UPDATE של events+guests, ועוד.

**אבל** שורה ארוכה של mutations + כל דומיין ה-contacts/interactions/rsvp נשארו על השער הישן `requireOwnedEvent(eventId)` (owner-only, `owner_id = auth.uid()`). קבצי ה-`*-actions.ts` מאצילים הרשאה לפונקציות שכבת-הנתונים; פעולה יחידה קוראת לכמה — חלקן org-aware (עוברות) וחלקן owner-only (נופלות). כך גם **קו-אונר בעל כל ההרשאות (כמו יעקב) חסום או נשבר**.

בסיס-הראיות: הבאג ב-`updateEvent` הוכח אמפירית — RLS לבדו מתיר לחבר-ארגון עם `events.edit` (rows_touched=1), והמסנן `.eq('owner_id', user.id)` באפליקציה הוא שחסם. אותו היגיון חל על מופעי `requireOwnedEvent` שלמטה: RLS ה-SELECT כבר org-aware, אבל השער owner-only חוסם.

---

## 1. זרימות שבורות בפועל (org-aware מתחיל → owner-only בפנים → 404 באמצע)

חבר-ארגון עובר את השלב הראשון ואז הפעולה קורסת. הגבוה בחומרה — נראה למשתמש כתקלה, לא ככפתור מוסתר.

| # | זרימה | נתיב org-aware שעובר | קריאה owner-only שנשברת | קבצים |
|---|---|---|---|---|
| B1 | **ייבוא מוזמנים מוואטסאפ** | `requireEventAccess('guests','create')` @ `guests/import/whatsapp/actions.ts:61,191` | `buildContactsForEvent` → `requireOwnedEvent` @ `contacts.ts:64` | `whatsapp/actions.ts:152` |
| B2 | **ייבוא מוזמנים מקובץ** | `bulkInsertGuests` → `requireEventAccess('guests','create')` @ `guests.ts:767` | `buildContactsForEvent` → `requireOwnedEvent` @ `contacts.ts:64` | `import/import-actions.ts:277` |
| B3 | **דף פרטי מוזמן** | `requireEventAccess('guests','view')` @ `guests/[guestId]/page.tsx:36` | `getGuestOutreachSummary` + `listInteractionsForContact` → `requireOwnedEvent` @ `interactions.ts:256,293` | `[guestId]/page.tsx:42,53` |
| B4 | **יצירת מוזמן עם טלפון** | `createGuest` → `requireEventAccess('guests','create')` @ `guests.ts:401` | `linkGuestContact` → `requireOwnedEvent` @ `contacts.ts:122` | `guests-actions.ts:93` |

**השפעה:** לחבר-ארגון (כולל קו-אונר) — ייבוא מוזמנים קורס, דף פרטי-מוזמן מציג 404, ויצירת מוזמן עם מספר טלפון נכשלת. B3 חמור במיוחד: השער של הדף עצמו עובר, אבל תת-שאילתות ה-outreach מפילות את כל הדף ל-404.

---

## 2. תכונות חסומות אך לא בהכרח "שבורות" (RLS org-aware + פֶעֶל בקטלוג — יעבוד אם יוחלף השער)

owner-only חוסם, אבל ה-RLS ה-SELECT/UPDATE כבר org-aware והפֶעֶל קיים בקטלוג. נראה כ"אין הרשאה" ולא כתקלה. החלפת `requireOwnedEvent`→`requireEventAccess(resource,action)` לבדה מספיקה (RLS כבר מתיר).

| # | פעולה | קובץ | פֶעֶל נדרש | הערה |
|---|---|---|---|---|
| B5 | `updateContactStatus` (quick-action ברשימה) | `guests.ts:560` (מ-`guests-actions.ts:186`) | `guests.edit` | לא-עקבי מול `updateGuest` (`guests.ts:461`) ש**כן** org-aware — אותה פעולה לוגית, שער שונה |
| B6 | `listContacts` | `contacts.ts:229` | `contacts.view` | RLS `contacts_org_select` כבר org-aware |
| B7 | `countUniqueContactsForEvent` | `contacts.ts:217` | `contacts.view` | נקרא גם מתוך זרימת קמפיין owner-only (שם עקבי); כפעולה עצמאית — חסום |
| B8 | `listInteractionsForContact` / `getGuestOutreachSummary` | `interactions.ts:256,293` | `contacts.view`/`guests.view` | (זהה ל-B3 — אלו הפונקציות שמפילות את דף המוזמן) |
| B9 | ניהול קישור RSVP: `getRsvpLinkInfo` / `revokeRsvpToken` / `regenerateRsvpToken` | `rsvp.ts:204,224,245` (מ-`guests-actions.ts:273,289`) | `guests.edit`/`view` | פעולות רגישות (מבטלות/מרעננות קישור אישי) — ראה §4 |

---

## 3. owner-only מכוון — **לא באג**

הקטלוג נותן ל-`billing` **`view` בלבד** (אין `charge`/`manage`). כל נתיבי החיוב/ההסכמה owner-anchored במכוון — הבעלים הוא בעל-החשבון שחותם על ההסכם ומאשר חיוב.

| פעולה | קובץ | נימוק |
|---|---|---|
| `recordCampaignHold` / `prepareCampaignHold` / hold-charge/authorize | `campaigns.ts` (502, 617, 645…), `api/campaigns/[id]/{authorize,close-charge}/route.ts` | J5 hold / חיוב בפועל — הסכמת בעלים |
| `agreements` (יצירה/הורדה) | `agreements.ts:104`, `campaign/[campaignId]/agreement/route.ts:22` | מסמך משפטי-כספי, מעוגן לבעלים |
| `payment` page | `campaign/[campaignId]/payment/page.tsx:55` | תשלום — owner-only |
| `publishEvent` / `closeEvent` | `events.ts:425,461` (service-role, `owner_id`) | lifecycle owner-only בשתי השכבות במכוון |

---

## 4. מקרים שדורשים החלטת-מוצר (לפני שמחליטים אם באג)

| # | פעולה | קובץ | ההכרעה הנדרשת |
|---|---|---|---|
| D1 | `createCampaign` | `campaigns.ts:131` | הפֶעֶל `campaigns.create` קיים בקטלוג — האם *יצירת* קמפיין ניתנת להאצלה למחזיק `campaigns.create`, או owner-only כי מובילה ל-billing? |
| D2 | `approveCampaign` | `campaigns.ts:305` | `campaigns.manage` קיים — האם אישור קמפיין ניתן להאצלה, או owner-only (הסכמת-חיוב)? |
| D3 | `cancelCampaign` | `campaigns.ts:761` | `campaigns.delete`/`manage` קיימים — האם ביטול ניתן להאצלה? |
| D4 | `deleteGuest` / `deleteGroup` | `guests.ts:512,724` | **דו-שכבתי:** גם RLS DELETE owner-only (`guests_owner_delete`/`gg_owner_delete`). הקטלוג מפרסם `guests.delete` אך אף שכבה לא מכבדת אותו לחבר. האם מחיקה ניתנת להאצלה? (דורש שינוי **גם** ב-RLS, לא רק בשער) |
| D5 | ניהול קישור RSVP (B9) | `rsvp.ts:204,224,245` | ביטול/רענון קישור מבטל קישורים שכבר נשלחו — האם `guests.edit` מספיק, או owner-only? |

---

## 5. המלצת סדר תיקון עתידי לפי סיכון

**עיקרון:** לתקן קודם את מה שנראה למשתמש כתקלה (broken flows), אחר-כך את התכונות החסומות, ולבסוף את מה שתלוי בהחלטת-מוצר. לכל שינוי שער — לוודא ש-RLS כבר org-aware (רוב §1–§2 כן), אחרת נדרש גם שינוי RLS (D4).

| עדיפות | פריטים | פעולה | סיכון תיקון |
|---|---|---|---|
| **P0 — broken flows** | B1, B2, B3, B4 | החלף `requireOwnedEvent`→`requireEventAccess` בפונקציות `buildContactsForEvent`, `linkGuestContact`, `listInteractionsForContact`, `getGuestOutreachSummary` עם ה-resource/action הנכון (`contacts`/`guests`, `view`/`create`). RLS SELECT כבר org-aware. | נמוך–בינוני — קריאות פנימיות; לוודא שאין הסתמכות על owner-only ל-billing |
| **P1 — blocked writes/reads** | B5, B6, B7, B8 | אותה החלפה. B5 (`updateContactStatus`) הכי בטוח — RLS `guests_org_update` org-aware, מקביל ל-`updateGuest`. | נמוך |
| **P2 — product-decision** | D1–D5 | להביא להכרעת-מוצר. D4 דורש **גם** שינוי מדיניות RLS DELETE. D1–D3 = מדיניות billing. | משתנה |
| **לא לגעת** | §3 | owner-only מכוון | — |

**הערות ליישום עתידי (כשיאושר):**
- כל החלפת שער חייבת בדיקת-יחידה מקבילה (כמו בתיקון ה-events): לאשש ש-`requireEventAccess(resource,action)` נקרא ושאין מסנן app-side נוסף.
- לאמת מול הקטלוג את זוג ה-(resource, action) המדויק לכל פונקציה — לא לנחש.
- D4 (מחיקה): אם מוחלט להאציל — צריך גם להחליף `guests_owner_delete`/`gg_owner_delete` ל-`can_access_event(...,'guests','delete')`, אחרת השער יעבור אך ה-RLS יפיל ל-0 שורות (בדיוק ההופכי של באג ה-events).
- לשקול איחוד: פונקציה עוזרת אחת שממפה gate→(resource,action) כדי למנוע הישנות הדפוס.

---

## נספח — מה **לא** נכלל (מכוסה מחוץ למסמך)
- `events.show_meal_pref` column-grant + `updateEvent` owner_id filter → `docs/event-edit-permission-fix-plan-2026-07-08.md`.
- ציר A (column-grant gaps) נבדק על כל הטבלאות ושני התפקידים: **`events.show_meal_pref` הוא המופע היחיד**; אין פער נוסף.
