# תוכנית יישום — זרימת ההקמה וההפעלה של אישורי ההגעה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לצמצם את ארבע הפעולות הדומות ("פרסום האירוע", "הפעלת אישורי הגעה", "חתימה ואישור הקמפיין", "הפעלת הקמפיין") לשלוש החלטות אמיתיות — אישור פרטי האירוע → חתימה → אמצעי תשלום — עם הפעלה אוטומטית של הקמפיין מיד אחרי תפיסת המסגרת, הפרדה מוצגת בין מצב האירוע למצב הקמפיין, ניסוחים שמתארים בדיוק מה קורה, ומסך הצלחה שמוביל להוספת מוזמנים.

**Architecture:** שינוי UI + Server Actions בלבד, עם תיקון DB צר אחד (רצפת `funded_cap`). כל אינווריאנטי הכסף נשמרים כפי שהם: גודל תפיסת ה-J5, `snapshotAuthorizedSet`, התקרה החתומה, שומר D5, `close-charge`. ההפעלה האוטומטית קוראת ל-`activateCampaign` הקיים (אותם שומרים, אותו נתיב). מצבי התצוגה החדשים של הקמפיין הם **נגזרים** (פונקציה טהורה מעל `status` + `capture_status`) — בלי שינוי enum. המעבר `draft → active` של האירוע נשאר (הטריגרים `campaigns_require_active_event` ו-`events_guard_update` לא נוגעים בהם), אבל הוא נקרא "אישור פרטי האירוע" ומשורשר ישירות אל יצירת הקמפיין וההסכם.

**Tech Stack:** Next.js 16 App Router (Server Components, Server Actions, Route Handlers), React 19 `useActionState`, Supabase (`@supabase/ssr` cookie client + service-role admin client), Zod 4, vitest 4, Base UI/shadcn primitives (`Button`, `Badge`, `Dialog`), lucide-react.

**Spec:** `docs/KALFA-RSVP.md` (ביקורת ה-UX, 8 המלצות + זרימה מומלצת של 11 שלבים).

## Global Constraints

- **לא לגעת בתנאי התוכנית ובמודל החיוב** (זיכרון `campaign-rework-constraint`): base/included/overage מה-snapshot של הקמפיין, `computeHoldAmountBaseOverage`, `computeCeilingBaseOverage`, `snapshotAuthorizedSet`, `try_record_billed_result`, שומר D5, `min(accrued, ceiling) − credits`. Task 0 משנה **רק** את רצפת `funded_cap` בתוך המודל הקיים.
- **אף Route Handler לא כותב `campaigns.status`** — `campaign-lifecycle-parity.test.ts` אוכף זאת. הפעלה = קריאה ל-`activateCampaign`.
- **כל מחיר/מספר מנתונים** (`campaign.base_price/included_reached/price_per_reached/max_charge_ceiling`, sizing חי) — אף פעם לא hardcoded (זיכרון `no-hardcoded-business-facts`).
- עברית/RTL, מאפייני CSS לוגיים, `buttonVariants` מ-`@/components/ui/button`, `FormError`/`FormNotice`/`SubmitButton` מ-`@/components/forms`.
- שינויי DB: `supabase migration new <name>`; **הבעלים** מריץ `supabase db push`; אישור מפורש לפני (זיכרונות `user-runs-platform-commands`, `explicit-approval-per-step`).
- Definition of Done לכל Task: הבדיקות הממוקדות ירוקות; בסוף: `npm run lint && npx tsc --noEmit && npm test && npm run build`. אין `next build` במקביל (זיכרון `concurrent-build-collision`).
- אין commit/push/deploy בלי בקשה מפורשת. מומלץ commit קטן בסוף כל Task (הזיכרון `small-fixes-commit-to-main` מתיר commit ישיר ל-main לשינויים קטנים; העבודה כאן מהותית — ענף `feat/onboarding-activation-flow`).

---

## שערי החלטה (הבעלים)

| שער | שאלה | המלצה | משפיע על |
|---|---|---|---|
| **G0** | אישור התוכנית כמכלול | — | הכול |
| **G1** | סדר "מוזמנים" מול "חתימה": הביקורת מציעה להפעיל קודם ולהוסיף מוזמנים אחרי. בפועל התקרה ומסגרת האשראי נקבעות לפי הרשימה **ברגע התפיסה** (`prepareCampaignHold`, `campaigns.ts:600-639`) ואינן מתעדכנות אחר כך. תפיסה עם 0 מוזמנים = תקרה ₪200 לצמיתות (ולאחר Task 0: עד 200 אנשי קשר). | **שער רך**: שלב "הוספת מוזמנים" מוצג כשלב 2 בעמוד ההקמה (מומלץ, לא חוסם) + אזהרה מפורשת בעמוד התשלום כשהרשימה ריקה. לא לחסום (26.7 הבעלים אישר במפורש חתימה לפני מוזמנים). | Task 4, Task 8 |
| **G2** | Task 0 — מיגרציית `funded_cap`. בלי זה זרימת "הפעלה → הוספת מוזמנים" של הביקורת מייצרת קמפיין "פעיל" שלא שולח לאף אחד. | לאשר; סקירת `rls-schema-engineer` לפני `db push`. | Task 0 |
| **G3** | פער משפטי-קוד: ההסכם (`template.ts:260`) אומר שדמי ההפעלה נגבים "במועד הפעלת הקמפיין בפועל"; הקוד גובה הכול בסגירה (`close-charge.ts`, ידני). ועוד (סוכן, [MEASURED]): מסמך ההסכם הפעיל `2026-07-v4` הוא `body_html NULL` ⇒ הגוף שנחתם הוא ברירת המחדל בקוד; §5 (`template.ts:289`) קובע חלון ביטול "עד שני ימים לפני מועד הפעלת הקמפיין" — עם הפעלה אוטומטית, ההפעלה מתלכדת עם רגע התפיסה. הניסוח בעמוד התשלום יתאר את מה שהקוד עושה. | להעביר ל-`israeli-compliance-advisor` לפני deploy של Task 5; **לא חוסם** את שאר התוכנית. | Task 4 (ניסוח), Task 5 (עיתוי) |

---

## ממצאים מאומתים (קריאה מלאה של הקוד, 2.9.2026)

כל ממצא [MEASURED] = נקרא בקובץ/במיגרציה. [OPEN] = ממתין לאימות הסוכן מול ה-DB החי (סעיף "אימות צולב" בסוף).

