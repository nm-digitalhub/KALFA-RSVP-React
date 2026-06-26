# KALFA — מסמך תיעוד: מערכת החיוב (Outcome Billing) — סשן 2026-06-26

מסמך זה מתעד את מצב פיתוח מערכת החיוב לפי-תוצאה, מה בוצע בסשן זה, הממצאים, ההחלטות, וכיצד להמשיך.

---

## 1. הקשר

KALFA היא פלטפורמת RSVP per-event (B2C, עברית-first, RTL). מודל החיוב הוא **לפי איש קשר ייחודי שהושג** (תגובת WhatsApp אמיתית או מענה אנושי בשיחה) — **לא** רכישת חבילה ולא מנוי. האפיון המלא: `plans/plan-paid.md` (18 סעיפים; §18 = 15 קריטריוני קבלה מחייבים).

**Stack:** Next.js 16.2.9 (App Router, Server Components), React 19.2, TypeScript, Tailwind v4, Supabase (`@supabase/ssr`), Zod 4. בנייה: `next build --webpack`. פריסה: `beta.kalfa.me` דרך pm2.

⚠️ **beta מחובר ל-Supabase החי (production).** כל migration = שינוי פרודקשן הדורש אישור מפורש.

---

## 2. מה בוצע בסשן זה

### תהליך (multi-agent workflows)
1. **workflow גילוי** (read-only, 8 קוראי דומיינים + סינתזה) — מיפוי מצב המערכת מול האפיון.
2. **workflow חבילות + blueprint** — זיהוי חבילות נדרשות + תוכנית חיווט שכבות.

### תשתית
- **Checkpoint commit** `258b5ba` על branch `feat/billing-backhalf` — כל קוד האפליקציה היה untracked (commit סקפולד יחיד); זו נקודת שחזור.
- **Introspection חי** של ה-DB דרך `scripts/sb-query.mjs`.

### משימות שהושלמו (commit `beb2155`)
- **S1 — פילטר יומן לפי מופע ישות:** סינון לפי `event_id` (עמודה) ו-`guestId/groupId/packageId` (ב-`meta` jsonb), deep-linkable עם chip להסרה, נשמר על פני pagination. +3 בדיקות.
- **S3 — שדה `sort_order` בטופס חבילות אדמין:** ולידציית Zod (int≥0, ריק→0), מחובר דרך actions/data-layer/edit-page, מתועד ב-audit. +3 בדיקות.

### נלווה
- נשלח **מייל חוזה לדוגמה** ל-admin@nm-digitalhub.com (תבנית אמיתית `renderAgreementBody` + פרטי חברה מה-DB + PDF; נתוני עסקה מסומנים "להמחשה בלבד").

---

## 3. ממצאים מרכזיים

### מצב המערכת
- **החצי הקדמי של הבילינג בנוי ונבדק:** סכמה + enums + RLS ל-`campaigns/contacts/billed_results/contact_interactions/billing_credits/signed_agreements`; אילוץ `unique(event_id,contact_id)` נגד חיוב כפול; dedup E.164; OTP/SMS/email; זרימת `campaign create → sign(OTP) → approve`.
- **החצי האחורי כמעט נעדר:** אין webhooks של ספקים, אין כתיבת `billed_results`/`contact_interactions`, סטטוס קמפיין נעצר ב-`approved`, `pg-boss` + `whatsapp-api-js` מותקנים אך **0 imports**, אין message-templates, אין consent לפי ערוץ, אין חיוב סופי.
- **2 פערי חיווט:** `buildContactsForEvent` (`contacts.ts:61`) מוגדר אך לא נקרא; אין נתיב יצירת הזמנה (orders/pay לא נגיש).
- 4 חסימות SUMIT מ-`read.md` — **כולן מקודדות**; נותרו 3 אימותי תלות חיצונית.

### חבילות
**0 חבילות חסרות.** כל התשתית מותקנת (`zod`, `@supabase/*`, `pg-boss`, `whatsapp-api-js`, `libphonenumber-js`, `pdf-lib`, `puppeteer`, `nodemailer`, `react-hook-form`, `signature_pad`). הכרעות: כסף = אגורות-שלמות + `numeric` ב-SQL (לא decimal lib); אין `@tanstack/react-table` (server-side pagination קיים); Voximplant = Management API דרך `fetch` (לא ה-SDK הפגיע).

