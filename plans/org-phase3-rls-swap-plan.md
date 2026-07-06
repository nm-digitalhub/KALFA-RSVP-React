# שלב 3 — החלפת מדיניות RLS של אירועים: מבעלים־בלבד לחברוּת בארגון

**תאריך:** 2026-07-05 · **סטטוס:** תוכנית — ממתין לאישור מפורש לפני מימוש.
**רקע:** שלבי הרב־ארגוניות 1–2 + ממשק הצוות חיים בייצור; ההזמנה של החבר הראשון
(yaakov7676@gmail.com, תפקיד member) כבר נוצרה. בלי שלב 3 חבר מחובר רואה רשימת
אירועים ריקה — מדיניות ה־RLS עדיין `owner_id = auth.uid()` / `owns_event()`.

**כל עובדה כאן אומתה מול המסד החי (pg_policies / pg_get_functiondef / ספירות)
ומול הקוד — 2026-07-05.**

---

## 1. מצב קיים (מאומת)

### 1.1 תשתית שכבר קיימת ותקינה
- `can_access_event(_event_id, _resource default 'events', _action default 'view')`
  — SECURITY DEFINER, STABLE: בעלים **או** (יש `org_id` **וגם**
  `has_org_permission(org_id, resource, action)`). זו בדיוק הסמנטיקה הנדרשת —
  לא צריך פונקציה חדשה.
- `events.org_id`: **0 שורות NULL מתוך 5** — ה־backfill שלם; אין מקרה קצה של
  אירוע חסר־ארגון.
- הרשאות תפקיד **member** (מהקטלוג החי): guests/contacts/campaigns/events —
  view+create+edit (בלי delete); billing/reports/members/organization — view
  בלבד. **viewer** — view בלבד. אין לאף תפקיד שאינו-בעלים הרשאות מחיקה או כסף.
- שכבת האפליקציה: `requireEventAccess(eventId, resource, action)` כבר קיימת
  (`src/lib/data/events.ts:57`, שלב 2) לצד `requireOwnedEvent` (בעלים־בלבד).

### 1.2 המדיניות שיש להחליף — 14 policies ב־13 טבלאות (נוסח חי, מ־pg_policies)

| טבלה | policy | cmd | תנאי היום |
|---|---|---|---|
| events | events_owner_all | ALL | `owner_id = auth.uid()` |
| events | events_admin_all | ALL | `has_role(auth.uid(),'admin')` — **לא נוגעים** |
| guests | guests_owner | ALL | `owns_event(event_id)` |
| guest_groups | gg_owner | ALL | `owns_event(event_id)` |
| event_questions | eq_owner | ALL | `owns_event(event_id)` |
| campaigns | camp_owner_select | SELECT | `owns_event(event_id)` |
| contacts | contacts_owner_select | SELECT | `owns_event(event_id)` |
| contact_interactions | contact_interactions_owner_select | SELECT | `event_id is not null and owns_event(event_id)` |
| rsvp_responses | rsvp_owner_read | SELECT | `owns_event(event_id)` |
| activity_log | al_owner_read | SELECT | `user_id = auth.uid() or owns_event(event_id)` |
| billed_results | billed_results_owner_select | SELECT | `owns_event(event_id)` |
| billing_credits | billing_credits_owner_select | SELECT | `owns_event(event_id)` |
| campaign_authorized_contacts | campaign_authorized_contacts_owner_select | SELECT | `owns_event(event_id)` |
| outreach_state | outreach_state_owner_select | SELECT | `owns_event(event_id)` |

### 1.3 מי באמת עובר דרך RLS
`guests.ts` (וכל מסכי הלקוח) קוראים עם ה־cookie client — RLS חל. נתיבי הכסף
וה־webhooks עובדים עם service-role (עוקף RLS) מאחורי שערי אפליקציה — ההחלפה
לא נוגעת בהם. `requireOwnedEvent` בשימוש ב־20 קבצים (עמודים, actions, ‏API).

---

## 2. עקרון העיצוב (ממשיך את מודל שני-הרבדים משלב 1)

- **RLS = בידוד דיירים מודע-הרשאות**: קריאה לפי `*.view`; כתיבה ב־RLS רק היכן
  שיש verb לחבר (guests/groups: create/edit). **בלי** הרחבת מחיקה/כסף.
- **DAL = אכיפת פעלים**: העמודים וה־actions עוברים מ־`requireOwnedEvent`
  ל־`requireEventAccess(resource, action)` — רק בנתיבים שחבר אמור להשתמש בהם.
- **כל נתיב מסחרי/מחזור-חיים נשאר בעלים-בלבד בשני הרבדים** (v1): אישור/ביטול
  קמפיין, J5/close-charge/whatsapp-send, פרסום/סגירה/מחיקת אירוע, הסכמים.

## 3. שינוי ה־RLS (מיגרציה אחת, M1)