| # | ממצא | עוגן | Task |
|---|---|---|---|
| F1 | מכונת המצבים: אירוע `draft→active` רק דרך `publishEvent` (service-role, טריגר `events_guard_update` R3/R5/R6/R7). קמפיין נוצר `pending_approval` ב-`createCampaign` **רק** כשהאירוע `active` (אפליקציה + טריגר `campaigns_require_active_event`). `approved` נקבע ב-`approveCampaign` דרך `recordSignedAgreement`. התפיסה כותבת `capture_status='authorized'` בלבד. `active` רק דרך `activateCampaign` (מ-approved/scheduled/paused + `capture_status='authorized'` + אירוע עתידי + אירוע active). | `events.ts:432-462`, `campaigns.ts:180-274, 348-388, 437-481, 885-927`, `20260630223635…sql` | 7, 8 |
| F2 | אחרי תפיסה מוצלחת ה-route מפנה ל-`payment?held=1` ולא מפעיל כלום; הבעלים חוזר לעמוד האירוע ולוחץ "הפעלת קמפיין" בעמוד הניהול. כל שומרי `activateCampaign` כבר מתקיימים בנקודה זו. | `authorize/route.ts:300`, `manage-client.tsx:435`, `campaign-section.tsx:21-24` | 5, 6 |
| F3 | ה-set **אינו** הקפאה קשיחה: נלקח snapshot בתפיסה, אבל `RECONCILE_AUTHORIZED_SET_ENABLED=true` (חי) מקבל מוזמנים מאוחרים עד `funded_cap`. נתיב השליחה עושה INNER JOIN על `campaign_authorized_contacts` — חברות ב-set עדיין נדרשת כדי להישלח. | `reconcile-config.ts`, `.env.local:54`, `sendable-contacts.ts:33-44`, `contacts.ts:249-292` | 0, 9 |
| **F4 — באג** | `funded_cap = least(v_max, included + floor((auth−base)/price))` כאשר `v_max = campaigns.max_contacts`, ו-`prepareCampaignHold` שומר `max_contacts = full` = מונה אנשי הקשר **ברגע התפיסה**. יצירה ותפיסה עם 0 אנשי קשר מותרות (26.7). לכן חתימה+תפיסה עם 0 מוזמנים ⇒ `max_contacts=0` ⇒ `funded_cap=0` ⇒ כל הוספת מוזמן מחזירה `ceiling_full` ⇒ קמפיין "פעיל" שלעולם לא שולח. הבדיקה מ-30.8 השתמשה ב-`max:1000` ולא כיסתה זאת. **אומת חי 2.9** (`pg_get_functiondef`): קמפיין `active`+`authorized` אחד עם `max_contacts=0` (נתפס 27.8, base 200/included 200/auth 200, set 0), ועוד שניים בדרך (`approved` 30.8, `pending_approval` 1.9, שניהם base>0). **החמרה (סוכן):** גם `try_record_billed_result` החי סופר לפי `max_contacts` — gate OFF: `v_cap := v_max`; gate ON: `least(v_max, floor(auth/price))` בלי base/included — כך שגם reach שיגיע יחזור `ceiling_reached` ולא יחויב. התיקון חייב לכסות את **שני** ה-RPC. | `20260830112656…sql` (`least(v_max, …)`), `20260712115459…sql` (`v_cap`), `campaigns.ts:627`, `reconcile.integration.test.ts:167-191` | **0** |
| F5 | תפיסה ל-0 מוזמנים במודל base+overage: hold = base, ceiling = base; אחרי Task 0 `funded_cap = included`. התקרה אינה מחושבת מחדש אחרי התפיסה — מגבלת הכנסה ל-KALFA, לא סיכון ללקוח. | `campaigns.ts:624-639` | G1, 4 |
| F6 | גמר החשבון ידני (settle של אדמין / route אדמין / זרימת ביטול). אין sweep אוטומטי אחרי האירוע. ניסוח "מתי החיוב" חייב להיות "לאחר האירוע, עם סגירת הקמפיין וגמר החשבון". | `campaign-actions.ts:408-466`, `close-charge/route.ts:58`, `event-cancellation.ts:434` | 4, G3 |
| F7 | ביטול שלב "פרסום" כשלב DB ידרוש שינוי `campaigns_require_active_event` + נעילת R5. הנתיב הבטוח: להשאיר את המעבר, לקרוא לו "אישור פרטי האירוע והמשך", ולשרשר אותו אל `createCampaign` בפעולה אחת. | `20260630223635…sql:121-134`, `events.ts:356-374` | 7 |
| F8 | מסך סקירת הייבוא כבר כולל: מונה שורות + שגיאות, זיהוי כפילויות (טלפון/שם) עם בחירה פר-שדה. חסר: תיקון שורה לפני אישור, משפט סיכום תקינות/שגויות, הסבר מה עושה "אישור ייבוא". | `whatsapp/page.tsx:71-80`, `staging-client.tsx:61-120`, `whatsapp/actions.ts:84-138` | 11 |
| F9 | `activateCampaign` עצמו רק מחליף סטטוס, שולח Slack ומזריע `thankyou_send_at` — **לא מתזמן כלום**. ה-cron `arm` (כל דקה) ו-`sweeper` (כל 5 דק') ב-worker קוראים `handleArm` → `listActiveCampaigns` (`status='active'`) → `seedOutreachState` שקורא **רק** `campaign_authorized_contacts` → `ensureCurrentStep` → jobs. set ריק ⇒ אין `outreach_state` ⇒ אין jobs ⇒ קמפיין "פעיל" שקט. [MEASURED — סוכן] | `campaigns.ts:885-927`, `worker/main.ts:513-525, 1113-1116`, `outreach-engine.ts:71-161` | 5, 9 |
| F11 | `manage-client.tsx` `canActivate` (340-341) לא בודק `capture_status` — קמפיין `approved` **בלי** תפיסה מציג "הפעלת קמפיין" שנכשל בשרת ("לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי"). חי: קמפיין כזה אחד. [MEASURED — סוכן] | `manage-client.tsx:340-341`, `campaigns.ts:866` | 9 |
| F12 | אין `activity_log` לשום מעבר סטטוס של קמפיין (created/approved/activated/paused/closed/cancelled) — רק `campaign.hold_authorized`. CLAUDE.md דורש auditability לפעולות קמפיין; עם הפעלה אוטומטית זה חשוב יותר. [MEASURED — סוכן] | `campaigns.ts:885-927`, `authorize/route.ts:245-254` | 5 |
| F13 | ב-DB חיים **שני** אינדקסים partial-UNIQUE זהים על `campaigns(event_id) where status<>'cancelled'` (`campaigns_event_noncancelled_uidx`, `campaigns_one_active_per_event`); ההערה ב-`campaigns.ts:308-313` "אין DB backstop" מיושנת. ערכי enum `draft/scheduled/awaiting_invoice/billed/paid` — אין כותב באפליקציה. [MEASURED — סוכן] | `campaigns.ts:308-313`, `campaign-status.ts:12-19` | תיעוד (12) |
| F10 | דף הבית מציג לוח בקרה ריק למשתמש בלי אירועים; אין הפניה לטופס. | `app/page.tsx:57-67` | 10 |

---

## מבנה הקבצים

| קובץ | אחריות | פעולה |
|---|---|---|
| `supabase/migrations/<ts>_reconcile_funded_cap_floor_included.sql` | רצפת `funded_cap` ב-`included` | חדש |
| `src/lib/data/reconcile.integration.test.ts` | מקרה 0 מוזמנים | עריכה |
| `src/lib/data/event-labels.ts` (+ `.test.ts` חדש) | תוויות מצב אירוע, `campaignStage` נגזר + תוויות | עריכה + חדש |
| `src/lib/phone.ts` (+ `phone.test.ts`) | `maskPhoneForDisplay` | עריכה |
| `src/lib/data/campaigns.ts` (+ `campaigns.test.ts`) | `EVENT_NOT_CONFIRMED_ERROR`, `loadHoldSizingInputs`, `previewCampaignHoldSizing`, `prepareCampaignHold` משתמש באותה קריאה | עריכה |
| `src/lib/data/events.ts` (+ `events.test.ts`) | ניסוחי שגיאה ("אישור פרטי האירוע") | עריכה |
| `src/lib/data/agreements.ts` | ניסוח שגיאה | עריכה |
| `src/lib/data/contacts.ts` | `countAuthorizedContacts` | עריכה |
| `src/lib/data/guests.ts` | `countGuests` | עריכה |
| `src/lib/data/setup-steps.ts` (+ `.test.ts`) | מודל טהור של עמוד ההקמה | חדש |
| `src/app/api/campaigns/[id]/authorize/route.ts` (+ `route.test.ts`) | הפעלה אוטומטית אחרי תפיסה | עריכה |
| `src/app/api/campaigns/[id]/status/route.ts` (+ `route.test.ts`) | ייבוא קבוע השגיאה | עריכה |
| `…/campaign/campaign-actions.ts` (+ `.test.ts`) | `setupCampaignAction` משרשר publish; מחיקת `publishEventAction`; revalidate נוסף ב-`activateCampaignAction` | עריכה |
| `…/campaign/[campaignId]/payment/page.tsx` | סיכום מפורש, מסך הצלחה, כפתור הפעלה במקום | עריכה |
| `…/campaign/[campaignId]/payment/hold-form.tsx` | סכום התפיסה בדיאלוג, כרטיס מוסתר בנייד | עריכה |
| `…/campaign/[campaignId]/payment/activate-now-form.tsx` | כפתור "הפעלת הקמפיין עכשיו" (fallback) | חדש |
| `…/campaign/[campaignId]/approve/page.tsx`, `sign-agreement-form.tsx` | ניסוחים, מסכת טלפון | עריכה |
| `…/campaign/[campaignId]/page.tsx`, `manage-client.tsx` | מצב ריק, "דמי הפעלה", באנר מוזמנים שלא נכללו | עריכה |
| `…/events/[id]/page.tsx` | עמוד הקמה: `SetupSteps` במקום publish + `CampaignSection` | עריכה |
| `…/events/[id]/setup-steps.tsx` | רכיב עמוד ההקמה (server) | חדש |
| `…/events/[id]/campaign-setup-form.tsx` | `label` + `children` | עריכה |
| `…/events/[id]/event-status-actions.tsx` | רק "סגירת האירוע" | עריכה |
| `…/events/[id]/campaign-section.tsx` | מוחלף ב-`SetupSteps` | **מחיקה** |
| `…/events/[id]/edit-event-form.tsx` | ניסוח נעילה | עריכה |
| `src/app/(customer)/app/page.tsx` | הפניה לטופס כשאין אירועים, תווית מונה | עריכה |
| `…/guests/import/whatsapp/page.tsx` | מוני תקינות, רשימת שגיאות, הסבר | עריכה |
| `docs/onboarding-activation-flow-2026-09-02.md` | רשומת החלטות | חדש |

---

## סדר הביצוע, תלויות ונקודות עצירה בטוחות

| Task | תלות | שער אימות | עצירה בטוחה בסוף? |
|---|---|---|---|
| 0 מיגרציית funded_cap | G2 | בדיקת אינטגרציה (gated) + probe בעלים | כן (התנהגות legacy זהה) |
| 1 תוויות + `campaignStage` | — | unit | כן (תצוגה בלבד) |
| 2 מסכת טלפון | — | unit | כן |
| 3 ניסוחים | 1 | tests מעודכנים | כן |
| 4 תצוגת תפיסה (preview) | — | unit + tsc | כן |
| 5 הפעלה אוטומטית | 4 | route tests + parity test | כן (fallback במקום) |
| 6 מסך הצלחה + כפתור fallback | 5 | tsc + build + browser | כן |
| 7 שרשור אישור פרטים → הסכם | 3 | action tests | כן |
| 8 עמוד הקמה (stepper) | 1, 7 | unit (`computeSetupSteps`) + browser | כן |
| 9 מצב ריק בעמוד הניהול | 1 | tsc + browser | כן |
| 10 הפניה מלוח הבקרה | — | browser | כן |
| 11 סקירת ייבוא | — | tsc + browser | כן |
| 12 תיעוד + שער אימות מלא | הכול | lint/tsc/test/build + `/verifying-kalfa-changes` | — |

---

### Task 0: רצפת `funded_cap` ב-`included` — בשני ה-RPC (DB — דורש G2)

> **בוצע 2.9.2026 (קבצים בלבד, ממתין ל-`db push` של הבעלים)** — ראו "Task 0 — סטטוס ביצוע" בסוף המסמך. הצעדים להלן מתועדים לסקירה ולשחזור.

**Files:**
- Create: `supabase/migrations/20260902062917_reconcile_funded_cap_floor_included.sql` — **שתי** פונקציות: `reconcile_authorized_set` (בסיס `20260830112656`) + `try_record_billed_result` (בסיס `20260712115459`, זהה לגוף החי)
- Modify: `src/lib/data/reconcile.integration.test.ts`, `src/lib/data/reconcile-config.ts` (הערה מיושנת)

**Interfaces:**
- Consumes: `public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text)`; `public.try_record_billed_result(uuid, uuid, uuid, campaign_channel, text, text, text)`.
- Produces: אותן חתימות, אותם ערכי החזרה; משתנה **רק** נוסחת ה-cap:
  - reconcile: `least(greatest(v_max, v_included), v_included + floor(greatest(0, v_auth − v_base)/v_price))`
  - billed_result gate OFF: `greatest(v_max, v_included)` (היה `v_max`); gate ON: אותה נוסחה כמו reconcile (היה `least(v_max, floor(v_auth/v_price))` בלי base/included). `v_base/v_included` נקראים מהקמפיין ו-`coalesce` ל-0.
- legacy (base=0/included=0): שני הביטויים מצטמצמים לקודמים בדיוק.

- [ ] **Step 1: הוסף בדיקת אינטגרציה נכשלת (gated)**

הוסף ל-`src/lib/data/reconcile.integration.test.ts`, אחרי המקרה `'base+overage: extra overage headroom beyond auth-base is admitted too'`:

```ts
  it('base+overage: max_contacts frozen at 0 (signed before adding guests) still admits up to `included`', async () => {
    // Fix under test (audit 2.9): max_contacts is persisted at HOLD time as the
    // unique-contact count. A customer who signs + holds before adding guests
    // (allowed since 26.7) therefore gets max_contacts=0, and the OLD cap
    // least(0, 200 + floor(0/4)) = 0 rejected EVERY later guest — an "active"
    // campaign that never sends. The base fee already covers `included`
    // contacts, so the cap must never fall below it:
    // least(greatest(0, 200), 200) = 200.
    await withCampaign(
      { max: 0, auth: 200, price: 4, base: 200, included: 200 },
      async ({ event, campaign, q }) => {
        const c = await eligibleContact(q, event);
        expect(
          await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c, null, null]),
        ).toBe('added');
        expect(await setSize(q, campaign)).toBe(1);
      },
    );
  });

  it('legacy (base=0/included=0): max_contacts still caps exactly as before', async () => {
    // greatest(max, 0) = max → identical to the pre-fix formula for every
    // campaign created before the base+overage gate went live.
    await withCampaign({ max: 1, auth: 40, price: 4 }, async ({ event, campaign, q }) => {
      const c1 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c1, null, null])).toBe('added');
      const c2 = await eligibleContact(q, event);
      expect(await rpc(q, 'reconcile_authorized_set', [event, campaign, 'add', c2, null, null])).toBe(
        'ceiling_full',
      );
      expect(await setSize(q, campaign)).toBe(1);
    });
  });
```

- [ ] **Step 2: ודא שהבדיקה נכשלת (רק אם יש DB בדיקות)**

Run: `OUTREACH_DB_IT=1 npx vitest run src/lib/data/reconcile.integration.test.ts -t "max_contacts frozen at 0"`
Expected: FAIL — `expected 'ceiling_full' to be 'added'`. אם אין `OUTREACH_TEST_DB_URL` (המצב הרגיל בשרת הזה — זיכרון `campaign-recipient-freeze-p0`): הבדיקה מדולגת; האימות עובר ל-Step 5.

- [ ] **Step 3: צור את המיגרציה**

```bash
supabase migration new reconcile_funded_cap_floor_included
```

העתק את **כל** תוכן `supabase/migrations/20260830112656_fix_reconcile_funded_cap_base_overage.sql` לקובץ החדש, והחלף **שני** דברים בלבד:

(א) את הערת הכותרת (השורות שמתחילות ב-`--` לפני `create or replace function`) ב:

```sql
-- funded_cap floor at `included` (audit 2.9.2026, docs/KALFA-RSVP.md §1/§7).
--
-- reconcile_authorized_set caps the dynamic authorized set at
--   least(max_contacts, included + floor(max(0, auth − base) / price)).
-- `max_contacts` is persisted by prepareCampaignHold as the unique-contact
-- count AT HOLD TIME, and signing + holding BEFORE adding guests is allowed
-- (2026-07-26). So a 0-guest hold gets max_contacts = 0 → funded_cap = 0 →
-- every later guest add returns ceiling_full → an "active" campaign that never
-- sends. The base fee already covers `included` reached contacts, so the cap
-- must never fall below `included`:
--   least(greatest(max_contacts, included), included + floor(max(0, auth − base) / price)).
-- For a legacy campaign (base = 0, included = 0) greatest(max, 0) = max —
-- byte-for-byte the previous behavior. Everything else (signature, grants,
-- every other branch) is unchanged — CREATE OR REPLACE keeps this a one-line
-- formula fix, not a rewrite.
```

(ב) את הביטוי:

```sql
    v_funded_cap := least(
      v_max,
      v_included + floor(greatest(0, v_auth - v_base) / v_price)
    )::int;
```

ב:

```sql
    v_funded_cap := least(
      greatest(v_max, v_included),
      v_included + floor(greatest(0, v_auth - v_base) / v_price)
    )::int;
```

ודא ש-`diff` בין שני הקבצים מציג **רק** את הכותרת ואת השורה `v_max,` → `greatest(v_max, v_included),`:

```bash
diff supabase/migrations/20260830112656_fix_reconcile_funded_cap_base_overage.sql supabase/migrations/*_reconcile_funded_cap_floor_included.sql
```

- [ ] **Step 4: סקירה + אישור**

הפעל את הסוכן `rls-schema-engineer` לסקירת המיגרציה (read-only). המתן ל-G2 מהבעלים. **הבעלים** מריץ:

```bash
supabase db push
```

- [ ] **Step 5: אימות חי (הבעלים, read-only + rollback)**

```sql
begin;
set local session_replication_role = replica;
-- synthetic rows, rolled back below — never persisted
select public.reconcile_authorized_set(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'add',
  '00000000-0000-4000-8000-000000000003', null, null);
rollback;
```

Expected: `no_campaign` (אין קמפיין כזה) — מוכיח שהפונקציה נטענה בלי שגיאת תחביר. לאימות הנוסחה: `select pg_get_functiondef('public.reconcile_authorized_set'::regproc);` חייב להכיל `greatest(v_max, v_included)`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_reconcile_funded_cap_floor_included.sql src/lib/data/reconcile.integration.test.ts
git commit -m "fix(billing): funded_cap never below included — a 0-guest hold could admit nobody"
```

---

### Task 1: תוויות מצב + מצב קמפיין נגזר

**Files:**
- Modify: `src/lib/data/event-labels.ts:29-52`
- Create: `src/lib/data/event-labels.test.ts`
- Modify: `src/app/(customer)/app/page.tsx:34`

**Interfaces:**
- Produces: `EVENT_STATUS_LABELS` (ערכים חדשים), `eventStatusLabel(status, closureReason)`, `type CampaignStage`, `campaignStage(campaign | null): CampaignStage`, `CAMPAIGN_STAGE_LABELS`, `CAMPAIGN_STAGE_VARIANTS`. נצרכים ב-Tasks 8, 9.

- [ ] **Step 1: בדיקות נכשלות**

צור `src/lib/data/event-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STAGE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  campaignStage,
  eventStatusLabel,
} from '@/lib/data/event-labels';

// Audit §3 (docs/KALFA-RSVP.md): the EVENT state and the CAMPAIGN state are two
// separate things the owner must never confuse — "פעיל" belongs to the campaign
// only. The campaign display state is DERIVED (status + capture_status), not a
// new enum value.
describe('campaignStage', () => {
  it('no campaign → not_set', () => {
    expect(campaignStage(null)).toBe('not_set');
  });

  it('draft / pending_approval → awaiting_signature', () => {
    expect(campaignStage({ status: 'draft', capture_status: null })).toBe('awaiting_signature');
    expect(campaignStage({ status: 'pending_approval', capture_status: null })).toBe(
      'awaiting_signature',
    );
  });

  it('approved without a confirmed hold → awaiting_payment (incl. a failed/ambiguous attempt)', () => {
    expect(campaignStage({ status: 'approved', capture_status: null })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'approved', capture_status: 'pending' })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'approved', capture_status: 'hold_failed' })).toBe('awaiting_payment');
    expect(campaignStage({ status: 'approved', capture_status: 'hold_review' })).toBe('awaiting_payment');
  });

  it('approved/scheduled WITH a confirmed hold → awaiting_activation', () => {
    expect(campaignStage({ status: 'approved', capture_status: 'authorized' })).toBe(
      'awaiting_activation',
    );
    expect(campaignStage({ status: 'scheduled', capture_status: 'authorized' })).toBe(
      'awaiting_activation',
    );
  });

  it('active → active, paused → paused', () => {
    expect(campaignStage({ status: 'active', capture_status: 'authorized' })).toBe('active');
    expect(campaignStage({ status: 'paused', capture_status: 'authorized' })).toBe('paused');
  });

  it('every post-run status folds into closed', () => {
    for (const status of ['closed', 'awaiting_invoice', 'billed', 'paid'] as const) {
      expect(campaignStage({ status, capture_status: 'authorized' })).toBe('closed');
    }
  });

  it('cancelled → cancelled', () => {
    expect(campaignStage({ status: 'cancelled', capture_status: null })).toBe('cancelled');
  });

  it('every stage has a non-empty Hebrew label', () => {
    for (const label of Object.values(CAMPAIGN_STAGE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('event status labels (audit §2/§3)', () => {
  it('an active event reads as confirmed details, never "פעיל"', () => {
    expect(EVENT_STATUS_LABELS.active).toBe('פרטי האירוע אושרו');
    expect(eventStatusLabel('active', null)).toBe('פרטי האירוע אושרו');
  });

  it('closed reads "הסתיים", and "בוטל" when the closure came from a cancellation request', () => {
    expect(eventStatusLabel('closed', null)).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'owner')).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'settlement')).toBe('הסתיים');
    expect(eventStatusLabel('closed', 'cancellation')).toBe('בוטל');
  });

  it('pending_approval reads as waiting for a SIGNATURE (audit §4)', () => {
    expect(CAMPAIGN_STATUS_LABELS.pending_approval).toBe('ממתין לחתימה');
  });
});
```

- [ ] **Step 2: ודא כישלון**

Run: `npx vitest run src/lib/data/event-labels.test.ts`
Expected: FAIL — `campaignStage is not a function` / תוויות לא תואמות.

- [ ] **Step 3: יישום**

ב-`src/lib/data/event-labels.ts` החלף את הבלוק `EVENT_STATUS_LABELS` … `CAMPAIGN_STATUS_VARIANTS` (שורות 29-68) ב:

```ts
import type { EventClosureReason } from '@/lib/data/events'; // type-only: erased at runtime, keeps this module isomorphic

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'טיוטה',
  // Audit §2/§3: an `active` EVENT only means its details are confirmed and the
  // dates are locked (R5). "פעיל" is reserved for the CAMPAIGN, so an owner
  // never reads "פעיל" while nothing is being sent yet.
  active: 'פרטי האירוע אושרו',
  closed: 'הסתיים',
};

// The owner-facing event status line. `closed` has two faces: a normal end
// ("הסתיים") and a close that came from a cancellation request ("בוטל") — the
// enum has no `cancelled`, so the distinction rides on the closure reason the
// activity log already records (getEventClosureReason).
export function eventStatusLabel(
  status: EventStatus,
  closureReason: EventClosureReason | null,
): string {
  if (status === 'closed' && closureReason === 'cancellation') return 'בוטל';
  return EVENT_STATUS_LABELS[status];
}

