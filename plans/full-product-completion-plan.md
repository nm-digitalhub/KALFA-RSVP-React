# KALFA — תוכנית השלמה מלאה (מוצר + טכני) — לאישור

> מבוסס על ביקורת ידנית של 4 סוכנים מומחים (קריאת קוד מלאה + אימות DB חי, ללא תיעוד מקומי), 2026‑06‑29. כולל הטמעת כל ממצאי SUMIT שאומתו בחיים + השלמת תוכנית החיוב הקיימת.
> כל פריט מסומן **[מרחיב]** (קובץ/רכיב קיים) או **[יוצר]** (חסר אמת) — אין כפילות.

## תמצית מנהלים
**מה מוצק (production‑grade):** יצירת אירוע · ניהול אורחים + ייבוא CSV · גזירת contacts · יצירת קמפיין + חתימת חוזה (OTP, PDF hashed) · **תפיסת J5 חיה ומוכחת** · **חיוב הטוקן (capture) — אומת בחיים** (₪4 מלא + ₪1 חלקי) · חשבון/הגדרות · צוות/ארגון (הרשאות data‑driven) · מנוע תשלום orders.

**הפערים הקריטיים:**
1. **החצי האחורי של החיוב לא יכול לרוץ** — ה‑RPCs + flags + whatsapp config שהקוד קורא **לא קיימים בשום מקום** (לא חי, לא במיגרציה).
2. **RSVP ציבורי לאורח כלל לא קיים** — לב המוצר (איסוף תגובות) חסר נתיב‑אורח (`r/[token]`).
3. **מחזור חיי הקמפיין יתום** — `activate/close-charge/whatsapp-send` ללא call‑site/UI → outreach לעולם לא מתחיל.
4. **סיכון zero‑bill** — כשל RPC זמני ב‑close‑charge → סגירה קבועה ב‑₪0.
5. **עמוד ההזמנות יתום** — אין נתיב יצירה.

---

## מפת הזרימות (מה קיים / חסר)
| זרימה | סטטוס | פער עיקרי |
|-------|-------|-----------|
| אירוע: create/list/detail/edit | ✅ מוצק | אין מחיקה; דשבורד caps@20; קישורי recent שגויים |
| אורחים: CRUD + ייבוא + contacts | ✅ מוצק | **contacts יתומים** במחיקה/שינוי‑טלפון; ניהול קבוצות חצי‑מחווט |
| קמפיין: create→sign→**J5 hold** | ✅ חי ומוכח | — |
| outreach→reached→**capture** | ⚠️ כתוב אבל **רדום+חסום** | RPCs/flags/whatsapp config חסרים; lifecycle יתום |
| RSVP ציבורי (אורח) | ❌ **לא קיים** | אין route/קריאה/שליחה/rate‑limit |
| חשבון/הגדרות | ✅ מוצק | אין מחיקת חשבון (מכוון) |
| צוות/ארגון | ✅ מוצק | **שליחת מייל הזמנה stubbed**; org‑read owner‑only |
| הזמנות (orders) | ⚠️ מנוע מוכן, **יתום** | אין נתיב יצירה |

---

## התוכנית בשלבים

### שלב 0 — תיקוני נכונות קריטיים (קטן, לפני כל go‑live)
- **[מרחיב]** `close-charge.ts`: כשל RPC של summary → `review` (לא `nothing_to_charge`). מונע zero‑bill קבוע.
- **[מרחיב]** `authorize.ts`: להדק קבלת hold ל‑`ValidPayment === true` (כיום undefined עובר) → אחרת `hold_review`. (אסימטריה מול capture.)
- **[מרחיב]** `guests.ts:deleteGuest` + שינוי‑טלפון: prune של `contacts` לא‑מקושרים → שלמות חיוב.
- **[מרחיב]** `app/page.tsx`: ספירות מ‑count (לא limit 20) · `event_date.slice(0,10)` · קישור recent ל‑`/app/events/${id}`.

### שלב 1 — השלמת החצי האחורי (להפוך את לולאת הכסף לרצה)
- **[יוצר]** מיגרציה אחורית: 2 RPCs (`try_record_billed_result`, `campaign_billing_summary`) + `app_settings.outreach_enabled/close_charge_enabled` + `whatsapp_phone_number_id/access_token/app_secret/verify_token` + `contacts.whatsapp_consent_at`. → regen types + הסרת ה‑`as unknown as SupabaseClient` casts.
- (הקוד שקורא להם — `billing.ts`/`outreach.ts` — **[מרחיב]**, כבר כתוב.)

### שלב 2 — בקרות frozen‑set + הטמעת ממצאי SUMIT
- **[להחיל]** מיגרציה `0024` (קיימת בדיסק) — `campaign_authorized_contacts` + `min_hold_floor` + `reasonable/extreme` (300/400).
- **[מרחיב]** snapshot ה‑set ב‑J5 + תזמון hold `max(floor, min(full,coverage)×price×(1+buffer))` + כריכת outreach **וגם** billing ל‑set (reached⊆authorized).
  - ⚠️ **מקור ה‑snapshot = contacts של אורחים נוכחיים (JOIN ל‑guests), לא טבלת `contacts` הגולמית** — אחרת contacts יתומים נכנסים ל‑set. (אומת: contact יתום מ‑deleteGuest/שינוי‑טלפון **כן ניתן לשליחה וחיוב** — `listSendableContacts`/`resolveInboundContact` מפתחים לפי contact_id ללא join ל‑guests.) זה גם מייתר את ה‑prune שבשלב 0 כפתרון‑שורש, אך ה‑prune נשאר היגייני.
