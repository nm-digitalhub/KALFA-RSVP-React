# תוכנית — חיווט ה-Webhook (WhatsApp/Meta) ל-UI, מקצה-לקצה

מסמך-תכנון · v2 · 2026-06-30 · מצב: **לאישור לפני מימוש** · READ-ONLY עד אישור
עברית-ראשון · RTL · **כל סעיף סובב סביב ה-webhook של Meta בלבד** (אירועים נכנסים + status callbacks) ושיקוף האפקטים שלו.

---

## 0. מצב חי (אומת 2026-06-30) — אין יותר gate-תשתית

| תשתית | מצב |
|---|---|
| `webhook_inbox` + אינדקסים `unprocessed_idx` + `received_idx` | ✅ חי |
| RLS `webhook_inbox_admin_all` | ✅ חי |
| `contact_interactions.{guest_id, context_message_id, delivery_status, delivery_error_code}` | ✅ חי |
| `types.ts` עם `webhook_inbox` Row | ✅ |
| Pipeline persist-then-process פרוס · Meta **מחובר** (callback מאומת, GET→403) | ✅ |

**אילוצים מחייבים:**
1. **לא לגעת** ב-config של החיבור ב-`/admin/channels`: `whatsapp_phone_number_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`, `callbackUrl`. החיבור בוצע — read-only בלבד.
2. **לא לשכפל** את סיכום-החיוב הקיים (`getCampaignBillingSummary` כבר מוצג ב-`manage-client.tsx` + `campaign/[campaignId]/page.tsx`). מוסיפים רק את הפילוח ה-webhook-ספציפי (מסירה/opt-out/מספר-שגוי).
3. **לא לגעת** ב-`contact_status` (CRM) ובלוגיקת-החיוב (`recordReached`/RPC) — קיימים ונכונים.

**מקור-האמת לכל מסך = אות מ-Meta:**
- **inbound reply** → reach (חיוב) · opt-out · RSVP-מכפתור.
- **status callback** → `delivery_status` (sent/delivered/read/failed) · `wrong_number` (131026).

---

## חלק A — אדמין: בדיקת צינור-ה-webhook (4 מסכים)

> מבוסס על `plans/webhook-inspector-plan.md` (פירוט-UI/mockup שם — ללא כפילות). ה-gates של אותה תוכנית **נסגרו**; נשאר חיווט-UI טהור.

1. **רשימת `webhook_inbox`** — `/admin/webhooks/page.tsx` (server, יורש `requireAdmin` מהליאאוט). reader חדש `lib/data/admin/webhook-inbox.ts`: `listWebhookInbox({page,kind?,state?,from?,to?,q?})` עם `createAdminClient` (service-role מאחורי gate, RLS=defense-in-depth), `resolvePage`+`count:'exact'`+`order(received_at desc)`, **הקרנת-עמודות** (payload מוצג רק ב-detail, PII off the list), פילטרי-שרת. idiom של `activity/page.tsx` (כרטיסי-לוג) + `Pagination` + Badges (Kind/Process/Delivery).
2. **מגירת-פירוט** — `InspectorDrawer` (Sheet קיים, `?inspect=<id>`), `getWebhookInboxItem(id)` בשרת: סיכום-מפוענח + מסירה (`errors[].code` + סיווג שמרני) + עיבוד (attempts/processed_at/last_error) + payload גולמי reveal-gated (`PhoneReveal`/`PayloadViewer`/`CopyButton`/`RelativeTime`).
3. **עיבוד-מחדש** — `reprocessWebhookEventAction` (requireAdmin + Zod id): `processed_at=null`, `last_error=null`, `attempts+1` → ה-worker (`webhook-process` cron, **קיים**) מנקז מחדש. confirm + `logActivity`. (כבר לא stub — ה-worker פרוס.)
4. **רצועת-בריאות** — קריאה בלבד בראש העמוד: `received_last` · `unprocessed_count` · `failed_count` (agg על `webhook_inbox`). + קישור-קריאה מ-`/admin/channels` אל `/admin/webhooks` (**בלי** לגעת בטופס-ה-config).
5. **NAV** — `admin-shell.tsx` NAV: `/admin/webhooks` תחת "תקשורת" (אייקון lucide `Webhook`/`Inbox`).