מיפוי resource/action לכל policy (החלפה בלבד — `events_admin_all` לא נגוע):

| טבלה | SELECT חדש | כתיבה חדשה |
|---|---|---|
| events | `can_access_event(id,'events','view')` | UPDATE: `can_access_event(id,'events','edit')` + WITH CHECK זהה; INSERT/DELETE: בעלים בלבד (כמו היום) |
| guests | `…(event_id,'guests','view')` | INSERT `'guests','create'`; UPDATE `'guests','edit'`; DELETE `owns_event` בלבד |
| guest_groups | כמו guests | כמו guests |
| event_questions | `…('events','view')` | writes `…('events','edit')`; DELETE בעלים |
| campaigns | `…('campaigns','view')` | — (אין policy כתיבה גם היום) |
| contacts / contact_interactions | `…('contacts','view')` (+שימור תנאי ה־NOT NULL) | — |
| rsvp_responses | `…('guests','view')` | — |
| activity_log | `user_id = auth.uid() OR …('events','view')` | — |
| billed_results / billing_credits | `…('billing','view')` | — |
| campaign_authorized_contacts / outreach_state | `…('campaigns','view')` | — |

כללי מימוש: `DROP POLICY` + `CREATE POLICY` (אין CREATE OR REPLACE ל־policy);
סדר fail-safe — יצירת policy חדש לפני הפלת הישן איננה אפשרית לאותו שם, לכן
כל טבלה מוחלפת בתוך המיגרציה כשהיא עטופה בטרנזקציית ה־push; `owns_event`
נשארת (בשימוש ב־DELETE ובקוד); ביצועים — אותו דפוס קריאה ישירה כמו היום
(אופטימיזציית `(select …)` initplan — שיפור אופציונלי נפרד, לא בהיקף).

## 4. שינוי שכבת האפליקציה (A1 — נתיבי חבר בלבד)

| קובץ | היום | ל־ |
|---|---|---|
| guests/page.tsx, ‏[guestId]/page.tsx | requireOwnedEvent | requireEventAccess('guests','view') |
| guests/new + guests-actions (create/edit) | requireOwnedEvent | requireEventAccess('guests','create'/'edit') |
| import/page.tsx + import-actions + template/route.ts | requireOwnedEvent | requireEventAccess('guests','create') |
| דף האירוע (תצוגה) + לוח קמפיין (קריאה) | requireOwnedEvent | requireEventAccess('events'/'campaigns','view') |
| updateEvent (עריכת פרטים) | requireOwnedEvent | requireEventAccess('events','edit') — כל שערי התאריכים/נעילה נשארים |
| **ללא שינוי (בעלים):** publish/close/delete, campaign-actions, authorize/whatsapp-send/close-charge, payment/approve, agreements, celebrants-unlock predicate | | |

## 5. בדיקות ואימות

1. **PG16 מבודד (לפני push):** מטריצת גישה — בעלים / member / viewer / זר /
   חבר-בארגון-אחר × קריאה/כתיבה על guests, events, campaigns, billing —
   כולל שלילים (זר=0 שורות; viewer לא כותב; member לא מוחק ולא רואה ארגון זר).
2. **vitest:** בדיקות accessor חדשות + רגרסיה מלאה (862+).
3. **אימות חי אחרי deploy:** (א) שאילתות pg_policies — הנוסח החדש בדיוק;
   (ב) `db advisors` — נקי; (ג) בדיקה אמיתית עם יעקב (member): רואה את אירוע
   הברית + מוזמנים, מוסיף מוזמן; (ד) שלילי: משתמש טרי ללא ארגון — רשימה ריקה;
   (ה) בעלים — שום שינוי התנהגות.

## 6. סיכונים ו־rollback

- **סיכון עיקרי — חשיפה חוצת-דיירים.** מיתון: התנאי החדש תמיד דרך
  `can_access_event` (בעלים ∨ חברות+הרשאה); מטריצת שלילים ב־PG16 מבודד לפני
  ה־push; אימות חי שלילי אחרי.
- **סיכון משני — שבירת בעלים.** `can_access_event` מחזיר true לבעלים תמיד
  (גם בלי org) — רגרסיית בעלים מכוסה במטריצה.
- **Rollback:** מיגרציית-קדימה שמשחזרת מילולית את 14 ה־policies המקוריים
  (הנוסחים שמורים בסעיף 1.2) — ללא איבוד נתונים; אפליקציה: revert deploy.

## 7. סדר ביצוע ושערים

1. **M1** — מיגרציה + מבחני PG16 מבודד ⇒ **שער אישור לפני `db push`** (נגיעה
   ב־RLS חי).
2. **A1** — החלפת accessors + vitest ⇒ deploy אחד יחד עם M1 (back-to-back).
3. **V1** — אימות חי (סעיף 5.3) + runbook `org_multitenancy_phase3.md` + עדכון
   זיכרון/תיעוד. הערכת היקף כוללת: יום עבודה.