- **[מרחיב]** capture/close‑charge — כבר תואמים לממצאים; להוסיף **שמירת PDF קבלה** (להוריד את ה‑bytes ל‑Storage, לא רק URL).
- **[מרחיב]** בדיקת **תפוגת כרטיס** (`card_exp`) לפני close + re‑hold/`release_status`.

### שלב 3 — UI מחזור חיי קמפיין (חיווט הנתיבים היתומים)
- **[יוצר]** `campaign/[campaignId]/page.tsx` — מסך ניהול: activate/pause/close + סטטוס + באנרי charge=/wa=.
- **[מרחיב]** `events/[id]/page.tsx` — קישור לניהול הקמפיין (כיום רק ל‑new).
- (הנתיבים `close-charge`/`whatsapp-send` + `activate/pause/close` — **[מרחיב]**, קיימים, רק חסרי קורא.)

### שלב 4 — RSVP ציבורי לאורח (הפיצ'ר החסר בליבה) — **backend חלקית מוכן, לא "מוכן"** (אומת)
> **תיקון נון‑רגרסיה:** ה‑RPCs `get_rsvp_by_token` + `submit_rsvp` **כבר קיימים** (anon, אטומיים, audit). הנתיב **קורא להם** — **לא מרחיבים `guests.ts`** (סיכון לשכפל את הכתיבה האטומית של submit_rsvp). default+index ל‑`rsvp_token` כבר קיימים (לא לאמת מחדש).
- **[יוצר]** `r/[token]/` — דף RSVP: **קורא ל‑`get_rsvp_by_token`** (scoping per‑guest+per‑event מובנה), טופס, **`submit_rsvp`** לעדכון אטומי. שגיאות גנריות.
- **[מרחיב‑RPC] (עבודה אמיתית — האימות חשף):** ה‑RPCs מסננים **רק לפי token** — חסר אכיפת **status אירוע / `rsvp_deadline` / ביטול** (CLAUDE.md מחייב) **ו‑throttle**. חובה להוסיף **בתוך ה‑RPC** (כי anon נקרא ישירות ב‑PostgREST `/rest/v1/rpc/submit_rsvp` — עוקף כל rate‑limit ב‑route). `get_rsvp_by_token` גם יחזיר `confirmed_adults/kids/meal_pref` ל‑pre‑fill.
- **[מרחיב]** `whatsapp-send` (+ מנוע C1) — לבנות ולמסור את **לינק ה‑RSVP** (`rsvp_token`→`/r/[token]`); היום לא נבנה בשום מקום.
- **[מרחיב] (D7)** אישור דרך הלינק (אם נמסר ב‑outreach בתשלום) → `try_record_billed_result` (חיוב, dedup חוצה‑ערוצי) — לא רק עדכון RSVP.

### שלב 5 — הזמנות + פערים משניים
- **הכרעה:** orders — **[יוצר]** נתיב יצירה (checkout) **או [מרחיב]** הסתרת פריט הניווט. (היום מציג פיצ'ר שאי‑אפשר ליצור.)
- **[מרחיב]** שליחת מייל הזמנת‑צוות — לחווט ל‑`email/sender.ts` הקיים (+ template) במקום הצגת קישור ב‑UI.
- **[מרחיב]** org‑read: להחליף `requireOwnedEvent`→`requireEventAccess` בקריאות (Phase 3 multitenancy).
- משניים **[מרחיב]**: מחיקת אירוע · ניהול קבוצות UI · pagination אירועים · manual‑reconcile UI · הצגת קבלה ב‑orders · audit‑log לתשלום · edge‑case null‑email ב‑`accept_invitation` · N+1 ב‑`listMembers`.

---

## הכרעות לאישורך
1. **orders** — לבנות checkout או להסתיר? (המודל החי הוא per‑reached דרך קמפיינים.)
2. **RSVP ציבורי** — לבנות עכשיו (פיצ'ר ליבה) או לדחות?
3. **סדר** — שלב 0 (תיקונים) → 1 (back‑half) → 2 (frozen‑set) → 3 (lifecycle UI) → 4 (RSVP) → 5. לאשר?

## אימות "מרחיב מול יוצר" (אומת מול הקוד — אין כפילות)
**יוצר (חסר אמת):** מיגרציה אחורית · `r/[token]/*` · `campaign/[campaignId]/page.tsx` · (אופ') checkout. **להחיל:** `0024` (קיים בדיסק). **כל השאר = מרחיב** קבצים קיימים (`close-charge/authorize/capture/guests/campaigns/billing/team-actions/events page/email sender`).
