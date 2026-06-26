# KALFA — רשימת משימות מאוחדת למערכת החיוב (Outcome Billing)

> מקור: שני workflows מרובי-סוכנים (גילוי read-only + ארכיטקטורת חבילות/blueprint), 2026-06-26.
> baseline בעת הכתיבה: `npm run lint` ✓ · `tsc --noEmit` ✓ · 259 tests ✓ · `next build --webpack` ✓.

## יומן התקדמות (2026-06-26)

- ✅ **checkpoint commit** `258b5ba` על branch `feat/billing-backhalf` (כל העץ היה untracked) — נקודת שחזור.
- ✅ **introspection חי** (`sb-query.mjs`): RLS מופעל על **כל 21 הטבלאות**, policies owner-scoped (`owns_event` + `has_role admin`). אינדקסי בסיס (`idx_events_owner`, `idx_guests_event`, `contacts_event_idx`) **קיימים**.
  - ⇒ **B7 (הוספת RLS) מתבטל** — אין טבלה חשופה. נותר רק: (אופ') בדיקת ownership ב־`getCampaign` כ-defense-in-depth (RLS כבר מכסה), ו-(אופ') לכידת ה-RLS החי כ-baseline migration לתיעוד.
  - ⇒ **S2 מצטמצם**: רק `activity_log` חסר אינדקסים (PK בלבד). אינדקסי הבסיס מיותרים.
  - RPCs קיימים: `submit_rsvp`, `get_rsvp_by_token`, `has_role`, `owns_event`, `claim_first_admin`. ה-RPCs ל-B2/B4 (`try_record_billed_result`, `campaign_billing_summary`) **לא קיימים** → ייווצרו.
- ✅ **S1 הושלם** (commit `beb2155`): פילטר יומן לפי מופע ישות + chip + deep-link. +3 בדיקות.
- ✅ **S3 הושלם** (commit `beb2155`): שדה `sort_order` בטופס חבילות. +3 בדיקות.
- 🟢 **אימות**: lint ✓ · tsc ✓ · **265 בדיקות** ✓ · build ✓.

### הכרעות שאומצו (לפי [[outcome-billing-model]] + ייעוץ)
- **orders/pay = משני/legacy** (חיוב לפי-איש-קשר, לא לפי-הזמנה) → **B6 יורד בעדיפות**.
- **billing route**: ברירת מחדל **route B** (charge בסגירה, ללא קריאת ספק באישור) — לאישור סופי כשנגיע לחיווט החיוב.
- **config-gate** לכל הספקים **וגם לחיוב הסופי** — שום הודעה/שיחה/חיוב אמיתי עד הפעלה מפורשת + flag per-action.
- **§18 (15 קריטריוני קבלה) = ספֵק הבדיקות** לליבת הבילינג.
- **migrations** = שינוי פרודקשן (beta על ה-DB החי) → נכתבים כקבצים, מיושמים רק באישור מפורש.

## תמצית מצב

החצי **הקדמי** של מודל החיוב מיושם ונבדק: סכמה + enums + RLS ל־`campaigns/contacts/billed_results/contact_interactions/billing_credits/signed_agreements`, אילוץ `unique(event_id,contact_id)` נגד חיוב כפול, dedup E.164, OTP/SMS/email, וזרימת `campaign create → sign(OTP) → approve`.

החצי **האחורי** כמעט נעדר: אין webhooks של ספקים, אין כתיבת `billed_results`/`contact_interactions`, סטטוס קמפיין נעצר ב־`approved`, `pg-boss` + `whatsapp-api-js` מותקנים אך **0 imports**, אין templates להודעות, אין consent לפי ערוץ, אין חיוב סופי (J5/capture).

**חבילות חסרות: 0.** כל התשתית מותקנת; הפער הוא חיווט, לא התקנה.

---

## חסמים שיש לנקות לפני כל קוד