// Hebrew labels for the campaign lifecycle enum, same exhaustive-Record
// discipline as EVENT_STATUS_LABELS above — a new campaign_status value is a
// compile error here rather than a silently-missing label. Used by the admin
// campaigns table and the stats page; owner-facing screens use the DERIVED
// campaignStage below instead.
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'טיוטה',
  pending_approval: 'ממתין לחתימה', // audit §4: what is actually pending is the owner's signature
  approved: 'מאושר',
  scheduled: 'מתוזמן',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  awaiting_invoice: 'ממתין לחשבון',
  billed: 'חויב',
  paid: 'שולם',
  cancelled: 'בוטל',
};

// Campaign status → Badge variant, kept alongside CAMPAIGN_STATUS_LABELS (same
// file, same enum-keyed exhaustiveness) per the admin/guests labels.ts convention.
export const CAMPAIGN_STATUS_VARIANTS: Record<CampaignStatus, BadgeVariant> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  scheduled: 'info',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  awaiting_invoice: 'warning',
  billed: 'info',
  paid: 'success',
  cancelled: 'destructive',
};

// --- Owner-facing campaign STAGE (audit §3) -----------------------------------
// The lifecycle enum alone cannot tell the owner what to do next: `approved`
// means "signed" BEFORE the card hold and "ready to start" AFTER it. The stage
// is derived from status + capture_status — a pure function, no new enum value,
// no migration — and is the ONLY campaign state owner screens show.
export type CampaignStage =
  | 'not_set' // no campaign yet
  | 'awaiting_signature' // created, agreement not signed
  | 'awaiting_payment' // signed, no confirmed card hold yet
  | 'awaiting_activation' // held; activation did not happen (auto-activation refused / pre-change campaign)
  | 'active'
  | 'paused'
  | 'closed' // closed / awaiting_invoice / billed / paid
  | 'cancelled';

export const CAMPAIGN_STAGE_LABELS: Record<CampaignStage, string> = {
  not_set: 'טרם הוגדר',
  awaiting_signature: 'ממתין לחתימה',
  awaiting_payment: 'ממתין לתשלום',
  awaiting_activation: 'ממתין להפעלה',
  active: 'פעיל',
  paused: 'מושהה',
  closed: 'נסגר',
  cancelled: 'בוטל',
};

export const CAMPAIGN_STAGE_VARIANTS: Record<CampaignStage, BadgeVariant> = {
  not_set: 'neutral',
  awaiting_signature: 'warning',
  awaiting_payment: 'warning',
  awaiting_activation: 'warning',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
  cancelled: 'destructive',
};

export function campaignStage(
  campaign: { status: CampaignStatus; capture_status: string | null } | null,
): CampaignStage {
  if (!campaign) return 'not_set';
  switch (campaign.status) {
    case 'draft':
    case 'pending_approval':
      return 'awaiting_signature';
    case 'approved':
    case 'scheduled':
      // capture_status vocabulary (campaigns.ts): null | pending | authorized |
      // hold_failed | hold_review — only `authorized` is a confirmed hold.
      return campaign.capture_status === 'authorized' ? 'awaiting_activation' : 'awaiting_payment';
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'closed':
    case 'awaiting_invoice':
    case 'billed':
    case 'paid':
      return 'closed';
    case 'cancelled':
      return 'cancelled';
    default: {
      // Exhaustiveness: a new campaign_status value fails to compile here.
      const exhaustive: never = campaign.status;
      return exhaustive;
    }
  }
}
```

ב-`src/app/(customer)/app/page.tsx:34` החלף `אירועים פעילים` ב-`אירועים שאושרו`.

- [ ] **Step 4: ודא הצלחה**

Run: `npx vitest run src/lib/data/event-labels.test.ts && npx tsc --noEmit`
Expected: PASS; tsc ירוק (הצרכנים הקיימים של `EVENT_STATUS_LABELS`/`CAMPAIGN_STATUS_LABELS` — `events/page.tsx`, `events/[id]/page.tsx`, `stats/page.tsx`, `admin/campaigns/page.tsx`, `admin/support.ts` — ממשיכים לקמפל).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/event-labels.ts src/lib/data/event-labels.test.ts 'src/app/(customer)/app/page.tsx'
git commit -m "feat(events): separate event status from campaign stage in owner-facing labels"
```

---

### Task 2: מסכת טלפון בעמוד החתימה (§5)

**Files:**
- Modify: `src/lib/phone.ts`
- Modify: `src/lib/phone.test.ts`
- Modify: `src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/page.tsx:154`

**Interfaces:**
- Produces: `maskPhoneForDisplay(raw: string | null | undefined): string`.

- [ ] **Step 1: בדיקות נכשלות** — הוסף לסוף `src/lib/phone.test.ts`:

```ts
describe('maskPhoneForDisplay (signing page — audit §5)', () => {
  it('shows an Israeli mobile as 050***4567 — recognisable, not exposed', () => {
    expect(maskPhoneForDisplay('+972501234567')).toBe('050***4567');
    expect(maskPhoneForDisplay('050-123-4567')).toBe('050***4567');
  });

  it('keeps only the last 4 digits of a non-Israeli number', () => {
    expect(maskPhoneForDisplay('+14155552671')).toBe('+14***2671');
  });

  it('falls back to a dash for missing / invalid input', () => {
    expect(maskPhoneForDisplay(null)).toBe('—');
    expect(maskPhoneForDisplay('')).toBe('—');
    expect(maskPhoneForDisplay('123')).toBe('—');
  });
});
```

ועדכן את שורת הייבוא בראש הקובץ:

```ts
import {
  isValidPhone,
  maskPhoneForDisplay,
  normalizePhone,
  repairIsraeliLocalPhone,
} from '@/lib/phone';
```

- [ ] **Step 2: ודא כישלון** — `npx vitest run src/lib/phone.test.ts` → FAIL (`maskPhoneForDisplay` לא מיוצא).

- [ ] **Step 3: יישום** — הוסף לסוף `src/lib/phone.ts`:

```ts
// Display-only mask for a phone the signer must RECOGNISE but that should not
// sit in full on a screen others may glance at (audit §5): the local Israeli
// form with the middle hidden — "+972501234567" → "050***4567". A non-Israeli
// number keeps its country code + last 4. Unparseable → a dash. Never used for
// anything but rendering; OTP delivery still uses the stored E.164.
export function maskPhoneForDisplay(raw: string | null | undefined): string {
  const e164 = normalizePhone(raw);
  if (!e164) return '—';
  const local = e164.startsWith('+972') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 3)}***${local.slice(-4)}`;
}
```

ב-`approve/page.tsx` הוסף `import { maskPhoneForDisplay } from '@/lib/phone';` והחלף בשורה 154 `phone={profile.phone}` ב-`phone={maskPhoneForDisplay(profile.phone)}`. (`SignAgreementForm` משתמש ב-`phone` **רק** לתצוגה — `sign-agreement-form.tsx:196`; ה-OTP נשלח מהפרופיל בצד השרת — `campaign-actions.ts:77-87`.)

- [ ] **Step 4: ודא הצלחה** — `npx vitest run src/lib/phone.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone.ts src/lib/phone.test.ts 'src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/page.tsx'
git commit -m "feat(campaign): mask the signer's phone on the agreement page"
```

---

### Task 3: ניסוחים — "אישור פרטי האירוע" במקום "פרסום", "חתימה והמשך" במקום "אישור הקמפיין" (§2, §4)

**Files:**
- Modify: `src/lib/data/campaigns.ts:190, 370, 826` (+ ייצוא קבוע)
- Modify: `src/app/api/campaigns/[id]/status/route.ts:51-55`
- Modify: `src/lib/data/events.ts:358, 435, 440, 458`
- Modify: `src/lib/data/agreements.ts:146`
- Modify: `…/approve/page.tsx:20, 70, 73-77`
- Modify: `…/approve/sign-agreement-form.tsx:45`
- Modify: `…/payment/page.tsx:39, 200`
- Modify: `…/events/[id]/edit-event-form.tsx:272, 290, 306`
- Tests: `src/lib/data/campaigns.test.ts:952, 967, 979, 1360`, `src/app/api/campaigns/[id]/status/route.test.ts:140`, `src/lib/data/events.test.ts:490, 839`

**Interfaces:**
- Produces: `export const EVENT_NOT_CONFIRMED_ERROR` ב-`campaigns.ts`.

- [ ] **Step 1: עדכן בדיקות (הן מגדירות את הניסוח החדש)**

ב-`campaigns.test.ts` (4 מקומות: 952, 967, 979, 1360) החלף `'יש לפרסם את האירוע לפני אישורי הגעה'` ב-`'יש לאשר את פרטי האירוע לפני אישורי הגעה'`. אותו דבר ב-`status/route.test.ts:140`.
ב-`events.test.ts:490` החלף `'לא ניתן לשנות מועד לאחר פרסום האירוע'` ב-`'לא ניתן לשנות מועד לאחר אישור פרטי האירוע'`; ב-`:839` החלף `'יש להגדיר מועד עתידי לפני פרסום'` ב-`'יש להגדיר מועד עתידי לפני אישור פרטי האירוע'`.

- [ ] **Step 2: ודא כישלון** — `npx vitest run src/lib/data/campaigns.test.ts src/lib/data/events.test.ts 'src/app/api/campaigns/[id]/status/route.test.ts'` → 7 בדיקות נכשלות על מחרוזות.

- [ ] **Step 3: יישום**

`campaigns.ts` — הוסף אחרי `CAMPAIGN_COLUMNS` (שורה 51):

```ts
// R9 refusal, in the owner's vocabulary (audit §2): the event step is
// "אישור פרטי האירוע", never "פרסום". Exported so the console status route can
// classify it as a 409 without duplicating the string.
export const EVENT_NOT_CONFIRMED_ERROR = 'יש לאשר את פרטי האירוע לפני אישורי הגעה';
```

והחלף את שלוש ההשלכות (190, 370, 826) ב-`throw new Error(EVENT_NOT_CONFIRMED_ERROR);`.

`status/route.ts` — הוסף `EVENT_NOT_CONFIRMED_ERROR` לייבוא מ-`@/lib/data/campaigns` והחלף בשורה 54 את המחרוזת ב-`EVENT_NOT_CONFIRMED_ERROR,`.

`events.ts`:
- 358: `'לא ניתן לשנות מועד לאחר אישור פרטי האירוע'`
- 435: `'יש להגדיר מועד עתידי לפני אישור פרטי האירוע'`
- 440: `'המועד האחרון לאישור הגעה כבר חלף — קבעו מועד חדש לפני האישור'`
- 458: `'אישור פרטי האירוע נכשל'`

`agreements.ts:146`: `'פרטי האירוע טרם אושרו — לא ניתן לחתום על ההסכם לפני אישור הפרטים'`.

`approve/page.tsx`:
- 20: `export const metadata: Metadata = { title: 'חתימה על ההסכם' };`
- 70: `<h1 className="text-2xl font-bold">חתימה על ההסכם</h1>`
- 75: `? 'ההסכם נחתם בהצלחה. כעת יש להשלים אמצעי תשלום.'`

`sign-agreement-form.tsx:45`: `{pending ? 'רגע…' : 'חתימה והמשך לאמצעי תשלום'}`

`payment/page.tsx`:
- 39: `event_not_active: 'פרטי האירוע עוד לא אושרו — יש לאשר אותם לפני תפיסת מסגרת האשראי.',`
- 200: `✓ ההסכם נחתם בהצלחה. כעת יש להשלים אמצעי תשלום.`

`edit-event-form.tsx` (272, 290, 306): `נעול לאחר פרסום` → `נעול לאחר אישור פרטי האירוע`.

- [ ] **Step 4: ודא הצלחה**

Run: `npx vitest run src/lib/data/campaigns.test.ts src/lib/data/events.test.ts 'src/app/api/campaigns/[id]/status/route.test.ts' && npx tsc --noEmit && grep -rn "פרסום\|לפרסם\|פורסם" 'src/app/(customer)' src/lib/data --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: PASS; ה-grep מחזיר **רק** את `campaign-actions.ts:483/491` ואת `event-status-actions.tsx:85/88` (שניהם נעלמים ב-Tasks 7-8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/campaigns.ts src/lib/data/events.ts src/lib/data/agreements.ts 'src/app/api/campaigns/[id]/status/route.ts' 'src/app/(customer)/app/events/[id]' src/lib/data/campaigns.test.ts src/lib/data/events.test.ts 'src/app/api/campaigns/[id]/status/route.test.ts'
git commit -m "feat(campaign): say what each step does — confirm details, sign and continue to payment"
```

---

### Task 4: עמוד תפיסת המסגרת — סיכום מפורש עם סכום התפיסה האמיתי (§6)

**Files:**
- Modify: `src/lib/data/campaigns.ts:575-640` (פיצול `prepareCampaignHold`)
- Modify: `src/lib/data/campaigns.test.ts` (בדיקה חדשה)
- Modify: `…/payment/page.tsx:151-235`
- Modify: `…/payment/hold-form.tsx:107-150, 225, 393`

**Interfaces:**
- Produces: `previewCampaignHoldSizing(campaignId): Promise<CampaignHoldSizing>` (read-only). `CampaignHoldForm` מקבל `holdAmount: number` במקום `ceilingAmount`.
- Consumes: `computeCovered`, `computeCeilingBaseOverage`, `computeHoldAmountBaseOverage`, `getHoldSizingKnobs`, `countUniqueContactsForEvent` (קיימים).

- [ ] **Step 1: בדיקה נכשלת** — הוסף ל-`campaigns.test.ts` (אחרי `describe('prepareCampaignHold …')`), והוסף `previewCampaignHoldSizing` לייבוא מ-`@/lib/data/campaigns`:

```ts
describe('previewCampaignHoldSizing (read-only — the payment page summary)', () => {
  it('returns exactly what prepareCampaignHold would size, WITHOUT freezing the set or writing', async () => {
    const { builder } = adminWith<Record<string, unknown>>({ data: null, error: null });
    // 0 guests, base+overage snapshot 200/200 @ ₪4 → hold = base, ceiling = base.
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(0);
    vi.spyOn(builder, 'then')
      // 1. load the campaign
      .mockImplementationOnce((f) =>
        f({
          data: {
            event_id: 'e1',
            price_per_reached: 4,
            template_id: 'pkg1',
            base_price: 200,
            included_reached: 200,
          },
          error: null,
        }),
      )
      // 2. app_settings.reasonable_coverage_contacts
      .mockImplementationOnce((f) => f({ data: { reasonable_coverage_contacts: 300 }, error: null }))
      // 3. packages.min_hold_floor / hold_buffer_pct
      .mockImplementationOnce((f) => f({ data: { min_hold_floor: 0, hold_buffer_pct: 0 }, error: null }));

    const r = await previewCampaignHoldSizing('c1');

    expect(r).toEqual({ holdAmount: 200, ceiling: 200, full: 0, covered: 0 });
    expect(snapshotAuthorizedSet).not.toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('matches prepareCampaignHold on the happy path (set size == covered)', async () => {
    // 350 guests, coverage 300, ₪4, legacy 0/0 → hold 1200, ceiling 1400 — the
    // SAME numbers the prepareCampaignHold test above asserts.
    const { builder } = adminWith<Record<string, unknown>>({ data: null, error: null });
    vi.mocked(countUniqueContactsForEvent).mockResolvedValue(350);
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        f({ data: { event_id: 'e1', price_per_reached: 4, template_id: 'pkg1' }, error: null }),
      )
      .mockImplementationOnce((f) => f({ data: { reasonable_coverage_contacts: 300 }, error: null }))
      .mockImplementationOnce((f) => f({ data: { min_hold_floor: 0, hold_buffer_pct: 0 }, error: null }));

    const r = await previewCampaignHoldSizing('c1');

    expect(r).toEqual({ holdAmount: 1200, ceiling: 1400, full: 350, covered: 300 });
  });
});
```

- [ ] **Step 2: ודא כישלון** — `npx vitest run src/lib/data/campaigns.test.ts -t previewCampaignHoldSizing` → FAIL (לא מיוצא).

- [ ] **Step 3: יישום ב-`campaigns.ts`** — החלף את `prepareCampaignHold` (שורות 575-640) ב:

```ts
// Everything hold sizing depends on, read ONCE and shared by the read-only
// PREVIEW (payment page, before the card) and the real prepareCampaignHold
// (after the lock). One code path ⇒ the number the customer sees before
// entering a card is the number the route will hold, barring a guest-list
// change in between. Throws the same short, PII-free Hebrew strings as before.
async function loadHoldSizingInputs(campaignId: string): Promise<{
  eventId: string;
  price: number;
  base: number;
  included: number;
  full: number;
  covered: number;
  minHoldFloor: number;
  holdBufferPct: number;
}> {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('event_id, price_per_reached, template_id, base_price, included_reached')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) throw new Error('הקמפיין לא נמצא');

  const price = Number(campaign.price_per_reached);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('מחיר לאיש קשר אינו תקין');
  }
  // Base+overage snapshot frozen at create (plan S3); 0/0 = pre-model campaign.
  const base = Number(campaign.base_price ?? 0);
  const included = Number(campaign.included_reached ?? 0);

  // full = the CURRENT unique-contact count (verifies ownership server-side).
  // May be 0 — same reasoning as createCampaign: the flat base fee prices a
  // 0-contact hold just fine. A legacy (base=0) campaign still can't place a
  // ₪0 hold — route.ts's own `holdAmount <= 0` check is the guard for that.
  const full = await countUniqueContactsForEvent(campaign.event_id);
  const { reasonableCoverage, minHoldFloor, holdBufferPct } =
    await getHoldSizingKnobs(campaign.template_id, full);
  const covered = computeCovered(full, reasonableCoverage);

  return { eventId: campaign.event_id, price, base, included, full, covered, minHoldFloor, holdBufferPct };
}