### Introspection (גזר את B7/S2)
- **RLS מופעל על כל 21 הטבלאות**, policies owner-scoped (`owns_event` + `has_role admin`) → **B7 (הוספת RLS) מתבטל**.
- אינדקסי בסיס (`idx_events_owner`, `idx_guests_event`, `contacts_event_idx`) **קיימים** → **S2 מצטמצם ל-`activity_log` בלבד**.
- RPCs קיימים: `submit_rsvp`, `get_rsvp_by_token`, `has_role`, `owns_event`, `claim_first_admin`. ה-RPCs ל-B2/B4 (`try_record_billed_result`, `campaign_billing_summary`) **לא קיימים** → ייווצרו.

---

## 4. החלטות שאומצו

| החלטה | פירוט |
|-------|-------|
| ערוצים בביתא | **WhatsApp + Voximplant — שניהם** (אישור משתמש). משפיע על B2/B3/B4 ועל נוסח מדיניות הפרטיות. |
| orders/pay | **משני/legacy** — המודל האמיתי הוא לפי-איש-קשר → **B6 יורד בעדיפות**. |
| billing route | ברירת מחדל **route B** (charge בסגירה, ללא קריאת ספק באישור) — לאישור סופי לפני חיווט החיוב. |
| Config-gate | כל הספקים **וגם החיוב הסופי** disabled-by-default — שום הודעה/שיחה/חיוב אמיתי עד flag per-action מפורש. |
| ספֵק בדיקות | §18 (15 קריטריוני קבלה) = הבסיס לבדיקות ליבת הבילינג. |
| Migrations | נכתבים כקבצים; מיושמים על ה-DB החי רק באישור מפורש. |

---

## 5. סטטוס אימות

`npm run lint` ✓ · `npx tsc --noEmit` ✓ · **265 בדיקות** (vitest) ✓ · `next build --webpack` ✓.

---

## 6. עבודה שנותרה

מקור מלא ומעודכן: **`plans/billing-implementation-tasklist.md`**.

| # | משימה | חומרה | מצב |
|---|-------|-------|-----|
| S1 | פילטר יומן לפי מופע | — | ✅ הושלם |
| S3 | sort_order בחבילות | — | ✅ הושלם |
| S2 | אינדקסי `activity_log` (migration) | low | ממתין (migration → אישור) |
| B1 | חיווט `buildContactsForEvent` | critical | מתוכנן (גישה כתובה במסמך התוכנית) |
| B2 | webhooks ספקים + מנוע `billed_results` | critical | טרם החל — דורש תוכנית epic |
| B3 | שולחי WhatsApp/Voximplant + scheduler + consent | critical | טרם החל — דורש תוכנית epic |
| B4 | מחזור חיים + חיוב סופי + דשבורדים | high | טרם החל — דורש תוכנית epic |
| B5 | UI אדמין: price/channels/schedule | high | טרם החל |
| B6 | אימות SUMIT pay | high | הופחת (orders/pay משני) |
| B7 | הוספת RLS | — | ❌ בוטל (RLS כבר קיים) |

**הכרעות מוצר פתוחות ל-B2–B4:** נקודת אכיפת התקרה + concurrency; אימות webhook (HMAC); VAT; תגובה ב-paused/אחרי סגירה; סף "אינטראקציה אנושית" ב-Voximplant. ראה `plans/billing-implementation-tasklist.md` ו-blueprint.

---

## 7. כיצד להמשיך

```bash
# branch העבודה
git checkout main   # (אוחד; ראה למטה)

# שער אימות (להריץ לפני כל commit)
npm run lint && npx tsc --noEmit && npm run test && npm run build

# קריאת DB חי (read-only, בטוח)
node scripts/sb-query.mjs "select ... from public...."
```

**הצעד הבא המומלץ:** B1 (חיווט `buildContactsForEvent`) — לפי הגישה הכתובה ב-`plans/billing-implementation-tasklist.md` (TDD סדרתי, סמנטיקת כשל best-effort). אחריו B2→B3→B4, כל אחת עם תוכנית epic כתובה ואישור לפני קריאת SUMIT/שליחת הודעות אמת.

**אילוצים מחייבים:** ליבת הבילינג = TDD סדרתי (לא fan-out מקבילי, שובר invariants); migrations על DB חי = אישור מפורש; אין hardcoding של מחיר/ערוצים/policy (קונפיג DB).

---

*נכתב 2026-06-26. מסמכים נלווים: `plans/plan-paid.md` (אפיון), `plans/billing-implementation-tasklist.md` (רשימת משימות), `docs/sumit-payments-implementation.md` (SUMIT).*