1. **אין נקודת git** — כל האפליקציה untracked (commit סקפולד יחיד). יש להסתעף מ־main ולעשות commit נקודת-ביקורת לפני כל שינוי (דורש אישור commit ממך).
2. **runtime baseline** — lint/tsc/build ירוקים, אך לפי [[verification-gate-runtime]] צריך גם בדיקת console מאומתת בדפדפן.
3. **introspection חי** — RLS של טבלאות בסיס ו־`activity_log` קיימים רק ב־Supabase החי, לא ב־migrations; כל שינוי index/RLS חייב introspection דרך `scripts/sb-query.mjs` לפי [[supabase-live-schema]].
4. **הכרעות מוצר** (ראה למטה) — חוסמות קוד בילינג/messaging.

---

## משימות בטוחות — ללא אישור עסקי (אחרי checkpoint)

| # | משימה | מאמץ | קבצים |
|---|-------|------|-------|
| S1 | פילטר ישות-ספציפית ביומן (לפי event/guest/group/package ID, לא רק סוג) | M | `src/lib/data/admin/activity.ts`, `admin/activity/page.tsx`, `activity.test.ts` |
| S2 | indexes נוספים (meta JSON + עמודות RLS) — אחרי introspection | S | `supabase/migrations/*.sql` חדש |
| S3 | חשיפת `sort_order` בטופס חבילות אדמין | S | `admin/packages.ts`, `package-form.tsx`, `validation/admin.ts` |

> הערה: חיפוש חופשי + פילטר לפי **סוג** ישות כבר מיושמים ונבדקים — המשימה הפתוחה המקורית מה-handoff כבר בוצעה; נותר רק פילטר לפי **מופע** ספציפי (S1).

---

## משימות רגישות-חיוב — דורשות אישור היקף ממך

| # | משימה | חומרה | מאמץ |
|---|-------|-------|------|
| B1 | Wiring של `buildContactsForEvent` (מוגדר אך לא נקרא) → מודל החיוב נעשה נגיש e2e | **critical** | M |
| B2 | webhooks של ספקים + מנוע יצירת `billed_results` (זיהוי חיוב — לב המערכת) | **critical** | L |
| B3 | execution: שולחי WhatsApp + Voximplant, scheduler ב־pg-boss, message_templates, consent לפי ערוץ | **critical** | L |
| B4 | מחזור חיים של קמפיין: state machine, סגירה, חיוב סופי SUMIT (J5/capture), דשבורדי חיוב | high | L |
| B5 | UI אדמין לקונפיג חיוב: `price_per_reached`, `channels`, `outreach_schedule` | high | M |
| B6 | אימות + הקשחה של זרימת SUMIT pay (payments.js POC, אימות Swagger, integration tests, APP_ORIGIN guard) | high | M |
| B7 | הקשחת Auth/RLS: ownership ב־`getCampaign`; RLS ל־`rsvp_responses`/`callback_requests`/`contact_messages`; baseline migration | high | M |

---

## הכרעות מוצר שאתה צריך לסגור (חוסמות B1–B6)

1. **orders/pay מול campaign-charge** — האם חיוב לפי-הזמנה (orders/pay, כרגע ללא נתיב יצירה) ומודל החיוב לפי-איש-קשר-שהושג הם שני SKU שונים, או ש־orders/pay מיותר?
2. **WhatsApp/Voximplant בביתא?** — האם הערוצים האלה נשלחים בביתא (משפיע גם על נוסח מדיניות הפרטיות).
3. **billing route**: J5 hold לתקרה באישור ואז capture בסגירה (route A), או saved-token ואז charge בסגירה (route B)? (`raw-charge.ts` מוכיח את שניהם.)
4. **תקרה**: מה קורה כשהתקרה נחצית באמצע — עצירה שקטה ו־`not_reached`, או התרעת אדמין?
5. **VAT**: מאיזה מקור (`orders.vat_rate`?), והתקרה המוצגת באישור — כולל מע"מ או נטו?
6. **תגובה ב־paused / אחרי סגירה** — האם מחייבת?
7. **סף "אינטראקציה אנושית" ב־Voximplant** — אילו אותות (ASR/DTMF/turn) נחשבים חיוב (חייב להיות admin-configurable, לא hardcoded).