// Read-only preview for the payment page (audit §6 — "סכום תפיסת המסגרת כעת").
// No snapshot, no write. The basis is `covered`; prepareCampaignHold uses
// max(covered, frozenSetSize), which equals covered on the happy path.
export async function previewCampaignHoldSizing(
  campaignId: string,
): Promise<CampaignHoldSizing> {
  const i = await loadHoldSizingInputs(campaignId);
  return {
    holdAmount: computeHoldAmountBaseOverage(
      i.base,
      i.included,
      i.price,
      i.covered,
      i.minHoldFloor,
      i.holdBufferPct,
    ),
    ceiling: computeCeilingBaseOverage(i.base, i.included, i.price, i.full),
    full: i.full,
    covered: i.covered,
  };
}

// Phase-2 hold preparation. Run at the J5 step AFTER the hold slot is locked and
// BEFORE the card hold is placed. In one coherent step it:
//   1. recomputes `full` = the CURRENT unique-contact count (the guest list may
//      have grown since create) and resolves the admin knobs,
//   2. FREEZES the authorized SET to the COVERED contacts (min(full, reasonable))
//      — reached ⊆ set by construction (the money-leak guard); the set MUST exist
//      before any billing, so this precedes the hold,
//   3. recomputes + persists max_contacts = full (NON-NULL — closes the nullable-
//      uncapped flag) and max_charge_ceiling = full × price (D1=No — closes the
//      create→approval growth gap; the ceiling is NEVER lowered to covered),
//   4. returns holdAmount = max(min_hold_floor, covered × price × (1 + buffer)).
// The hold may be < ceiling — safe ONLY because the SET caps reached at covered.
// CROSS-AGENT CONTRACT: snapshotAuthorizedSet MUST yield set == the current
// top-`covered` contacts (REPLACE semantics), so a retry after the list / coverage
// shrinks cannot leave a stale, larger set above the lowered hold.
// NOTE: the set is no longer a hard freeze — reconcile_authorized_set (live since
// 2026-07-21) admits later guests up to funded_cap; see Task 0 of the 2.9 plan.
export async function prepareCampaignHold(
  campaignId: string,
): Promise<CampaignHoldSizing> {
  const admin = createAdminClient();
  const i = await loadHoldSizingInputs(campaignId);

  // FREEZE the authorized set BEFORE any billing — the binding cap on `reached`.
  // snapshotAuthorizedSet has REPLACE semantics (set == current top-`covered`
  // contacts; stale/orphan members pruned), and returns the RESULTING set size —
  // on the happy path == `covered`. We STILL size the hold to
  // max(covered, frozenSetSize) as belt-and-suspenders: the hold always covers the
  // actual frozen set even if they ever diverge. reached ⊆ set ⇒
  // charge ≤ frozenSetSize × price ≤ hold — the SAFETY INVARIANT holds.
  const frozenSetSize = await snapshotAuthorizedSet(i.eventId, campaignId, i.covered);
  const holdBasis = Math.max(i.covered, frozenSetSize);

  // Recompute + persist the ceiling and max_contacts (= full, NON-NULL) from the
  // CURRENT full count. Base+overage ceiling = base + max(0, full − included) ×
  // overage (with base/included 0 this is full × price — unchanged); never
  // lowered to covered, and always ≥ base so the flat fee is never capped away.
  const ceiling = computeCeilingBaseOverage(i.base, i.included, i.price, i.full);
  const { error: upErr } = await admin
    .from('campaigns')
    .update({ max_contacts: i.full, max_charge_ceiling: ceiling })
    .eq('id', campaignId);
  if (upErr) throw new Error('עדכון תקרת החיוב נכשל');

  const holdAmount = computeHoldAmountBaseOverage(
    i.base,
    i.included,
    i.price,
    holdBasis,
    i.minHoldFloor,
    i.holdBufferPct,
  );
  return { holdAmount, ceiling, full: i.full, covered: i.covered };
}
```

(סדר הקריאות ל-DB זהה לקודם — campaign → app_settings → packages → update — ולכן 6 הבדיקות הקיימות של `prepareCampaignHold` נשארות ירוקות בלי שינוי.)

- [ ] **Step 4: יישום ב-`payment/page.tsx`**

הוסף לייבוא: `import { getCampaign, previewCampaignHoldSizing } from '@/lib/data/campaigns';` (במקום הייבוא הקיים של `getCampaign`).

החלף את הבלוק משורה 167 (`// Verified gap (30.8): the ceiling line…`) עד סוף `const summary = (…);` (שורה 194) ב:

```tsx
  // Audit §6: one short, explicit summary instead of a paragraph the customer
  // has to parse. Every number is data — the campaign's pricing snapshot and the
  // LIVE sizing preview (the same helpers the authorize route will use) — never
  // a hardcoded price. The preview is best-effort: if it fails, the page still
  // renders with the snapshot ceiling and no "current hold" line, and the
  // authorize route recomputes authoritatively on submit anyway.
  let sizing: Awaited<ReturnType<typeof previewCampaignHoldSizing>> | null = null;
  if (canHold) {
    try {
      sizing = await previewCampaignHoldSizing(campaignId);
    } catch (err) {
      console.error('[payment] hold sizing preview failed', {
        campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const basePrice = Number(campaign.base_price ?? 0);
  const included = Number(campaign.included_reached ?? 0);
  const overage = Number(campaign.price_per_reached ?? 0);
  const holdAmount = sizing?.holdAmount ?? campaign.max_charge_ceiling;
  const ceiling = sizing?.ceiling ?? campaign.max_charge_ceiling;

  const summary = (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="font-semibold">מה נתפוס עכשיו ומה נחייב</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {basePrice > 0 ? (
          <>
            <dt className="text-muted-foreground">דמי הפעלה</dt>
            <dd>
              <strong>{ils(basePrice)}</strong> — נגבים בכל מקרה, גם אם אף איש קשר לא השיב
            </dd>
          </>
        ) : null}
        {included > 0 ? (
          <>
            <dt className="text-muted-foreground">כלולים בדמי ההפעלה</dt>
            <dd>עד {included.toLocaleString('he-IL')} אנשי קשר שהושגו</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{included > 0 ? 'מעבר לכך' : 'מחיר לאיש קשר שהושג'}</dt>
        <dd>{ils(overage)} לכל איש קשר שהושג</dd>
        {sizing ? (
          <>
            <dt className="text-muted-foreground">אנשי קשר ברשימה כעת</dt>
            <dd>{sizing.full.toLocaleString('he-IL')}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">סכום תפיסת המסגרת כעת</dt>
        <dd>
          <strong>{ils(holdAmount)}</strong> — תפיסה בלבד, לא חיוב
        </dd>
        <dt className="text-muted-foreground">תקרת החיוב</dt>
        <dd>{ils(ceiling)}</dd>
        <dt className="text-muted-foreground">מתי מתבצע החיוב</dt>
        <dd>לאחר האירוע, עם סגירת הקמפיין וגמר החשבון — לפי התוצאות בפועל ולכל היותר עד התקרה</dd>
        <dt className="text-muted-foreground">אם אף איש קשר לא משיב</dt>
        <dd>{basePrice > 0 ? `תחויבו בדמי ההפעלה (${ils(basePrice)}) בלבד.` : 'לא תחויבו כלל.'}</dd>
      </dl>
      {sizing && sizing.full === 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          הרשימה ריקה כעת. תקרת החיוב ומסגרת האשראי נקבעות לפי המוזמנים שברשימה ברגע התפיסה
          {included > 0
            ? ` — אחרי ההפעלה תוכלו להוסיף עד ${included.toLocaleString('he-IL')} אנשי קשר במסגרת דמי ההפעלה.`
            : '.'}{' '}
          <Link href={`/app/events/${id}/guests`} className="underline">
            להוספת מוזמנים לפני
          </Link>
        </p>
      ) : null}
    </section>
  );
```

והחלף את הקריאה לרכיב (שורות 217-223):

```tsx
          <CampaignHoldForm
            campaignId={campaignId}
            companyId={publicConfig.companyId}
            apiPublicKey={publicConfig.apiPublicKey}
            holdAmount={holdAmount ?? campaign.max_charge_ceiling}
            signerName={profile?.full_name?.trim() || 'לקוח KALFA'}
          />
```

- [ ] **Step 5: יישום ב-`hold-form.tsx`**

- שורה 111: `ceilingAmount: number;` → `holdAmount: number;` ושורה 117 (`ceilingAmount,` בפרמטרים) → `holdAmount,`.
- שורות 146-150: `formattedCeiling` → `formattedHold`, `ceilingAmount.toLocaleString` → `holdAmount.toLocaleString`.
- שורה 393: ``label={`תופסים מסגרת אשראי בסך ${formattedHold}`}``.
- שורה 225 (איור הכרטיס — §6 "תופס שטח גדול בנייד"): `className="mb-5 flex justify-center"` → `className="mb-5 hidden justify-center sm:flex"`. (הסתרה בנייד היא הבחירה הדטרמיניסטית; הקטנה ב-`scale` דורשת בדיקה ויזואלית — אם הבעלים מעדיף להקטין, זו שורה אחת לשינוי בשלב הבדיקה בדפדפן.)

- [ ] **Step 6: ודא הצלחה**

Run: `npx vitest run src/lib/data/campaigns.test.ts 'src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/hold-form.test.ts' && npx tsc --noEmit`
Expected: PASS (כולל 6 בדיקות `prepareCampaignHold` הקיימות); tsc ירוק.

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/campaigns.ts src/lib/data/campaigns.test.ts 'src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment'
git commit -m "feat(campaign): explicit, data-driven hold summary with the real hold amount"
```

---

### Task 5: הפעלה אוטומטית מיד אחרי תפיסה מאושרת (§1)

**Files:**
- Modify: `src/app/api/campaigns/[id]/authorize/route.ts:6-12, 282-300`
- Modify: `src/app/api/campaigns/[id]/authorize/route.test.ts`

**Interfaces:**
- Consumes: `activateCampaign(campaignId)` (`campaigns.ts:885`, actor ברירת מחדל `owner` → `requireOwnedEvent` דרך ה-cookie DAL — זמין ב-Route Handler הזה כי `requireUser` כבר עבר).
- Produces: הפניה `payment?held=1` (הופעל) או `payment?held=1&activate=failed` (התפיסה נשמרה, ההפעלה סורבה).

- [ ] **Step 1: בדיקות נכשלות**

ב-`route.test.ts`: הוסף `activateCampaign: vi.fn(),` ל-`vi.mock('@/lib/data/campaigns', …)`; הוסף `activateCampaign, markCampaignHoldFailed` לייבוא מ-`@/lib/data/campaigns`; הוסף `import { SumitDeclinedError } from '@/lib/sumit/charge';`. חלץ את גוף ה-`beforeEach` הקיים (שורות 70-125) לפונקציה `function happyPath() { … }` וקרא לה משני ה-`describe`. הוסף ל-`happyPath()`: `vi.mocked(activateCampaign).mockResolvedValue(undefined);`. הוסף:

```ts
describe('POST /api/campaigns/[id]/authorize — auto-activation after a confirmed hold (audit §1)', () => {
  beforeEach(happyPath);

  it('activates the campaign right after the hold is persisted and lands on ?held=1', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(recordCampaignHold).toHaveBeenCalledTimes(1);
    expect(activateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID);
    // The hold is the source of truth — it must be persisted BEFORE activation.
    expect(vi.mocked(recordCampaignHold).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(activateCampaign).mock.invocationCallOrder[0],
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `${APP_ORIGIN}/app/events/${EVENT_ID}/campaign/${CAMPAIGN_ID}/payment?held=1`,
    );
  });

  it('keeps the confirmed hold and lands on ?held=1&activate=failed when activation is refused', async () => {
    vi.mocked(activateCampaign).mockRejectedValue(
      new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי'),
    );

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location') as string);
    expect(loc.pathname).toBe(`/app/events/${EVENT_ID}/campaign/${CAMPAIGN_ID}/payment`);
    expect(loc.searchParams.get('held')).toBe('1');
    expect(loc.searchParams.get('activate')).toBe('failed');
    // The hold itself is NOT rolled back or marked failed — it is real at SUMIT.
    expect(markCampaignHoldFailed).not.toHaveBeenCalled();
  });

  it('never activates when the card hold was declined', async () => {
    vi.mocked(authorizeHoldSumit).mockRejectedValue(new SumitDeclinedError());

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(activateCampaign).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location') as string).searchParams.get('error')).toBe(
      'hold_declined',
    );
  });

  it('never activates when persisting the confirmed hold fails', async () => {
    vi.mocked(recordCampaignHold).mockRejectedValue(new Error('שמירת תפיסת המסגרת נכשלה'));

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(activateCampaign).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location') as string).searchParams.get('error')).toBe(
      'hold_review',
    );
  });
});
```

- [ ] **Step 2: ודא כישלון** — `npx vitest run 'src/app/api/campaigns/[id]/authorize/route.test.ts'` → 2 נכשלות (`activateCampaign` לא נקרא; אין `activate=failed`).

- [ ] **Step 3: יישום ב-`route.ts`**

הוסף `activateCampaign,` לייבוא מ-`@/lib/data/campaigns` (שורות 6-12). החלף את השורה האחרונה `return r303(payUrl());` (300) ב:

```ts
  // Audit §1: the hold was the customer's LAST real decision. Everything
  // activateCampaign checks is already true here — signed (status approved),
  // held (capture_status authorized, just persisted), future event (L1 above),
  // confirmed event (R9 above), owner session (requireUser above) — so the
  // campaign starts now instead of asking for one more click on another page.
  // FAIL-SAFE: the hold is real and persisted whatever happens below. If the
  // transition is refused (a concurrent status change, a guard tripping), the
  // customer lands on the SAME page with an explicit "הפעלת הקמפיין עכשיו"
  // button — never a silent bounce back to the event page. Status is written
  // ONLY by activateCampaign (lifecycle parity test), never here.
  try {
    await activateCampaign(campaignId);
  } catch (err) {
    console.error('[hold] auto-activation after a confirmed hold was refused', {
      campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
    const url = payUrl();
    url.searchParams.set('activate', 'failed');
    return r303(url);
  }

  return r303(payUrl());
```

- [ ] **Step 3b: auditability (F12) — רשומת `activity_log` על הפעלה**

ב-`campaigns.ts` הוסף `import { logActivity } from '@/lib/data/activity';` (מודול server-only קיים — `authorize/route.ts:21` מייבא אותו). ב-`activateCampaign` (885-927), מיד אחרי ה-`sendSlackAlert` ולפני זריעת התודה, הוסף:

```ts
  // Auditability (CLAUDE.md): the commercial start of the campaign, previously
  // unlogged. Best-effort like the hold's own log — never fails the activation.
  // Needs event_id; the transition helper returns only the date, so one narrow
  // read. No PII: ids + actor kind only.
  try {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from('campaigns')
      .select('event_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (row?.event_id) {
      await logActivity({
        eventId: row.event_id,
        action: 'campaign.activated',
        meta: { campaignId, actor: actor.kind },
      });
    }
  } catch (err) {
    console.error('[campaign-lifecycle] logActivity(campaign.activated) failed (non-fatal)', {
      campaignId,
      err,
    });
  }
```

בדיקה ב-`campaigns.test.ts` (ה-describe `'campaign lifecycle transitions'`): הוסף `vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));` בראש הקובץ ומקרה:

```ts
  it('activateCampaign writes a campaign.activated activity row (auditability)', async () => {
    const { builder } = adminWith({ data: { id: 'c1', event_id: 'e1' }, error: null });
    vi.mocked(requireOwnedEvent).mockResolvedValue(ownedEvent());
    vi.spyOn(builder, 'then').mockImplementation((f) => f({ data: { id: 'c1', event_id: 'e1' }, error: null }));

    await activateCampaign('c1');

    expect(logActivity).toHaveBeenCalledWith({
      eventId: 'e1',
      action: 'campaign.activated',
      meta: { campaignId: 'c1', actor: 'owner' },
    });
  });
