# KALFA — רשימת משימות מאוחדת למערכת החיוב (Outcome Billing)

> מקור: שני workflows מרובי-סוכנים (גילוי read-only + ארכיטקטורת חבילות/blueprint), 2026-06-26.
> baseline בעת הכתיבה: `npm run lint` ✓ · `tsc --noEmit` ✓ · 259 tests ✓ · `next build --webpack` ✓.

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

## Blueprint — שכבות חיווט (תמצית; רוב התשתית קיימת)

DB migration ✓ · types ✓ · data-layer (הרחב `campaigns.ts`, חדש `billing.ts`/`interactions.ts`) · zod (`validation/billing.ts`) · routes (`api/webhooks/whatsapp|voximplant`, `api/admin/campaigns/[id]/close|credit|capture`) · pages (owner billing dashboard, admin campaigns) · client forms (lifecycle + credit, RTL/DirectionProvider) · jobs (`lib/jobs/boss.ts` + handlers) · adapters (reuse `sumit/*`, חדש `whatsapp/client.ts`, `voximplant/client.ts` via fetch).

מפתח: פונקציית `try_record_billed_result` (SECURITY DEFINER) שאוגרת campaign FOR UPDATE + בודקת `status='active'` + חלון + `COUNT < max_contacts` + `ON CONFLICT DO NOTHING` — תקרה + idempotency בטרנזקציה אחת. סכום סופי דרך RPC `campaign_billing_summary` (PostgREST aggregates כבויים).
