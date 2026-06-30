# קונבנציה — RSVP מכפתורי-WhatsApp (payloads)

> מקור-קונבנציה: `plans/webhook-ui-wiring-plan.md §C9`,
> `plans/whatsapp-webhook-hardening-spec.md §7`.
> מצב-קוד: `src/lib/whatsapp/inbound.ts`, `src/lib/data/webhook-processing.ts`.

כשאורח עונה ב-quick-reply ("מגיע / לא מגיע / אולי") על template-WhatsApp, Meta שולחת
**הודעה נכנסת** הנושאת את **מזהה-הכפתור** (`payload`/`id`) — לא רק את הטקסט. כדי למפות
תגובה כזו ל-RSVP, מזהה-הכפתור חייב לעקוב אחר קונבנציה קבועה.

## חוזה ה-payloads (חובה ב-template ב-WABA)

הכפתורים ב-template המאושר ב-WABA חייבים להשתמש ב-payloads הקבועים האלה:

| כוונה | payload | `guests.status` |
|---|---|---|
| מגיע | `rsvp_attending` | `attending` |
| לא מגיע | `rsvp_declined` | `declined` |
| אולי | `rsvp_maybe` | `maybe` |

זהו צעד **תפעולי** (יצירת/אישור ה-template ב-WABA עם ה-payloads האלה) — באותה קטגוריה של
חיבור-Meta שכבר בוצע, לא פריט-קוד.

## איך Meta מעבירה את המזהה (שתי צורות)

- **template quick-reply** → הודעה מסוג `type:"button"` עם `button.payload`.
- **interactive reply** → `interactive.button_reply.id` (או `list_reply.id`).

המסווג ימפה דרך `replyId = button.payload ?? button_reply.id ?? list_reply.id`, ואז דרך
`RSVP_BUTTON_MAP = { rsvp_attending:'attending', rsvp_declined:'declined', rsvp_maybe:'maybe' }`.

## עיבוד (מומש — Stage 6 / C9)

בהינתן `replyId` תואם **ויש שיוך-לאורח** (`resolveByContextId(context.id)`, ובמעבר
ל-`resolveGuestByContact(contact_id, event_id)` → `guests.rsvp_token`) → רישום ה-RSVP דרך
ה-RPC הקיים **`submit_rsvp`** (service_role, אטומי, מאמת מצב-אירוע/דדליין) — בלי לשכפל
לוגיקה ובלי זיהוי-אורח-לפי-טלפון לפעולה מחייבת. `attending` שולח לפחות מבוגר אחד
(submit_rsvp דוחה 0); `declined/maybe` ללא ספירה. סטטוס-האורח המעודכן משתקף ברשימת-האורחים,
ב-timeline, ובספירת ה-RSVP הקיימת. נרשם marker PII-free `rsvp.from_whatsapp` ב-`activity_log`.

## ✅ מצב-קוד נוכחי — מומש ונפרס (Stage 6 / C9, commit f0d67b8, 2026-06-30)

המסווג (`classifyMessagePayload` ב-`src/lib/whatsapp/inbound.ts`) חושף כעת `replyId`
(`extractReplyId` = `button.payload ?? button_reply.id ?? list_reply.id`) ומחזיר
`{ billable, removal, replyId }`. ב-`webhook-processing.ts` קיים `RSVP_BUTTON_MAP` והחיווט
ל-`submit_rsvp` דרך `resolveGuestByContact`, ה-gated על `fresh` כדי ש-retry של Meta לא
ירשום פעמיים. מכוסה ב-`webhook-processing.test.ts` (describe "RSVP from a quick-reply
button (C9)"). תגובת-כפתור נספרת גם כ"reach" (חיוב, כמקודם) **וגם** נרשמת כ-RSVP.

## התלות התפעולית היחידה שנותרה (לא פריט-קוד)

הקוד מחובר קצה-לקצה, אך כדי שלחיצת-כפתור תהפוך ל-RSVP **בפרודקשן** נדרשים שני צעדים
תפעוליים בצד Meta (אותה קטגוריה של חיבור-Meta, לא קוד):
1. ה-template המאושר ב-WABA חייב לשאת quick-reply buttons עם ה-payloads מהטבלה למעלה
   (`rsvp_attending`/`rsvp_declined`/`rsvp_maybe`). `sendTemplate` שולח לפי שם-template
   בלבד — ה-payloads מוגדרים בתבנית הרשומה אצל Meta, לא בקוד-השליחה.
2. מנוי ה-webhook של אפליקציית Meta ל-`messages` חייב להיות פעיל (ראו `docs/admin-webhooks-runbook.md`).