```

(ודא ש-`then` ממוקק מחזיר `event_id` גם לקריאת ה-select הנוספת; הבדיקות הקיימות של activate ממוקקות באותו אופן — `adminWith({ data: { id: 'c1', event_id: 'e1' } })` — ולכן נשארות ירוקות.)

- [ ] **Step 4: ודא הצלחה**

Run: `npx vitest run 'src/app/api/campaigns/[id]/authorize/route.test.ts' src/lib/data/campaign-lifecycle-parity.test.ts src/lib/data/campaigns.test.ts`
Expected: PASS (הבדיקות הקיימות של CSRF + 4 חדשות + הבדיקה החדשה של activity; ה-parity test עדיין ירוק — ה-route לא כותב `status`).

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/campaigns/[id]/authorize'
git commit -m "feat(campaign): activate automatically once the card hold is confirmed"
```

---

### Task 6: מסך הצלחה אחרי ההפעלה + כפתור הפעלה במקום (§1, §7)

**Files:**
- Create: `…/campaign/[campaignId]/payment/activate-now-form.tsx`
- Modify: `…/campaign/[campaignId]/payment/page.tsx:1-16, 49-57, 112-134`
- Modify: `…/campaign/campaign-actions.ts:225-246` (revalidate נוסף)

**Interfaces:**
- Consumes: `activateCampaignAction(eventId, campaignId, prev, formData)` (קיים), `HeldAnalytics` (קיים), `buttonVariants`.
- Produces: `ActivateNowForm({ action })`.

- [ ] **Step 1: הוסף revalidate ב-`activateCampaignAction`** (campaign-actions.ts:244) — כדי שהעמוד שממנו לחצו (עמוד התשלום או עמוד האירוע) יתרענן אחרי ההפעלה:

```ts
  revalidatePath(`/app/events/${eventId}`);
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}`);
  revalidatePath(`/app/events/${eventId}/campaign/${campaignId}/payment`);
  return { notice: 'הקמפיין הופעל — הפניות יחלו לפי לוח הזמנים.' };
```

- [ ] **Step 2: צור `activate-now-form.tsx`**

```tsx
'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The audit-§1 fallback: when auto-activation after the hold was refused (or a
// campaign was held before auto-activation existed), the owner activates HERE —
// on the page they are already on — instead of being sent back to the event
// page to discover one more button. Same Server Action as the manage page.
export function ActivateNowForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
      <SubmitButton>הפעלת הקמפיין עכשיו</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 3: עדכן `payment/page.tsx`**

ייבוא: הוסף `import { buttonVariants } from '@/components/ui/button';`, `import { activateCampaignAction } from '../../campaign-actions';`, `import { ActivateNowForm } from './activate-now-form';`.

`searchParams` (שורה 54): `searchParams: Promise<{ error?: string; held?: string; activate?: string }>;` ושורה 57: `const { error, activate } = await searchParams;`.

החלף את הבלוק `if (campaign.capture_status === 'authorized') { … }` (שורות 112-134) ב:

