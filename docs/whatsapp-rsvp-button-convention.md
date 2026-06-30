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

## עיבוד (מתוכנן)

בהינתן `replyId` תואם **ויש שיוך-לאורח** (`resolveByContextId(context.id)` → `guest_id`,
ומשם `guests.rsvp_token`) → רישום ה-RSVP דרך ה-RPC הקיים **`submit_rsvp`** (service_role,
אטומי, מאמת מצב-אירוע/דדליין) — בלי לשכפל לוגיקה ובלי טוקן-RSVP ציבורי בתוך ה-webhook,
ובלי זיהוי-אורח-לפי-טלפון לפעולה מחייבת. סטטוס-האורח המעודכן משתקף ברשימת-האורחים,
ב-timeline, ובספירת ה-RSVP הקיימת. נרשם `logActivity('rsvp.from_whatsapp')`.

## ⚠️ מצב-קוד נוכחי — טרם מומש (Stage 6 / C9)

נכון לעכשיו המסווג (`classifyMessagePayload` ב-`src/lib/whatsapp/inbound.ts`) קורא רק את
**`button_reply.title`** (טקסט-תצוגה) ומחזיר `{ billable, removal }` בלבד — הוא **אינו**
חושף `replyId` ו**אין** `RSVP_BUTTON_MAP`. כלומר תגובת-כפתור כיום נספרת כ"reach" (חיוב)
אך **לא** נרשמת כ-RSVP.

ההשלמה (הרחבת `InboundMessagePayload` + המסווג לחשיפת `replyId`, הוספת `RSVP_BUTTON_MAP`,
וחיווט ב-`webhook-processing.ts` → `submit_rsvp`) היא **Stage 6 / C9** בתוכנית ועדיין לא
נבנתה. מסמך זה מגדיר את החוזה שה-template חייב לעמוד בו כדי ש-Stage 6 יעבוד; אין להניח
שהמיפוי קיים בקוד.