---

## חלק B — לקוח: האפקטים העסקיים של ה-webhook (3 מסכים)

> כל אלה משקפים נתונים ש-**Meta** הזרימה דרך ה-webhook. נפרדים מ-`contact_status` (CRM) ומסיכום-החיוב (קיים).

**מודל-הנתונים המאומת (sb-query + קוד, 2026-06-30 — אסור להניח אחרת):**
- `guests`: `id, event_id, contact_id, contact_status (CRM), status (RSVP), phone, rsvp_token`. `listGuests` (`guests.ts:152`) שולף `contact_status` אך **לא** `contact_id`.
- `contacts`: `id, event_id, op_status (enum contact_op_status, 15 ערכים), removal_requested (bool), whatsapp_consent_at`. ← **op_status + opt-out כאן** (`setContactOpStatus`/`markContactRemovalRequested` כותבים ל-`contacts`).
- `contact_interactions` (15 cols, אומת): `delivery_status, delivery_error_code, provider_id, contact_id, guest_id, event_id, campaign_id, direction, kind, billable, payload_meta jsonb (metadata בלבד — **אין גוף-הודעה**, PII-safe), created_at`. UNIQUE(channel, provider_id) **מאומת** (pg_constraint) → מגבה dedup/idempotency. ה-timeline (#7) הוא **event-based** (נשלח/נמסר/נקרא/תשובה), לא טקסט-הודעה.
- `outreach_state`: `status, reached_at, reached_channel, stop_reason …` = מצב מנוע-ה-outreach (לא op_status).
- ✅ **FK אומת ודאית** (`pg_constraint`): `guests_contact_id_fkey` = `guests.contact_id → contacts.id` **קיים** → **embedded-select של PostgREST זמין**: `guests.select('…, contacts(op_status, removal_requested)')`. `contact_id` **nullable** → לטפל ב-guest ללא contact (ה-embed יחזיר null). (`information_schema.constraint_column_usage` החזיר ריק בטעות — לא אמין ל-FK; `pg_constraint` הוא המקור הסמכותי.)
- `delivery_status` ברשימה = **האחרון per-guest** מ-`contact_interactions` → לא embeddable כ"אחרון" → שאילתה batched אחת (`guest_id IN(page)`, מיון, בחירת-אחרון בזיכרון; לא N+1). **כלול ברשימה** (לא נדחה).
- ✅ **RLS אומת (pg_policies):** `listGuests` משתמש ב-**cookie client** (owner RLS, לא service-role). לבעלים יש קריאה: `contacts_owner_select`=`owns_event(event_id)` ו-`contact_interactions_owner_select`=`owns_event AND event_id IS NOT NULL` → ה-embed (#6) וה-timeline (#7) עובדים דרך ה-cookie client. **תנאי:** אינטראקציות-ה-webhook חייבות `event_id` (אחרת לא נראות לבעלים). אדמין-inspector (חלק A) ממשיך service-role.

6. **רשימת-האורחים — badges של מצב webhook** (`guests/page.tsx`):
   - עמודה/תגיות חדשות: **מסירה** (`delivery_status`: נשלח/נמסר/נקרא/נכשל), **מצב-מגע** (`op_status`: הושג/מספר-שגוי), **opt-out** (`removal_requested` → "הוסר/ביקש הסרה").
   - מקור (מאומת ודאית): `op_status` + `removal_requested` מ-**`contacts`** דרך **embedded-select** (FK `guests_contact_id_fkey` קיים): `listGuests` יוסיף `contacts(op_status, removal_requested)` ל-`GUEST_LIST_COLUMNS`. `delivery_status` האחרון = שאילתה batched נפרדת על `contact_interactions` (`guest_id IN(page)`), **כלול ברשימה**. לטפל ב-`contact_id=null`. Badge קיים + label-maps (`guests/labels.ts` — `wrong_number` כבר שם; להוסיף 15 ערכי `contact_op_status` + delivery + opt-out).
   - **לא** לגעת ב-`ContactStatusCell` (CRM נפרד).
7. **פירוט-האורח — timeline הודעות-WhatsApp** (`guests/[guestId]/page.tsx`):
   - סקשן חדש "היסטוריית WhatsApp": reader חדש `listInteractionsForContact(contactId)` (על `contact_interactions`, שני הכיוונים, עם `delivery_status`/`kind`/`created_at`) → timeline: נשלח→נמסר→נקרא→תשובה, אינדיקציית מספר-שגוי / opt-out. dir="ltr" ל-wamid. ללא PII בלוג.
   - מצב-outreach של האורח (הושג/חויב/הוסר) כתקציר בראש הסקשן.
8. **תוצאות-קמפיין — פילוח webhook** (`manage-client.tsx`, **ליד** סיכום-החיוב הקיים, לא במקומו):
   - agg חדש (reader חדש לקמפיין): מ-**`contacts`** (`op_status` → מספר-שגוי/הושג; `removal_requested` → ביקשו-הסרה) + מ-`contact_interactions` (`delivery_status` → נמסרו/נקראו/נכשלו), על קבוצת אנשי-הקשר של הקמפיין (דרך `contact_interactions.campaign_id`/`outreach_state.campaign_id`). + גרף (`recharts` קיים, `ui/chart.tsx`).
   - סיכום-החיוב (הושגו/חויבו/תקרה) **נשאר כפי שהוא** — לא משוכפל.

---

## חלק C — RSVP מכפתור-WhatsApp (השלמת זרימה נכנסת מ-Meta)

9. **`record_rsvp_from_whatsapp`** — אורח שעונה ב-quick-reply ("מגיע/לא מגיע") שולח **inbound message עם `button_reply.id`**. **פער מאומת:** `classifyMessagePayload` (`inbound.ts:90`) מחזיר רק `{billable, removal}` וקורא `button_reply.**title**` בלבד — **לא `.id`**. לכן #9 חייב קודם **להרחיב את `InboundMessagePayload` + המסווג** כדי לחשוף `replyId` (`button_reply.id` / `list_reply.id` / `button.payload`), ורק אז למפות ל-RSVP. כיום לא נרשם RSVP.
   - **עיבוד:** ב-`webhook-processing.ts` — `replyId` ממופה דרך `RSVP_BUTTON_MAP = { rsvp_attending: 'attending', rsvp_declined: 'declined', rsvp_maybe: 'maybe' }` (קבוע מוגדר). אם תואם **ויש שיוך לאורח** (`resolveByContextId` → `guest_id`, ומשם `guests.rsvp_token`) → לרשום RSVP דרך **`submit_rsvp` RPC הקיים** (service_role; EXECUTE אומת) — אטומי, מאמת מצב-אירוע, בלי לשכפל לוגיקה.
   - **שיקוף:** סטטוס-האורח (`status`) מתעדכן → מופיע ברשימת-האורחים (#6) + ב-timeline (#7) + נספר ב-RSVP הקיים. + שורת `logActivity` (`rsvp.from_whatsapp`).
   - **קונבנציה (מוגדרת — סגורה, לא פתוחה):** `sendWhatsAppTemplate` (`client.ts:24`) שולח template בלי components → הכפתורים מוגדרים ב-**template המאושר ב-WABA**. תגובת-quick-reply-template מגיעה כ-`type:"button"` עם `button.payload`; interactive מגיע כ-`interactive.button_reply.id` — **שניהם** ממופים דרך `RSVP_BUTTON_MAP`. ה-payloads הקבועים: `rsvp_attending`/`rsvp_declined`/`rsvp_maybe`. הצעד היחיד מחוץ-לקוד = יצירת/אישור ה-template ב-WABA עם ה-payloads האלה — **פעולה תפעולית באותה קטגוריה של חיבור-Meta שכבר בוצע** (לא פריט-קוד פתוח). המסווג מורחב לחשוף `replyId` (`button.payload` ?? `button_reply.id` ?? `list_reply.id`).

---

## מפת-שכבות מלאה (כל מסך × כל שכבה)

| מסך | DB (קיים) | reader/action (חדש) | page/client (חדש) | reuse |
|---|---|---|---|---|
| A1 רשימה | `webhook_inbox` | `webhook-inbox.ts: list` | `webhooks/page.tsx`+filters | resolvePage/Pagination/activity-idiom |
| A2 פירוט | `webhook_inbox` | `webhook-inbox.ts: getItem`+association batched | `InspectorDrawer`+viewers | Sheet/CopyRow/Intl |
| A3 reprocess | `webhook_inbox` | `reprocessWebhookEventAction` | footer-action | worker(cron) קיים/logActivity |
| A4 health | `webhook_inbox` agg | `webhook-inbox.ts: counts` | health-strip | — |
| A5 nav | — | — | `admin-shell` NAV | NAV array |
| B6 guest badges | `contacts` (op_status/removal — **embed via FK**) + `contact_interactions` (delivery — batched latest) | extend `listGuests` | `guests/page.tsx` badges | Badge/labels |
| B7 guest timeline | `contact_interactions` | `listInteractionsForContact` | סקשן ב-`[guestId]/page.tsx` | section pattern |
| B8 campaign agg | `contacts` + `contact_interactions` (campaign scope) | `getCampaignDeliveryBreakdown` | בלוק ב-`manage-client` | recharts/Card |
| C9 RSVP-button | `guests`/`rsvp_*` | wiring ב-`webhook-processing` → `submit_rsvp` | (ללא מסך חדש — משקף בקיים) | submit_rsvp RPC |

**אבטחה/PII:** payload reveal-gated + לא-נרשם; `q` רק מזהים-טכניים; service-role מאחורי requireAdmin + RLS; timeline-לקוח גדור ב-`requireOwnedEvent`. **אפס deps חדשים.** **אפס כפילות:** reuse של Badge/Pagination/Sheet/submit_rsvp/getCampaignBillingSummary(קיים, לא-נגוע).

---

## רצף-בנייה (כל שלב מאומת: lint+tsc+vitest+build+דפדפן-authed)

1. **A1-A2-A5** — reader + רשימה + פילטרים + nav + מגירה (ה-inspector "עולה לאוויר" ומציג נתונים אמיתיים — ה-pipeline חי). + tests.
2. **A3-A4** — reprocess action + health strip.
3. **B6** — badges ברשימת-האורחים (projection + labels).
4. **B7** — `listInteractionsForContact` + timeline בפירוט-האורח.
5. **B8** — `getCampaignDeliveryBreakdown` + בלוק בלוח-הקמפיין (ליד החיוב הקיים).
6. **C9** — RSVP-מכפתור: הרחבת-מסווג (`replyId`) + `RSVP_BUTTON_MAP` + wiring ב-`webhook-processing` → `submit_rsvp` + tests.

כל 6 השלבים **מוגדרים-במלואם ובני-בנייה מיידית** — אין פריט-קוד תלוי/עתידי/פתוח. (ה-payloads של ה-template ב-WABA = config תפעולי מוגדר, באותה קטגוריה של חיבור-Meta שכבר בוצע.)

---

## תיעוד נלווה (CLAUDE.md: לעדכן כשנוסף route/חוזה)
data-contract של `webhook_inbox` · runbook אדמין (`/admin/webhooks`) · עדכון מפת-routes · קונבנציית `button_reply.id` ל-RSVP.