---

## סדר מומלץ

1. checkpoint commit (אישור) → 2. runtime baseline → 3. introspection חי (RLS) → 4. אישור הכרעות מוצר + היקף → 5. משימות בטוחות S1–S3 → 6. B1 (contacts wiring) → 7. B7 (RLS definite fixes) → 8. B6 (SUMIT verify) → 9. B5 (admin config) → 10. B2→B3→B4 (כל אחת עם תוכנית כתובה + אישור נפרד).

---

## B1 — גישה כתובה (לפני עריכה)

**מצב:** `buildContactsForEvent(eventId)` (`contacts.ts:61`) כתוב, idempotent (upsert לפי `event_id,normalized_phone` + קישור `guests.contact_id`), אך **לא נקרא**. הספירה לחיוב (`countUniqueContactsForEvent`) נגזרת ישירות מ־guests — לכן טבלת contacts ריקה לא מקלקלת ספירה, אבל B2 (יצירת `billed_results` המפנה ל־`contact_id`) זקוק לה.

**נקודות קריאה מוצעות:**
1. `import-actions.ts` — אחרי `bulkInsertGuests` (לפני revalidate).
2. `guests-actions.ts` — אחרי `createGuest` / `deleteGuest`; ב־`updateGuest` רק אם הטלפון השתנה.

**הכרעת סמנטיקת כשל (הנקודה היחידה שדורשת אישורך):**
- **מומלץ — "best-effort":** מוטציית המוזמן מצליחה ומתחייבת; אם הבנייה־מחדש של contacts נכשלת, פעולת המוזמן **לא** נכשלת (אחרת retry יוצר מוזמן כפול). הספירה לחיוב נשארת תקינה (נגזרת מ-guests), וה־contacts יתואמו בקריאה הבאה / באישור הקמפיין. עלות: טבלת contacts עלולה להיות זמנית לא-מעודכנת.
- חלופה — "fail-loud": כשל בבנייה מכשיל את הפעולה (עקבי יותר, אבל מסכן מוזמנים כפולים ב-retry).

**ביצועים:** בנייה-מחדש = O(כל המוזמנים) לכל מוטציה (≤2000). מקובל ל-B1; אופטימיזציה נקודתית בהמשך.
**בדיקות (TDD):** (א) `buildContactsForEvent` — 2 מוזמנים אותו טלפון + 1 לא-תקין + 1 ריק ⇒ contact אחד, קישורי `contact_id`, ספירה=1. (ב) האקשנים קוראים ל-buildContacts בנתיב ההצלחה. אין שינוי DB/migration.

---

## Blueprint — שכבות חיווט (תמצית; רוב התשתית קיימת)

DB migration ✓ · types ✓ · data-layer (הרחב `campaigns.ts`, חדש `billing.ts`/`interactions.ts`) · zod (`validation/billing.ts`) · routes (`api/webhooks/whatsapp|voximplant`, `api/admin/campaigns/[id]/close|credit|capture`) · pages (owner billing dashboard, admin campaigns) · client forms (lifecycle + credit, RTL/DirectionProvider) · jobs (`lib/jobs/boss.ts` + handlers) · adapters (reuse `sumit/*`, חדש `whatsapp/client.ts`, `voximplant/client.ts` via fetch).

מפתח: פונקציית `try_record_billed_result` (SECURITY DEFINER) שאוגרת campaign FOR UPDATE + בודקת `status='active'` + חלון + `COUNT < max_contacts` + `ON CONFLICT DO NOTHING` — תקרה + idempotency בטרנזקציה אחת. סכום סופי דרך RPC `campaign_billing_summary` (PostgREST aggregates כבויים).