```tsx
  // Held. Two faces:
  //  • ACTIVE — auto-activation succeeded → the success screen (audit §1/§7):
  //    the next task is adding guests, not "managing the campaign".
  //  • NOT active — auto-activation was refused, or the hold predates it →
  //    activate HERE, in place; never send the owner back to the event page.
  // HeldAnalytics fires payment_authorized once when arriving via ?held=1 and
  // strips only that param (activate=failed survives for this render).
  if (campaign.capture_status === 'authorized') {
    // auth_amount is the REAL J5 hold (sized to covered), which can be less than
    // the ceiling — show what was actually authorized on the card.
    const heldAmount = campaign.auth_amount ?? campaign.max_charge_ceiling;

    if (campaign.status === 'active') {
      return (
        <div className="mx-auto max-w-2xl space-y-6">
          {header}
          <section className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6 text-center">
            <p className="text-2xl font-bold text-success">הקמפיין פעיל</p>
            <p className="text-sm">
              נתפסה מסגרת אשראי בסך {ils(heldAmount)}. הפניות לאורחים יישלחו לפי לוח הזמנים;
              החיוב בפועל ייעשה לאחר האירוע, לפי התוצאות, ולכל היותר עד{' '}
              {ils(campaign.max_charge_ceiling)}.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={`/app/events/${id}/guests`} className={buttonVariants()}>
                הוספת מוזמנים
              </Link>
              <Link
                href={`/app/events/${id}/campaign/${campaignId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                מעבר לניהול הקמפיין
              </Link>
            </div>
          </section>
          <HeldAnalytics />
        </div>
      );
    }

    const canActivateHere =
      !isPast && ['approved', 'scheduled', 'paused'].includes(campaign.status);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ✓ נתפסה מסגרת אשראי בסך {ils(heldAmount)}. החיוב בפועל ייעשה לאחר האירוע, לפי
          התוצאות, ולכל היותר עד {ils(campaign.max_charge_ceiling)}.
        </p>
        {activate === 'failed' ? (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            הקמפיין עוד לא הופעל אוטומטית. אפשר להפעיל אותו כעת.
          </p>
        ) : null}
        {canActivateHere ? (
          <ActivateNowForm action={activateCampaignAction.bind(null, id, campaignId)} />
        ) : (
          <Link
            href={`/app/events/${id}/campaign/${campaignId}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            מעבר לניהול הקמפיין
          </Link>
        )}
        <HeldAnalytics />
      </div>
    );
  }
```

- [ ] **Step 4: ודא**

Run: `npx tsc --noEmit && npx vitest run 'src/app/(customer)/app/events/[id]/campaign/campaign-actions.test.ts'`
Expected: ירוק. בדיקת דפדפן (Task 12): קמפיין `approved`+`authorized` שאינו `active` מציג את הכפתור במקום; קמפיין `active` מציג את מסך ההצלחה.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(customer)/app/events/[id]/campaign'
git commit -m "feat(campaign): success screen after activation, activate-in-place fallback"
```

---

### Task 7: "אישור פרטי האירוע והמשך" — פעולה אחת שמאשרת, יוצרת את הקמפיין ומובילה להסכם (§2)

**Files:**
- Modify: `…/campaign/campaign-actions.ts:39-65, 468-492`
- Modify: `…/campaign/campaign-actions.test.ts`

**Interfaces:**
- Consumes: `requireOwnedEvent`, `publishEvent`, `syncEventToExchange`, `createCampaign` (קיימים).
- Produces: `setupCampaignAction(eventId, prev, formData)` — מאשר אם `draft`, יוצר/ממשיך קמפיין, `redirect` ל-`/approve`. `publishEventAction` **נמחק** (הממשק היחיד שלו — `event-status-actions.tsx` — משתנה ב-Task 8).

- [ ] **Step 1: בדיקות**

ב-`campaign-actions.test.ts`: הוסף בראש הקובץ (אחרי `vi.mock('next/cache', …)`):

```ts
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it
// (same as guests-actions.test.ts) so the happy path is observable.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    redirect: vi.fn(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/x;307;',
      });
    }),
  };
});
```

הוסף `createCampaign` לייבוא מ-`@/lib/data/campaigns`, `setupCampaignAction` לייבוא מ-`./campaign-actions`, `import { redirect } from 'next/navigation';`. **מחק** את `describe('publishEventAction', …)` (שורות 65-116) ואת `publishEventAction` מהייבוא. הוסף:

```ts
describe('setupCampaignAction — "אישור פרטי האירוע והמשך" (audit §2)', () => {
  const e1 = { id: 'e1', name: 'x', status: 'draft', event_type: 'wedding', event_date: '2999-01-01T00:00:00Z', rsvp_deadline: null } as const;

  it('on a DRAFT event: confirms (publishEvent), syncs Exchange, creates the campaign, redirects to /approve', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(publishEvent).mockResolvedValue(undefined);
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c1' });

    await expect(setupCampaignAction('e1', null, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).toHaveBeenCalledWith('e1');
    expect(syncEventToExchange).toHaveBeenCalledWith('e1');
    expect(createCampaign).toHaveBeenCalledWith('e1');
    expect(vi.mocked(publishEvent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createCampaign).mock.invocationCallOrder[0],
    );
    expect(redirect).toHaveBeenCalledWith('/app/events/e1/campaign/c1/approve');
  });

  it('on an already-confirmed (active) event: skips publish, creates-or-continues, redirects', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...e1, status: 'active' } as never);
    vi.mocked(createCampaign).mockResolvedValue({ id: 'c1' });

    await expect(setupCampaignAction('e1', null, new FormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(publishEvent).not.toHaveBeenCalled();
    expect(createCampaign).toHaveBeenCalledWith('e1');
  });

  it('surfaces the data layer\'s Hebrew message when confirming fails, and never creates a campaign', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue(e1 as never);
    vi.mocked(publishEvent).mockRejectedValue(new Error('יש להגדיר מועד עתידי לפני אישור פרטי האירוע'));

    const result = await setupCampaignAction('e1', null, new FormData());

    expect(result?.error).toBe('יש להגדיר מועד עתידי לפני אישור פרטי האירוע');
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('surfaces createCampaign\'s own gate message (e.g. celebrants) without redirecting', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({ ...e1, status: 'active' } as never);
    vi.mocked(createCampaign).mockRejectedValue(
      new Error('יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה'),
    );

    const result = await setupCampaignAction('e1', null, new FormData());

    expect(result?.error).toBe('יש למלא את פרטי בעלי השמחה בעריכת האירוע לפני הפעלת אישורי הגעה');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('re-throws a Next.js control-flow signal from the ownership gate', async () => {
    vi.mocked(requireOwnedEvent).mockRejectedValue(NEXT_NOT_FOUND);

    await expect(setupCampaignAction('e1', null, new FormData())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: ודא כישלון** — `npx vitest run 'src/app/(customer)/app/events/[id]/campaign/campaign-actions.test.ts'` → הבדיקות החדשות נכשלות (`publishEvent` לא נקרא).

- [ ] **Step 3: יישום** — החלף את `setupCampaignAction` (שורות 39-65) ב:

```ts
// "אישור פרטי האירוע והמשך" — ONE owner decision that (audit §2 / recommended
// flow step 5): confirms the event details (the former "publish" — locks
// event_date/rsvp_deadline per R5, moves draft → active so R9 lets a campaign
// exist), then creates-or-continues the event's single campaign, then lands
// straight on the agreement. eventId is bound on the client; there is NO form
// input — the canonical template and the derived window are resolved
// server-side. On an already-confirmed event this is a plain continue.
// publishEvent/createCampaign throw only our own safe Hebrew messages, so
// surfacing err.message is safe and useful. If createCampaign refuses AFTER a
// successful confirm (its own gates: celebrants/venue/date), the event stays
// confirmed — the owner fixes the detail and clicks again (now a continue).
// The setup page (setup-steps.ts) shows those prerequisites up front so this
// is the rare path, not the normal one.
export async function setupCampaignAction(
  eventId: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  let created: Awaited<ReturnType<typeof createCampaign>>;
  try {
    const event = await requireOwnedEvent(eventId);
    if (event.status === 'draft') {
      await publishEvent(eventId);
      // Best-effort Exchange calendar sync (Layer 2) — never throws.
      await syncEventToExchange(eventId);
    }
    created = await createCampaign(eventId);
  } catch (err) {
    unstable_rethrow(err);
    return {
      error:
        err instanceof Error ? err.message : 'אישור פרטי האירוע נכשל. נסו שוב.',
    };
  }

  revalidatePath(`/app/events/${eventId}`);
  revalidatePath(`/app/events/${eventId}/campaign`);
  redirect(`/app/events/${eventId}/campaign/${created.id}/approve`);
}
```

**מחק** את `publishEventAction` (שורות 473-492) ועדכן את ההערה מעליה (468-471) ל-`// --- Event lifecycle (R6/R7) — Close, S2.5a. Confirm (publish) lives in setupCampaignAction above.`. `publishEvent` נשאר בייבוא (נצרך כאן).

- [ ] **Step 4: ודא** — `npx vitest run 'src/app/(customer)/app/events/[id]/campaign/campaign-actions.test.ts'` → PASS. `npx tsc --noEmit` **ייכשל** על `events/[id]/page.tsx:18,97` (מייבא `publishEventAction`) — זה צפוי ונפתר ב-Task 8; אם עוצרים כאן, השאר את `publishEventAction` עד Task 8.

- [ ] **Step 5: Commit (יחד עם Task 8 אם tsc אדום)**

```bash
git add 'src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts' 'src/app/(customer)/app/events/[id]/campaign/campaign-actions.test.ts'
git commit -m "feat(campaign): confirm event details and continue to the agreement in one step"
```

---

### Task 8: עמוד ההקמה — שלבים ברורים במקום שלושה כפתורים (§2, §3, §7, זרימה מומלצת 4-9)

**Files:**
- Create: `src/lib/data/setup-steps.ts`, `src/lib/data/setup-steps.test.ts`
- Create: `src/app/(customer)/app/events/[id]/setup-steps.tsx`
- Modify: `src/lib/data/guests.ts` (`countGuests`)
- Modify: `…/events/[id]/campaign-setup-form.tsx`
- Modify: `…/events/[id]/event-status-actions.tsx`
- Modify: `…/events/[id]/page.tsx`
- Delete: `…/events/[id]/campaign-section.tsx`

**Interfaces:**
- Consumes: `campaignStage`, `CAMPAIGN_STAGE_LABELS/VARIANTS`, `eventStatusLabel` (Task 1); `setupCampaignAction` (Task 7); `celebrantsCompleteFor` (`validation/schemas.ts:417`); `isBeforeTomorrowIL` (`event-date.ts:99`).
- Produces: `computeSetupSteps(input): { steps: SetupStep[]; stage: CampaignStage }`, `missingEventPrerequisites(event): string[]`, `SETUP_STEP_LABELS`; `countGuests(eventId): Promise<number>`; `<SetupSteps event campaign guestCount isPast />`; `CampaignSetupForm({ action, label, children? })`; `EventStatusActions({ status, hasBlockingCampaign, closeAction })`.

- [ ] **Step 1: בדיקות נכשלות** — צור `src/lib/data/setup-steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  NO_GUESTS_HINT,
  PAST_EVENT_HINT,
  computeSetupSteps,
  missingEventPrerequisites,
  type SetupInput,
} from '@/lib/data/setup-steps';

const FUTURE = '2999-01-01T18:00:00+00:00';
const readyEvent: SetupInput['event'] = {
  status: 'draft',
  event_type: 'wedding',
  event_date: FUTURE,
  venue_name: 'אולם',
  celebrants: { groom: 'דני', bride: 'דנה' },
};

function stateOf(input: SetupInput) {
  return Object.fromEntries(computeSetupSteps(input).steps.map((s) => [s.key, s.state]));
}

describe('missingEventPrerequisites', () => {
  it('lists every missing ingredient createCampaign would refuse on', () => {
    expect(
      missingEventPrerequisites({
        status: 'draft',
        event_type: 'wedding',
        event_date: null,
        venue_name: '',
        celebrants: null,
      }),
    ).toEqual(['תאריך אירוע עתידי', 'פרטי בעלי השמחה', 'מקום האירוע']);
  });

  it('is empty when date is future, celebrants complete, venue set', () => {
    expect(missingEventPrerequisites(readyEvent)).toEqual([]);
  });
});

describe('computeSetupSteps', () => {
  it('draft + ready + no guests → confirm is current, guests is a soft (pending) recommendation', () => {
    const r = computeSetupSteps({ event: readyEvent, campaign: null, guestCount: 0, isPast: false });
    expect(stateOf({ event: readyEvent, campaign: null, guestCount: 0, isPast: false })).toEqual({
      details: 'done',
      guests: 'pending',
      confirm: 'current',
      sign: 'pending',
      pay: 'pending',
      live: 'pending',
    });
    expect(r.steps.find((s) => s.key === 'guests')?.hint).toBe(NO_GUESTS_HINT);
    expect(r.stage).toBe('not_set');
  });

  it('draft with missing prerequisites → confirm is blocked with the list', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, venue_name: null },
      campaign: null,
      guestCount: 3,
      isPast: false,
    });
    const confirm = r.steps.find((s) => s.key === 'confirm');
    expect(confirm?.state).toBe('blocked');
    expect(confirm?.hint).toBe('יש להשלים: מקום האירוע');
  });

  it('confirmed event, campaign awaiting signature → sign is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'pending_approval', capture_status: null },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ confirm: 'done', sign: 'current', pay: 'pending', live: 'pending', guests: 'done' });
  });

  it('confirmed event, NO campaign yet → sign is current (create-or-continue)', () => {
    expect(
      stateOf({ event: { ...readyEvent, status: 'active' }, campaign: null, guestCount: 3, isPast: false }),
    ).toMatchObject({ confirm: 'done', sign: 'current' });
  });

  it('signed, no hold → pay is current', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: null },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ sign: 'done', pay: 'current', live: 'pending' });
  });

  it('held but not active → live is current (activate in place)', () => {
    expect(
      stateOf({
        event: { ...readyEvent, status: 'active' },
        campaign: { status: 'approved', capture_status: 'authorized' },
        guestCount: 3,
        isPast: false,
      }),
    ).toMatchObject({ pay: 'done', live: 'current' });
  });

  it('active campaign → everything done, stage active', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'active', capture_status: 'authorized' },
      guestCount: 0,
      isPast: false,
    });
    expect(r.stage).toBe('active');
    expect(r.steps.every((s) => s.key === 'guests' || s.state === 'done')).toBe(true);
    // Guests still empty AFTER activation: the hint changes — the campaign has
    // nobody to send to.
    expect(r.steps.find((s) => s.key === 'guests')?.hint).toBe('הפניות יישלחו רק למוזמנים שברשימה');
  });

  it('paused → live is current with the paused hint', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'paused', capture_status: 'authorized' },
      guestCount: 3,
      isPast: false,
    });
    expect(r.steps.find((s) => s.key === 'live')).toMatchObject({ state: 'current', hint: 'הקמפיין מושהה' });
  });

  it('past event → the current step becomes blocked with the past-event hint', () => {
    const r = computeSetupSteps({
      event: { ...readyEvent, status: 'active' },
      campaign: { status: 'approved', capture_status: null },
      guestCount: 3,
      isPast: true,
    });
    expect(r.steps.find((s) => s.key === 'pay')).toMatchObject({ state: 'blocked', hint: PAST_EVENT_HINT });
  });

  it('exactly one step is current in every non-terminal state', () => {
    const cases: SetupInput[] = [
      { event: readyEvent, campaign: null, guestCount: 0, isPast: false },
      { event: { ...readyEvent, status: 'active' }, campaign: null, guestCount: 0, isPast: false },
      { event: { ...readyEvent, status: 'active' }, campaign: { status: 'pending_approval', capture_status: null }, guestCount: 0, isPast: false },
      { event: { ...readyEvent, status: 'active' }, campaign: { status: 'approved', capture_status: 'hold_failed' }, guestCount: 0, isPast: false },
      { event: { ...readyEvent, status: 'active' }, campaign: { status: 'approved', capture_status: 'authorized' }, guestCount: 0, isPast: false },
    ];
    for (const c of cases) {
      expect(computeSetupSteps(c).steps.filter((s) => s.state === 'current')).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: ודא כישלון** — `npx vitest run src/lib/data/setup-steps.test.ts` → FAIL (מודול לא קיים).

- [ ] **Step 3: צור `src/lib/data/setup-steps.ts`**

```ts
import type { Enums } from '@/lib/supabase/types';
import { campaignStage, type CampaignStage } from '@/lib/data/event-labels';
import { isBeforeTomorrowIL } from '@/lib/data/event-date';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';

// Pure, isomorphic model of the event's SETUP page (audit "הזרימה המומלצת"
// steps 4–9): what is done, what the owner does next, what is blocked and why.
// No data access — the page loads the rows and calls computeSetupSteps. Kept
// out of the component so the whole decision table is unit-tested.

type EventStatus = Enums<'event_status'>;
type EventType = Enums<'event_type'>;
type CampaignStatus = Enums<'campaign_status'>;

export type SetupStepKey = 'details' | 'guests' | 'confirm' | 'sign' | 'pay' | 'live';
export type SetupStepState = 'done' | 'current' | 'pending' | 'blocked';
export interface SetupStep {
  key: SetupStepKey;
  state: SetupStepState;
  hint?: string;
}

export interface SetupInput {
  event: {
    status: EventStatus;
    event_type: EventType;
    event_date: string | null;
    venue_name: string | null;
    celebrants: unknown;
  };
  campaign: { status: CampaignStatus; capture_status: string | null } | null;
  guestCount: number;
  isPast: boolean;
}

export const SETUP_STEP_LABELS: Record<SetupStepKey, string> = {
  details: 'פרטי האירוע',
  guests: 'הוספת מוזמנים',
  confirm: 'אישור פרטי האירוע',
  sign: 'קריאת ההסכם וחתימה',
  pay: 'אמצעי תשלום ותפיסת מסגרת',
  live: 'הקמפיין פעיל',
};

export const PAST_EVENT_HINT = 'מועד האירוע חלף — לא ניתן להמשיך בהקמה';
// G1 (soft gate): the ceiling and the card hold are sized from the guest list
// at the moment of the hold and are not raised afterwards — say so BEFORE the
// owner confirms, without blocking (owner ruling 2026-07-26: signing before
// the list is complete stays allowed).
export const NO_GUESTS_HINT =
  'מומלץ להוסיף מוזמנים לפני האישור — תקרת החיוב ומסגרת האשראי נקבעות לפי הרשימה ברגע תפיסת המסגרת';
const NO_GUESTS_AFTER_CONFIRM_HINT = 'הפניות יישלחו רק למוזמנים שברשימה';

// Mirrors createCampaign's own gates (campaigns.ts): future event_date,
// complete celebrants for the type, non-empty venue_name — surfaced up front so
// the owner fixes them BEFORE the one-click confirm, not after.
export function missingEventPrerequisites(event: SetupInput['event']): string[] {
  const missing: string[] = [];
  if (!event.event_date || isBeforeTomorrowIL(event.event_date)) missing.push('תאריך אירוע עתידי');
  if (!celebrantsCompleteFor(event.event_type, event.celebrants)) missing.push('פרטי בעלי השמחה');
  if (!event.venue_name || event.venue_name.trim() === '') missing.push('מקום האירוע');
  return missing;
}

export function computeSetupSteps(input: SetupInput): { steps: SetupStep[]; stage: CampaignStage } {
  const stage = campaignStage(input.campaign);
  const confirmed = input.event.status !== 'draft';
  const signed = (['awaiting_payment', 'awaiting_activation', 'active', 'paused', 'closed'] as CampaignStage[]).includes(stage);
  const held = (['awaiting_activation', 'active', 'paused', 'closed'] as CampaignStage[]).includes(stage);
  const live = stage === 'active' || stage === 'closed';
  const missing = confirmed ? [] : missingEventPrerequisites(input.event);
  const hasGuests = input.guestCount > 0;

  const steps: SetupStep[] = [
    { key: 'details', state: 'done' },
    {
      key: 'guests',
      // Soft step: a recommendation, never `current` — it does not gate the flow.
      state: hasGuests ? 'done' : 'pending',
      hint: hasGuests ? undefined : confirmed ? NO_GUESTS_AFTER_CONFIRM_HINT : NO_GUESTS_HINT,
    },
    {
      key: 'confirm',
      state: confirmed ? 'done' : missing.length > 0 ? 'blocked' : 'current',
      hint: !confirmed && missing.length > 0 ? `יש להשלים: ${missing.join(', ')}` : undefined,
    },
    { key: 'sign', state: signed ? 'done' : confirmed ? 'current' : 'pending' },
    { key: 'pay', state: held ? 'done' : signed ? 'current' : 'pending' },
    {
      key: 'live',
      state: live ? 'done' : held ? 'current' : 'pending',
      hint: stage === 'paused' ? 'הקמפיין מושהה' : undefined,
    },
  ];

  // A past event can no longer advance (createCampaign / approve / hold /
  // activate all refuse it): the step the owner would take next is blocked.
  if (input.isPast) {
    for (const s of steps) {
      if (s.state === 'current' || s.state === 'blocked') {
        s.state = 'blocked';
        s.hint = PAST_EVENT_HINT;
      }
    }
  }

  return { steps, stage };
}
```

- [ ] **Step 4: ודא הצלחה של הבדיקות הטהורות** — `npx vitest run src/lib/data/setup-steps.test.ts` → PASS.

- [ ] **Step 5: `countGuests` ב-`src/lib/data/guests.ts`** — הוסף אחרי `getGuestTotals` (שורה 665):

```ts
// Head count of the event's guest rows (RLS-scoped, like listGuests). The setup
// page's "any guests yet?" signal. Deliberately NOT gated with requireEventAccess:
// the event page has already passed its own gate, and a member without
// guests.view simply sees 0 through RLS rather than a 404 on the whole page.
export async function countGuests(eventId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('guests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) throw new Error('טעינת מונה המוזמנים נכשלה');
  return count ?? 0;
}
```

- [ ] **Step 6: `campaign-setup-form.tsx`** — החלף את הקובץ ב:

```tsx
'use client';

import type { ReactNode } from 'react';
import { useActionState } from 'react';

import { FormError, SubmitButton } from '@/components/forms';
import type { FormState } from '@/lib/validation/result';

// The setup page's single CTA form: a formless Server Action (confirm the event
// details if still draft, then create-or-continue the event's single campaign).
// `children` renders ABOVE the button — the R5 lock warning the audit (§2)
// requires the owner to see BEFORE confirming. useActionState surfaces the
// server's safe Hebrew error inline; on success the action redirects.
export function CampaignSetupForm({
  action,
  label,
  children,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      {children}
      <FormError message={state?.error} />
      <SubmitButton>{label}</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 7: צור `…/events/[id]/setup-steps.tsx`**

```tsx
import Link from 'next/link';
import { Check, Circle, LoaderCircle, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { OwnerCampaign } from '@/lib/data/campaigns';
import type { EventDetail } from '@/lib/data/events';
import { CAMPAIGN_STAGE_LABELS, CAMPAIGN_STAGE_VARIANTS } from '@/lib/data/event-labels';
import { SETUP_STEP_LABELS, computeSetupSteps, type SetupStep } from '@/lib/data/setup-steps';
import { cn } from '@/lib/utils';

import { setupCampaignAction } from './campaign/campaign-actions';
import { CampaignSetupForm } from './campaign-setup-form';

// The R5 lock, stated BEFORE the click (audit §2, verbatim requirement).
const LOCK_WARNING =
  'לאחר האישור לא ניתן יהיה לשנות את תאריך האירוע, שעת האירוע והמועד האחרון לאישורי הגעה.';

function StepIcon({ state }: { state: SetupStep['state'] }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
        state === 'done' && 'bg-success/15 text-success',
        state === 'current' && 'bg-primary/10 text-primary',
        state === 'pending' && 'bg-muted text-muted-foreground',
        state === 'blocked' && 'bg-warning/10 text-warning',
      )}
      aria-hidden="true"
    >
      {state === 'done' ? <Check className="size-4" /> : null}
      {state === 'current' ? <LoaderCircle className="size-4" /> : null}
      {state === 'pending' ? <Circle className="size-3" /> : null}
      {state === 'blocked' ? <Lock className="size-4" /> : null}
    </span>
  );
}

// The event's setup page (audit "הזרימה המומלצת" step 4): every step in order,
// exactly one marked current, and ONE call-to-action for that step. Replaces the
// three look-alike buttons (publish / enable RSVPs / activate) the audit flagged.
export function SetupSteps({
  event,
  campaign,
  guestCount,
  isPast,
}: {
  event: EventDetail;
  campaign: OwnerCampaign | null;
  guestCount: number;
  isPast: boolean;
}) {
  const { steps, stage } = computeSetupSteps({
    event: {
      status: event.status,
      event_type: event.event_type,
      event_date: event.event_date,
      venue_name: event.venue_name,
      celebrants: event.celebrants,
    },
    campaign,
    guestCount,
    isPast,
  });
  const current = steps.find((s) => s.state === 'current')?.key ?? null;
  const base = campaign ? `/app/events/${event.id}/campaign/${campaign.id}` : null;
  const guestsHref = `/app/events/${event.id}/guests`;
  const confirmAction = setupCampaignAction.bind(null, event.id);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">אישורי הגעה — שלבי ההקמה</h2>
        <Badge variant={CAMPAIGN_STAGE_VARIANTS[stage]}>{CAMPAIGN_STAGE_LABELS[stage]}</Badge>
      </div>

      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={cn('flex items-start gap-3 rounded-md px-2 py-2', s.state === 'current' && 'bg-primary/5')}
          >
            <StepIcon state={s.state} />
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', s.state === 'pending' && 'text-muted-foreground')}>
                {i + 1}. {SETUP_STEP_LABELS[s.key]}
              </p>
              {s.hint ? <p className="text-xs text-muted-foreground">{s.hint}</p> : null}
              {s.key === 'guests' && s.state !== 'done' && !isPast ? (
                <Link href={guestsHref} className="text-xs font-medium text-primary hover:underline">
                  להוספת מוזמנים
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {/* The ONE action for the current step. */}
      {current === 'confirm' ? (
        <CampaignSetupForm action={confirmAction} label="אישור פרטי האירוע והמשך">
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {LOCK_WARNING}
          </p>
        </CampaignSetupForm>
      ) : null}
      {current === 'sign' ? (
        base ? (
          <Link href={`${base}/approve`} className={buttonVariants()}>
            קריאת ההסכם וחתימה
          </Link>
        ) : (
          <CampaignSetupForm action={confirmAction} label="קריאת ההסכם וחתימה" />
        )
      ) : null}
      {current === 'pay' && base ? (
        <Link href={`${base}/payment`} className={buttonVariants()}>
          המשך לאמצעי תשלום
        </Link>
      ) : null}
      {current === 'live' && base ? (
        stage === 'paused' ? (
          <Link href={base} className={buttonVariants()}>
            ניהול הקמפיין
          </Link>
        ) : (
          <Link href={`${base}/payment`} className={buttonVariants()}>
            הפעלת הקמפיין עכשיו
          </Link>
        )
      ) : null}
      {stage === 'active' && base ? (
        <div className="flex flex-wrap gap-2">
          {guestCount === 0 ? (
            <Link href={guestsHref} className={buttonVariants()}>
              הוספת מוזמנים
            </Link>
          ) : null}
          <Link href={base} className={buttonVariants({ variant: guestCount === 0 ? 'outline' : 'default' })}>
            ניהול הקמפיין
          </Link>
        </div>
      ) : null}
      {stage === 'closed' && base ? (
        <Link href={base} className={buttonVariants({ variant: 'outline' })}>
          ניהול הקמפיין
        </Link>
      ) : null}
      {isPast && stage !== 'active' && stage !== 'closed' ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          מועד האירוע כבר חלף — לא ניתן להפעיל או להמשיך אישורי הגעה לאירוע שעבר.
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 8: `event-status-actions.tsx`** — הסר את ענף ה-`draft`/publish. החלף את `EventStatusActions` (שורות 63-107) ב:

```tsx
// R6: the owner's only direct status transition here is the close (destructive).
// Confirming the details (draft → active) lives in the setup steps above, as
// the first step of the RSVP flow. `closed` is terminal — no actions once closed.
export function EventStatusActions({
  status,
  hasBlockingCampaign,
  closeAction,
}: {
  status: EventStatus;
  hasBlockingCampaign: boolean;
  closeAction: BoundAction;
}) {
  if (status !== 'active') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        action={closeAction}
        label="סגירת האירוע"
        variant="destructive"
        confirm="לסגור את האירוע? לא ניתן לבטל פעולה זו."
        disabled={hasBlockingCampaign}
        disabledHint={
          hasBlockingCampaign ? 'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע' : undefined
        }
      />
    </div>
  );
}
```

- [ ] **Step 9: `events/[id]/page.tsx`**

ייבוא: הסר `isBeforeTomorrowIL` (שורה 10 → `import { isPastEventDay } from '@/lib/data/event-date';`), החלף `EVENT_STATUS_LABELS` ב-`eventStatusLabel` (שורה 13), החלף `publishEventAction, closeEventAction` ב-`closeEventAction` (18), החלף `CampaignSection` ב-`SetupSteps` (19: `import { SetupSteps } from './setup-steps';`), הוסף `import { countGuests } from '@/lib/data/guests';`.

החלף שורות 94-98 (`canPublish` + `publishAction` + `closeAction`) ב:

```tsx
  const [guestCount, cancellationRequest, closureReason] = await Promise.all([
    countGuests(id),
    event.status !== 'draft' ? getCancellationRequestForEvent(event.id) : Promise.resolve(null),
    event.status === 'closed' ? getEventClosureReason(event.id) : Promise.resolve(null),
  ]);
  const closeAction = closeEventAction.bind(null, event.id);
```

ומחק את ההצהרות הישנות של `cancellationRequest` (100-101) ו-`closureReason` (104-105).

שורה 144: `{EVENT_STATUS_LABELS[event.status] ?? event.status}` → `{eventStatusLabel(event.status, closureReason)}`.

החלף שורות 172-180 (`<EventStatusActions …/>` + `<CampaignSection …/>`) ב:

```tsx
      <SetupSteps event={event} campaign={campaign} guestCount={guestCount} isPast={isPast} />

      <EventStatusActions
        status={event.status}
        hasBlockingCampaign={hasOperationalCampaign}
        closeAction={closeAction}
      />
```

- [ ] **Step 10: מחק `campaign-section.tsx`**

```bash
git rm 'src/app/(customer)/app/events/[id]/campaign-section.tsx'
grep -rn "campaign-section\|CampaignSection" src || echo "no remaining references"
```

- [ ] **Step 11: ודא**

Run: `npx vitest run src/lib/data/setup-steps.test.ts 'src/app/(customer)/app/events/[id]' && npx tsc --noEmit && npm run lint`
Expected: ירוק. (אם Task 7 השאיר את `publishEventAction`, מחק אותו עכשיו — אין לו צרכן.)

- [ ] **Step 12: Commit**

```bash
git add src/lib/data/setup-steps.ts src/lib/data/setup-steps.test.ts src/lib/data/guests.ts 'src/app/(customer)/app/events/[id]'
git commit -m "feat(events): setup page with one clear step at a time, event state separate from campaign stage"
```

---

### Task 9: עמוד ניהול הקמפיין — מצב ריק, "דמי הפעלה", מוזמנים שלא נכללו (§7)

**Files:**
- Modify: `src/lib/data/contacts.ts` (`countAuthorizedContacts`)
- Modify: `…/campaign/[campaignId]/page.tsx`
- Modify: `…/campaign/[campaignId]/manage-client.tsx`

**Interfaces:**
- Produces: `countAuthorizedContacts(campaignId): Promise<number>`; `ManageClient` מקבל `eventId: string`, `authorizedCount: number | null`, `uniqueContacts: number | null`.
- Consumes: `countUniqueContactsForEvent` (`contacts.ts:294`).

- [ ] **Step 1: `countAuthorizedContacts` ב-`contacts.ts`** — הוסף אחרי `countUniqueContactsForEvent`:

```ts
// Size of the campaign's authorized set — "how many contacts the campaign will
// actually reach out to". Service-role read (the table is not owner-readable
// under RLS); callers must have passed their own access gate first (the manage
// page does). Used for the empty state and the "not included" banner.
export async function countAuthorizedContacts(campaignId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('campaign_authorized_contacts')
    .select('contact_id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);
  if (error) throw new Error('טעינת מונה אנשי הקשר בקמפיין נכשלה');
  return count ?? 0;
}
```

- [ ] **Step 2: `page.tsx`** — הוסף לייבוא `import { countAuthorizedContacts, countUniqueContactsForEvent } from '@/lib/data/contacts';`. אחרי בלוק ה-`thankyou` (שורה 77) הוסף:

```tsx
  // Audit §7: the board must lead with "who is in the campaign" when nobody is.
  // authorizedCount = the campaign's set; uniqueContacts = the event's reachable
  // list. Both degrade to null (hide the banner) rather than crash — an admin
  // viewer who is not the owner fails countUniqueContactsForEvent's gate.
  let authorizedCount: number | null = null;
  let uniqueContacts: number | null = null;
  try {
    authorizedCount = await countAuthorizedContacts(campaignId);
    uniqueContacts = admin ? null : await countUniqueContactsForEvent(eventId);
  } catch {
    authorizedCount = null;
    uniqueContacts = null;
  }
```

והוסף ל-`<ManageClient …>`: `eventId={eventId}`, `authorizedCount={authorizedCount}`, `uniqueContacts={uniqueContacts}`.

- [ ] **Step 3: `manage-client.tsx`**

ייבוא: הוסף `import Link from 'next/link';` ו-`import { buttonVariants } from '@/components/ui/button';`.

Props (שורות 286-316): הוסף `eventId: string;`, `authorizedCount: number | null;`, `uniqueContacts: number | null;` ובחתימת הפונקציה `eventId, authorizedCount, uniqueContacts,`.

אחרי `const balance = …` (שורה 336) הוסף:

```tsx
  // Audit §7 — "אין עדיין מוזמנים בקמפיין": the set is empty on a campaign the
  // owner already committed money to. Shown ONLY after the hold (before it the
  // set is empty by design). Reached contacts are always ⊆ the set, so an empty
  // set with reached > 0 cannot happen; guard anyway.
  const heldOrLive =
    campaign.capture_status === 'authorized' &&
    ['approved', 'scheduled', 'active', 'paused'].includes(s);
  const showEmptyState = heldOrLive && authorizedCount === 0 && reached === 0;
  // Guests on the list that the campaign will NOT reach (funded_cap reached —
  // reconcile_authorized_set returned ceiling_full). Surfaced instead of the
  // console.warn-only signal the P0-2 note describes.
  const excluded =
    heldOrLive && authorizedCount != null && uniqueContacts != null
      ? Math.max(0, uniqueContacts - authorizedCount)
      : 0;
```

לפני `{/* §15 owner board */}` (שורה 384) הוסף:

```tsx
      {showEmptyState ? (
        <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="font-semibold">אין עדיין מוזמנים בקמפיין.</p>
          <p className="text-sm text-muted-foreground">
            הפניות יישלחו רק למוזמנים שברשימה. הוסיפו מוזמנים כדי שהקמפיין יתחיל לעבוד.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/events/${eventId}/guests/import`} className={buttonVariants()}>
              ייבוא מוזמנים
            </Link>
            <Link href={`/app/events/${eventId}/guests/new`} className={buttonVariants({ variant: 'outline' })}>
              הוספת מוזמן
            </Link>
            <Link
              href={`/app/events/${eventId}/guests/import/whatsapp`}
              className={buttonVariants({ variant: 'outline' })}
            >
              שליחה דרך וואטסאפ
            </Link>
          </div>
        </section>
      ) : null}

      {excluded > 0 ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {excluded.toLocaleString('he-IL')} אנשי קשר ברשימה אינם כלולים בקמפיין — מכסת הקמפיין
          ({(authorizedCount ?? 0).toLocaleString('he-IL')} אנשי קשר) מלאה. להגדלת המכסה פנו לתמיכה.
        </p>
      ) : null}
```

שורה 403: `<Stat label="חיוב מצטבר" value={nis(accrued)} />` → `<Stat label={reached === 0 && basePrice > 0 ? 'דמי הפעלה' : 'חיוב מצטבר'} value={nis(accrued)} />` (§7: "אם מדובר בדמי הפעלה, יש לקרוא להם דמי הפעלה").

**F11 (סוכן):** שורות 340-341 — `canActivate` מציג "הפעלת קמפיין" גם ל-`approved` **בלי** תפיסה, והשרת מסרב. החלף ב:

```tsx
  // Activation requires a CONFIRMED hold (activateCampaign's capture_status
  // guard) — without one the right next step is the payment page, not a button
  // that fails server-side. A paused campaign is already held by construction.
  const activatableState = ['approved', 'scheduled', 'paused'].includes(s);
  const canActivate = !isPast && activatableState && campaign.capture_status === 'authorized';
```

ומתחת ל-`{canActivate ? (…) : null}` (שורות 435-437) הוסף את המסלול הנכון לקמפיין חתום ללא תפיסה:

```tsx
        {!isPast && s === 'approved' && campaign.capture_status !== 'authorized' ? (
          <Link
            href={`/app/events/${eventId}/campaign/${campaign.id}/payment`}
            className={buttonVariants()}
          >
            המשך לאמצעי תשלום
          </Link>
        ) : null}
```

- [ ] **Step 4: ודא** — `npx tsc --noEmit && npm run lint` → ירוק. דפדפן (Task 12): קמפיין active עם set ריק מציג את המצב הריק בראש; ה-Stat קורא "דמי הפעלה" כש-reached=0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/contacts.ts 'src/app/(customer)/app/events/[id]/campaign/[campaignId]'
git commit -m "feat(campaign): lead the board with 'add guests' when the campaign has nobody to reach"
```

---

### Task 10: לוח בקרה — משתמש ללא אירועים עובר ישר לטופס (זרימה מומלצת 2)

**Files:**
- Modify: `src/app/(customer)/app/page.tsx:1-20`

- [ ] **Step 1: יישום** — הוסף `import { redirect } from 'next/navigation';` ואחרי `const totalEvents = counts.total;` (שורה 18):

```tsx
  // Audit (recommended flow, step 2): a brand-new owner has nothing to look at
  // on a dashboard — take them straight to the create-event form. Counts are
  // RLS-scoped (own + shared-org events), so a member with shared events is not
  // redirected.
  if (totalEvents === 0) redirect('/app/events/new');
```

- [ ] **Step 2: ודא** — `npx tsc --noEmit`; דפדפן: משתמש חדש → `/app` מפנה ל-`/app/events/new`; אחרי יצירת אירוע → `/app` מציג את הלוח. (הבלוק `totalEvents === 0 ? (…)` בשורות 57-67 נשאר כהגנה; הוא לא נרנדר יותר.)

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(customer)/app/page.tsx'
git commit -m "feat(dashboard): send a first-time owner straight to the create-event form"
```

---

### Task 11: סקירת ייבוא מוואטסאפ — מוני תקינות, שורות שגויות, מה עושה "אישור ייבוא" (§8)

**Files:**
- Modify: `…/guests/import/whatsapp/page.tsx:66-121`

- [ ] **Step 1: יישום** — בתוך `pendingList.map((s) => { … })`:

החלף `const errorCount = Array.isArray(s.error_rows) ? s.error_rows.length : 0;` ב:

```tsx
        // error_rows shape is fixed by whatsapp-import.ts (Array<{ row, message }>);
        // messages are schema texts, never the row's values.
        const errorRows = Array.isArray(s.error_rows)
          ? (s.error_rows as Array<{ row: number; message: string }>)
          : [];
```

החלף את ה-`<span>` של המונה (שורות 77-79) ב:

```tsx
              <span className="text-xs text-muted-foreground">
                {s.row_count} שורות תקינות
                {errorRows.length ? ` · ${errorRows.length} שורות שגויות` : ''}
              </span>
```

אחרי ה-`<div className="overflow-x-auto">…</div>` (שורה 114) ולפני `<StagingActions`, הוסף:

```tsx
            {errorRows.length > 0 ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  שורות שלא ייובאו ({errorRows.length})
                </summary>
                <ul className="mt-1 list-inside list-disc">
                  {errorRows.slice(0, 20).map((e) => (
                    <li key={e.row}>
                      שורה {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
                {errorRows.length > 20 ? <p className="mt-1">מוצגות 20 הראשונות.</p> : null}
              </details>
            ) : null}

            <p className="text-xs text-muted-foreground">
              לחיצה על ״אישור ייבוא״ תוסיף את השורות התקינות לרשימת המוזמנים: כפילויות לפי טלפון
              ידולגו, והתאמות לפי שם יאוחדו לפי הבחירה למעלה. ״מחיקה״ מוחקת את הרשימה בלי לייבא
              ואינה ניתנת לשחזור.
            </p>
```

- [ ] **Step 2: ודא** — `npx tsc --noEmit && npm run lint`. דפדפן: רשימה ממתינה עם שגיאות מציגה את המונים והרשימה המתקפלת.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(customer)/app/events/[id]/guests/import/whatsapp/page.tsx'
git commit -m "feat(import): show valid/invalid counts and explain what confirming does"
```

**לא בתוכנית זו (מתועד כ-follow-up):** תיקון שורה בודדת לפני האישור (§8 "אפשרות לתקן רשומה") — דורש Server Action חדש שמעדכן `guest_import_staging.rows` (PII) עם ולידציה פר-שורה ו-UI עריכה; ראוי לתוכנית נפרדת.

---

### Task 12: תיעוד + שער אימות מלא

**Files:**
- Create: `docs/onboarding-activation-flow-2026-09-02.md`

- [ ] **Step 1: רשומת החלטות** — צור את הקובץ:

```markdown
# זרימת ההקמה וההפעלה — החלטות (2.9.2026)

מקור: `docs/KALFA-RSVP.md` (ביקורת UX). תוכנית: `plans/onboarding-activation-flow-plan-2026-09-02.md`.

## מה השתנה
- **שלב אחד פחות**: אחרי תפיסת מסגרת מאושרת הקמפיין מופעל אוטומטית (`authorize/route.ts` → `activateCampaign`). כשל בהפעלה לא פוגע בתפיסה — מוצג כפתור "הפעלת הקמפיין עכשיו" באותו עמוד.
- **"פרסום האירוע" נעלם כמונח**: המעבר `draft → active` נשאר (טריגרים `events_guard_update`, `campaigns_require_active_event` לא השתנו) אבל נקרא "אישור פרטי האירוע והמשך", מציג את אזהרת הנעילה לפני הלחיצה, ומשורשר ליצירת הקמפיין ולהסכם (`setupCampaignAction`).
- **שני מצבים מוצגים**: מצב האירוע (`טיוטה` / `פרטי האירוע אושרו` / `הסתיים` / `בוטל`) ומצב הקמפיין **הנגזר** (`campaignStage`: `טרם הוגדר` / `ממתין לחתימה` / `ממתין לתשלום` / `ממתין להפעלה` / `פעיל` / `מושהה` / `נסגר` / `בוטל`). אין ערך enum חדש.
- **ניסוחים**: "חתימה והמשך לאמצעי תשלום"; "ההסכם נחתם בהצלחה. כעת יש להשלים אמצעי תשלום."; מסכת טלפון `050***4567`.
- **עמוד התשלום**: סיכום מפורש (דמי הפעלה / כלולים / מעבר לכך / סכום התפיסה כעת / תקרה / מתי החיוב / מה אם אף אחד לא משיב) — כל מספר מה-snapshot של הקמפיין או מ-`previewCampaignHoldSizing`.
- **עמוד הניהול**: מצב ריק "אין עדיין מוזמנים בקמפיין" עם ייבוא/הוספה/וואטסאפ; "דמי הפעלה" במקום "חיוב מצטבר" כש-reached=0; באנר למוזמנים שלא נכללו (מכסה מלאה).
- **לוח בקרה**: 0 אירועים → הפניה ל-`/app/events/new`.

## תיקון DB (Task 0)
`reconcile_authorized_set.funded_cap` = `least(greatest(max_contacts, included), included + floor(max(0, auth − base)/price))`. סיבה: `max_contacts` נשמר ברגע התפיסה; תפיסה עם 0 מוזמנים נתנה `funded_cap = 0` וקמפיין "פעיל" שלא מקבל אף מוזמן. legacy (0/0) ללא שינוי.

## מה נשאר כמו שהיה (בכוונה)
- ה-set הדינמי (`snapshotAuthorizedSet` בתפיסה + `reconcile_authorized_set` חי מ-21.7) ונתיב השליחה (`sendable-contacts.ts` INNER JOIN).
- גודל התפיסה, התקרה, D5, `close-charge`, גמר חשבון ידני.
- כל שומרי L1/R9 בתוך `activateCampaign`.

## פתוח
- G1: סדר "מוזמנים לפני חתימה" — שער רך בלבד (אזהרה), לפי החלטת הבעלים מ-26.7.
- G3: ההסכם (`template.ts:260`) מתאר גביית דמי הפעלה בהפעלה; הקוד גובה בסגירה — ל-`israeli-compliance-advisor`.
- תיקון שורה בסקירת הייבוא (§8) — תוכנית נפרדת.
- הקטנה (ולא הסתרה) של איור הכרטיס בנייד — לפי בדיקה ויזואלית.
```

- [ ] **Step 2: שער סטטי מלא**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: הכול ירוק. אין `next build` נוסף במקביל.

- [ ] **Step 3: בדיקת ריצה (skill `/verifying-kalfa-changes`, דפדפן על beta אחרי deploy של הבעלים)**

1. משתמש חדש ללא אירועים: `/app` → `/app/events/new`.
2. יצירת אירוע → עמוד ההקמה: שלב 3 "אישור פרטי האירוע" current, אזהרת הנעילה מוצגת, תג "טרם הוגדר", תג אירוע "טיוטה".
3. אירוע בלי מקום → שלב 3 blocked עם "יש להשלים: מקום האירוע".
4. "אישור פרטי האירוע והמשך" → נחיתה ב-`/approve`; כותרת "חתימה על ההסכם"; טלפון ממוסך; כפתור "חתימה והמשך לאמצעי תשלום".
5. אחרי חתימה: עמוד התשלום עם "ההסכם נחתם בהצלחה…" והסיכום המפורש (סכום התפיסה = base כשהרשימה ריקה; אזהרת רשימה ריקה).
6. **תפיסה אמיתית** — החלטת הבעלים (J5 אמיתי מול SUMIT): אחרי `?held=1` מסך "הקמפיין פעיל" עם "הוספת מוזמנים"/"מעבר לניהול הקמפיין"; עמוד האירוע מציג "פרטי האירוע אושרו" + "פעיל".
7. עמוד הניהול עם set ריק: "אין עדיין מוזמנים בקמפיין" בראש; "דמי הפעלה".
8. הוספת מוזמן אחרי ההפעלה (אחרי Task 0 חי): לוגים ללא `[reconcile] ceiling_full`; `countAuthorizedContacts` גדל.
9. RTL/נייד: איור הכרטיס מוסתר בנייד; הדיאלוג "תופסים מסגרת אשראי בסך ₪…" מציג את סכום התפיסה.

- [ ] **Step 4: Commit**

```bash
git add docs/onboarding-activation-flow-2026-09-02.md
git commit -m "docs: record the onboarding-flow decisions and the funded_cap floor"
```

---

## סיכונים ומגבלות ידועות

| סיכון | חומרה | טיפול |
|---|---|---|
| קמפיין `pending_approval` (נוצר ב-"אישור פרטי האירוע והמשך") הוא "אופרטיבי" → נועל `event_type/celebrants/venue` וחוסם סגירת אירוע (R7); ביטול קמפיין = אדמין בלבד. | בינונית — **קיים גם היום** למי שלחץ "הפעלת אישורי הגעה" ונטש בחתימה. | לא משתנה בתוכנית; מתועד. follow-up אפשרי: ביטול קמפיין ללא התחייבות כספית על ידי הבעלים. |
| `publishEvent` הצליח ו-`createCampaign` נכשל → האירוע מאושר (תאריכים נעולים) בלי קמפיין. | נמוכה — `missingEventPrerequisites` מונע את המקרים הרגילים; לחיצה חוזרת ממשיכה. | Task 7 הערה בקוד; Task 8 שער מקדים. |
| הפעלה אוטומטית עם 0 מוזמנים → ceiling = base לצמיתות (F5). | עסקית — הכנסה, לא סיכון ללקוח. | G1 שער רך + אזהרה בעמוד התשלום; Task 0 מבטיח שהקמפיין לפחות עובד. |
| `activateCampaign` שולח Slack + מזריע `thankyou_send_at` — עכשיו קורה בתוך POST התפיסה. | נמוכה — פעולות best-effort קיימות. | ללא שינוי. |
| הסתרת איור הכרטיס בנייד במקום הקטנה. | קוסמטית. | שורה אחת לשינוי אחרי בדיקה ויזואלית. |
| בדיקת האינטגרציה של Task 0 מדולגת בשרת זה (אין DB בדיקות). | בינונית. | probe בעלים + `pg_get_functiondef`; `rls-schema-engineer` סוקר לפני `db push`. |

## אימות צולב (סוכן `flow-reader`, DB חי, 2.9.2026) — הושלם

- [x] **F1–F8: כולם CONFIRMED.** דיוקים: F1 — `pause` פתוח גם לסוכן קונסול עם `campaigns.runstate` (לא אדמין בלבד); `closed` לאירוע נכתב גם מ-settlement ומ-cancellation. F2 — `authorize/route.test.ts:133` בודק רק `303`, לא את יעד ה-redirect (Task 5 מוסיף). F3 — הערת הקוד ב-`reconcile-config.ts:11-13` "ייבוא המוני לא קורא reconcile" מיושנת (שני מסלולי הייבוא קוראים) — תוקנה 2.9. F4 — ראו F4 בטבלה + החמרה ל-`try_record_billed_result`. F7 — ביטול "פרסום" היה משפיע גם על RSVP ציבורי (`get_rsvp_by_token`/`submit_rsvp` דורשים `active`) ועל ניתוב ייבוא WhatsApp (`resolveOwnerActiveEvents`) — מחזק את ההחלטה לשמר את המעבר. F8 — `error_rows` נספרות אך לא מוצגות (Task 11 מכסה).
- [x] טריגרים חיים (`events_before_insert`, `events_guard_update`, `campaigns_guard_cancel`, `campaigns_require_active_event`) = קבצי המיגרציה. RLS: `campaigns` — policy SELECT יחידה, אין INSERT/UPDATE ל-`authenticated` ⇒ כל כתיבת status רק service-role; `events` — `events_org_update` בלי `w` על `status`.
- [x] `pg_get_functiondef(reconcile_authorized_set)` חי מכיל `least(v_max, …)` (לפני Task 0). `try_record_billed_result` חי = גוף `20260712115459` (`v_cap := v_max` / `least(v_max, floor(v_auth/v_price))`).
- [x] חשיפה חיה ל-F4: `capture_status='authorized' and max_contacts=0` → **1** (`d36add3d…`, `active`, אירוע 2029-08-27, 0 מוזמנים, set 0, outreach_state 0); `max_contacts=0` נוספים: `approved` 1 (30.8), `pending_approval` 1 (1.9), כולם base>0. `campaign_authorized_set_audit` 0 שורות, `campaign_authorized_contacts` 40, `outreach_state` 39, `billed_results` 22. לוגי pm2: 0 שורות `[reconcile]`.
- [x] הגדרות חיות: `payments_enabled` / `campaign_holds_enabled` / `close_charge_enabled` / `base_overage_pricing_enabled` / `outreach_enabled` = true; `billing_exposure_gate` = false; `reasonable_coverage_contacts` = 300. חבילה: base 200 / included 200 / price 4 / floor 0 / buffer 0; לוח 5 נגיעות (10, 6, 3, call 2, 1 ימים לפני). ⇒ "כלולים עד 50" בביקורת (§6) הוא ניחוש של המבקר; הערך האמיתי 200 — הביקורת צודקת שהכמות הכלולה לא מוצגת בעמוד (Task 4 מתקן).
- [x] F9: ראו טבלה — activate לא מתזמן; ה-`arm` cron זורע מה-set.
- [x] בדיקות שנשברות: המחרוזות ב-Task 3 (מלא). נוספות שיישברו **אם** ינוסחו מחדש (לא בתוכנית): 'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע' (`campaign-actions.test.ts:138,156,161`, `events.test.ts:913`); שערי `createCampaign` (`campaigns.test.ts:578,602,678,699`); 'לא ניתן לשנות את מצב הקמפיין' (`campaigns.test.ts:940`, `status/route.test.ts:138`). `EVENT_STATUS_LABELS`/`CAMPAIGN_STATUS_LABELS` — אף בדיקה לא מאשרת אותן (Task 1 מוסיף).

## Task 0 — סטטוס ביצוע (2.9.2026)

- [x] מיגרציה `20260902062917_reconcile_funded_cap_floor_included.sql` נכתבה: `reconcile_authorized_set` (עותק 30.8 + `greatest(v_max, v_included)`) **וגם** `try_record_billed_result` (עותק `20260712115459` + `v_base/v_included` + אותה נוסחה בשני הענפים, `coalesce` ל-0). `diff` מול המקורות: 1 שורה ב-reconcile; 6 שורות ב-billed_result.
- [x] שני מקרי בדיקה נוספו ל-`reconcile.integration.test.ts` (gated; מדולגים בשרת זה — 11 skipped).
- [x] הערת הקוד ב-`reconcile-config.ts` תוקנה.
- [x] **הוחל חי 2.9.2026 09:33** — הבעלים הריץ `supabase db push`; אומת: `pg_get_functiondef` של שתי הפונקציות מכיל `greatest(v_max, v_included)`, overload יחיד לכל אחת, `migration list` בסנכרון (0 pending). הקמפיין החי `d36add3d…` (0 מוזמנים) יקבל עכשיו עד 200 אנשי קשר כשיתווספו; אין צורך ב-backfill (ה-set ריק כי לא נוספו מוזמנים).
- [ ] follow-up (לא דחוף): `try_record_billed_result` — בדיקת אינטגרציה gated (אין סוויטה SQL קיימת; `billing.test.ts` מוקק את ה-RPC).
