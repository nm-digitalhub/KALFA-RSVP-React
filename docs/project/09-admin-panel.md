# 09 — פאנל הניהול (Admin Panel)

פאנל הניהול של KALFA יושב תחת קבוצת המסלולים `src/app/(admin)/admin/` ומרוכז סביב עיקרון אחד:
**כל הרשאה נאכפת בשרת** — פעם אחת ב-layout של תת-העץ ופעם נוספת בכל שכבת-נתונים ופעולה.
הממשק עברי-ראשון ו-RTL, בנוי כ-Server Components עם מעטפת ניווט ייעודית
(`AdminShell`, `src/components/admin-shell.tsx`) הנפרדת ממעטפת הלקוח.

מסמך זה מתעד את מה שקיים בקוד בפועל (נכון ל-2026-07-02). חלקים מתוכננים-בלבד מסומנים במפורש.

## מפת מסלולים

| מסלול | קובץ עיקרי | תכלית |
|---|---|---|
| `/admin` | `(admin)/admin/page.tsx` | דשבורד: מוני-כותרת (פניות/בקשות חזרה/הזמנות/חבילות) + פעילות אחרונה |
| `/admin/users` | `(admin)/admin/users/page.tsx` | רשימת כל משתמשי הפלטפורמה, חיפוש לפי אימייל + עימוד |
| `/admin/users/[id]` | `(admin)/admin/users/[id]/page.tsx` | פרטי משתמש: פרופיל, חברויות-ארגון, הזמנות/חבילה, זיכויים; פעולות ניהול |
| `/admin/contacts` | `(admin)/admin/contacts/page.tsx` | פניות מטופס "צור קשר" (קריאה בלבד, מעומד) |
| `/admin/callbacks` | `(admin)/admin/callbacks/page.tsx` | בקשות "חזרו אליי" + עדכון סטטוס inline |
| `/admin/orders` | `(admin)/admin/orders/page.tsx` | כל ההזמנות (קריאה בלבד) + כפתור reconcile להזמנות תקועות |
| `/admin/packages` | `(admin)/admin/packages/page.tsx` | קטלוג החבילות (פעילות + לא-פעילות) |
| `/admin/packages/new` | `(admin)/admin/packages/new/page.tsx` | יצירת חבילה חדשה |
| `/admin/packages/[id]` | `(admin)/admin/packages/[id]/page.tsx` | עריכה/מחיקה של חבילה |
| `/admin/activity` | `(admin)/admin/activity/page.tsx` | יומן הפעילות (audit log) עם פילטרים בצד-שרת |
| `/admin/company` | `(admin)/admin/company/page.tsx` | פרטי חברה משפטיים המוזרקים להסכם החתום |
| `/admin/agreement` | `(admin)/admin/agreement/page.tsx` | ניהול החוזה: עריכה, אישור, פרמטרים, תצוגה מקדימה |
| `/admin/channels` | `(admin)/admin/channels/page.tsx` | תצורת ספקי outreach (WhatsApp Cloud API) + בדיקת חיבור |
| `/admin/templates` | `(admin)/admin/templates/page.tsx` | תבניות הפנייה לאורחים (WhatsApp / סקריפט שיחה) |
| `/admin/webhooks` | `(admin)/admin/webhooks/page.tsx` | Webhook Inspector: רשימת `webhook_inbox`, מגירת-פירוט, reprocess |
| `/admin/sumit-test` | `(admin)/admin/sumit-test/page.tsx` | PoC אבחוני מול SUMIT החי (מסלול A/B) |
| `/admin/settings` | `(admin)/admin/settings/page.tsx` | הגדרות מערכת: SUMIT, SMS, SMTP + סטטוס תצורת env |

Route Handlers ייעודיים לאדמין:

- `POST /api/admin/sumit-test` — `src/app/api/admin/sumit-test/route.ts` (ה-PoC של SUMIT).
- `POST /api/admin/orders/[id]/reconcile` — `src/app/api/admin/orders/[id]/reconcile/route.ts` (יישוב הזמנה תקועה).

עמוד ה-bootstrap (תביעת האדמין הראשון) יושב מחוץ לתת-העץ, באזור הלקוח:
`src/app/(customer)/app/admin-access/page.tsx`.

### פירוט קצר לכל מסך

- **`/admin` (סקירה)** — ארבעה כרטיסי-מנייה (`getDashboardCounts`, `src/lib/data/admin/dashboard.ts`) שכל אחד מקשר למדור שלו, ורשימת חמשת אירועי הפעילות האחרונים (`recentActivity` + `describeActivity`, `src/lib/data/admin/activity.ts`). הכל נטען בשרת.
- **`/admin/users`** — רשימה מבוססת GoTrue Admin API (`listAllUsers`, `src/lib/data/admin/users.ts:113`); חיפוש אימייל נעשה בסריקה מוגבלת-עמודים כי ל-API אין פילטר צד-שרת (קבועים `SEARCH_PER_PAGE`/`SEARCH_MAX_PAGES`, שם:20-23). ההעשרה (שם, דגל-אדמין, מספר ארגונים) נעשית בשלוש שאילתות batched, ללא N+1 (`enrichUsers`, שם:84-109).
- **`/admin/users/[id]`** — פרטי המשתמש (`getUserDetail`, שם:165) ופעולות ב-`users/actions.ts`: הענקת/שלילת תפקיד אדמין (`setPlatformAdmin`, שם:253 — עם שמירה על "האדמין האחרון" ומניעת נעילה-עצמית), השעיה/החזרה (`setUserSuspended`, שם:291), הענקת זיכוי חיוב לאירוע (`grantBillingCredit`, שם:323) והחלפת חבילה בהזמנה שטרם שולמה (`updateOrderPackage`, שם:367). כל המוטציות מבוקרות (audit) דרך `logActivity`.
- **`/admin/contacts`** — הצגת הודעות `contact_messages` (מידע אישי — נגיש רק מאחורי שער האדמין); `src/lib/data/admin/contacts.ts`.
- **`/admin/callbacks`** — רשימת בקשות-חזרה עם טופס עדכון סטטוס (`callback-status-form.tsx`, ולידציה ב-`updateCallbackStatusSchema`, `src/lib/validation/admin.ts:34`).
- **`/admin/orders`** — קריאה בלבד; שם החבילה והאירוע מוטמעים ב-FK ללא lookup פר-שורה. המוטציה היחידה היא reconcile דרך endpoint נפרד (`reconcile-button.tsx` → `/api/admin/orders/[id]/reconcile`).
- **`/admin/packages`** — CRUD מלא על `packages` דרך `src/lib/data/admin/packages.ts` (client של session + RLS). הטופס (`package-form.tsx`) עורך: `name`, `tier`, `category`, `price_with_vat`, `description`, `includes`, `sort_order`, `active`. יצירה/עדכון/מחיקה מבוקרים ב-`logActivity` כולל diff של שדות שהשתנו.
- **`/admin/activity`** — צפייה ביומן הפעילות עם פילטרים לפי action / actor / entity / טווח תאריכים / מזהי-ישויות, הכל מסונן בצד-שרת (`listActivity`, `src/lib/data/admin/activity.ts`).
- **`/admin/templates`** — עריכת `message_templates`: לכל `message_key` (נקודת-מגע במסע ה-RSVP) מגדירים תוכן לפי ערוץ — שם תבנית שאושרה ב-Meta עבור WhatsApp או סקריפט לשיחת AI — ומפעילים. התבניות נזרעות **fail-closed** (לא-פעילות): מפתח ללא תוכן פעיל לא שולח דבר (`getTemplateByKey`, `src/lib/data/message-templates.ts:15`).

### מעטפת הניווט — `AdminShell`

`src/components/admin-shell.tsx` הוא ה-client component המרכזי של המעטפת (סרגל-צד קבוע
בצד ימין + top bar), נפרד לחלוטין ממעטפת הלקוח:

- רשימת הניווט מוגדרת במערך `NAV` (שורות 59-74) — 14 פריטים, מ"סקירה" ועד "הגדרות", עם אייקוני lucide ייעודיים (למשל `Webhook` לבדיקת Webhooks ו-`FlaskConical` לבדיקת SUMIT).
- `DirectionProvider direction="rtl"` עוטף הכל (שורה 135) — Base UI מתעלם מ-`dir` של ה-DOM, ובלעדיו תפריטים/Sheet מפורטלים היו נפתחים ב-LTR.
- הסיידבר מוגדר `side="right"` + `collapsible="offcanvas"`; במובייל נפתח כ-Sheet דרך המבורגר.
- הדגשת פריט פעיל: `/admin` רק בהתאמה מדויקת, שאר הפריטים לפי תת-עץ (`isActive`, שורות 78-82), כך ש-`/admin/packages/new` משאיר את "חבילות" מודגש.
- תפריט הפרופיל מציג אימייל + התנתקות (POST ל-`/auth/logout`); בתחתית הסיידבר קישור "חזרה לאזור האישי".

### תשתית משותפת נוספת

מרכיבים משותפים לכל המסכים: `_components.tsx` (`PageHeading`, `EmptyState`, `Badge`,
`Pagination`, `parsePageParam`, `formatCurrency`, `formatDateTime`), עימוד אחיד דרך
`src/lib/data/admin/shared.ts` (`resolvePage`/`PageResult`), מפות-תוויות עבריות ב-
`src/lib/data/admin/labels.ts`, מסך טעינה (`loading.tsx`) ו-error boundary כללי שאינו
חושף פרטי שגיאה (`(admin)/admin/error.tsx`).

## בקרת גישה

### אכיפת תפקיד אדמין בצד-שרת

- ה-layout של תת-העץ (`(admin)/admin/layout.tsx:13`) קורא ל-`requireAdmin()` — זהו גבול ההרשאה של כל `/admin`; קישור-הניווט באזור הלקוח הוא נוחות בלבד.
- `requireAdmin` (`src/lib/auth/dal.ts:51-62`): `requireUser()` (מבוסס `supabase.auth.getUser()` — אימות מול שרת ה-Auth, לא `getSession()`), ואז RPC `has_role(_role: 'admin', _user_id)` מול טבלת `user_roles` (enum `app_role = 'admin' | 'user'`, `src/lib/supabase/types.ts:1860`). כישלון → redirect ל-`/app`.
- `isAdmin` (`dal.ts:36-47`) — גרסה לא-מפנה עבור UI מותנה (הצגת קישור ניהול); לעולם לא משמשת כשער.
- בנוסף לשער ה-layout, **כל** reader/מוטציה בשכבת `src/lib/data/admin/*` קוראים ל-`requireAdmin()` בעצמם — הגנה כפולה שאינה תלויה בהרכב העמודים.
- שכבת התפקיד הפלטפורמי (admin) אורתוגונלית לשכבת תפקידי-הארגון של הלקוחות (`users.ts:10-14`).

### Bootstrap — `claim_first_admin`

- העמוד `src/app/(customer)/app/admin-access/page.tsx` מציג לכל משתמש מחובר כפתור "תביעת גישת מנהל ראשונה". זה בטוח כי האכיפה כולה ב-RPC.
- ה-Server Action (`admin-access/actions.ts:21-46`) קורא ל-RPC `claim_first_admin()` (SECURITY DEFINER, ללא ארגומנטים — `types.ts:1792`): בודק אטומית שאין עדיין אדמין ורק אז מעניק את התפקיד. חוזה: `true` = הפכת לאדמין הראשון; `false` = כבר קיים אדמין (נדחה בלי להדליף מי/כמה); שגיאה = כשל אימות. הצלחה → `revalidatePath('/app','layout')` + redirect ל-`/admin`.
- הפונקציות `has_role` / `claim_first_admin` וטבלת `user_roles` מוגדרות ב-DB החי (סכימה קיימת-מראש); הן אינן מופיעות כ-`CREATE FUNCTION` במיגרציות הריפו, אך policies במיגרציות מפנים אליהן וה-types שנוצרו מהסכימה כוללים אותן.

### RLS ושני דפוסי client

טבלאות האדמין מוגנות ב-policies בסגנון `app_settings_admin_all`
(`supabase/migrations/202606240005_app_settings.sql`):
`using / with check (public.has_role(auth.uid(), 'admin'::app_role))`.

בקוד קיימים שני דפוסים, שניהם מאחורי `requireAdmin()`:

1. **Session (cookie) client + RLS** — עבור נתונים שה-policy מכסה במלואם: `settings.ts`, `channels.ts`, `packages.ts`, `agreement-config.ts` (צד הטופס). כאן ה-RLS פעיל כשכבת אכיפה שנייה בפועל.
2. **Service-role client (`createAdminClient`)** — עבור נתונים שה-cookie client אינו יכול לקרוא: `users.ts` (אימיילים ב-`auth.users`, `user_roles`/`profiles` שהם self-only), `admin/agreements.ts`, `webhook-inbox.ts`, וכן ה-readers התפעוליים ב-`payments.ts`/`outreach-config.ts` (רצים גם בהקשר לקוח/worker, לא רק אדמין). service-role עוקף RLS, ולכן שם ה-policy היא **defence-in-depth** והשער האמיתי הוא `requireAdmin()` (ראו ההערה במיגרציה `202606290035_webhook_inbox.sql:33-35`).

## מערכת ההגדרות — `app_settings`

### סכימה

`app_settings` היא טבלת **singleton**: `id boolean primary key default true` עם
`CHECK (id = true)`, שורה יחידה שנזרעת במיגרציה, trigger של `updated_at`, ושתי policies —
`app_settings_admin_all` (כתיבה/קריאה לאדמין) ו-`app_settings_auth_read` (קריאה לכל משתמש
מחובר, כדי שזרימת התשלום תוכל לבדוק את `payments_enabled` בלי service-role). מקור:
`supabase/migrations/202606240005_app_settings.sql`; העמודות נוספו בהדרגה במיגרציות
`202606240006` עד `202606290033`.

### מפתחות קיימים (שמות בלבד, לפי תחום)

| תחום | מפתחות (עמודות) | מיגרציה |
|---|---|---|
| סליקה (SUMIT) | `payments_enabled`, `sumit_company_id`, `sumit_api_public_key`, `sumit_api_key` | 0005, 0006 |
| SMS (ExtrA) | `sms_enabled`, `extra_sms_token`, `extra_sms_sender` | 0015 |
| אימייל (SMTP) | `email_enabled`, `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from` | 0018 |
| DKIM | `dkim_domain`, `dkim_selector`, `dkim_private_key` | 0019 |
| פרטי חברה/הסכם | `company_legal_name`, `company_legal_id`, `company_legal_address`, `company_contact_phone`, `company_contact_email`, `privacy_url`, `terms_url`, `warranty_text` | 0016, 0017 |
| פרמטרי הסכם | `agr_service_activation_window`, `agr_offer_validity_days`, `agr_charge_window_days`, `agr_hold_release_days`, `agr_liability_cap`, `agr_retention_days`, `agr_record_retention_months` | 0023 |
| קמפיינים/חיוב | `campaign_holds_enabled`, `close_charge_enabled`, `reasonable_coverage_contacts`, `extreme_threshold_contacts` | 0020, 0024, 0028 |
| Outreach / WhatsApp | `outreach_enabled`, `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token` | 0028, 0033 |

### Accessors מוטפסים ב-`src/lib`

- `src/lib/data/admin/settings.ts` — `getAppSettings` / `updateAppSettings` (סליקה+SMS+SMTP; טיפוס `AppSettings`, שורות 15-31), `getCompanySettings` / `updateCompanySettings` (שורות 124-178), `getInfraConfigStatus` (שורות 187-205 — סטטוס-נוכחות בלבד של `SUPABASE_SERVICE_ROLE_KEY` ו-`APP_ORIGIN` מה-env, לעולם לא ערכים).
- `src/lib/data/admin/channels.ts` — `getWhatsAppChannelConfig` / `updateWhatsAppChannelConfig` / `testWhatsAppConnection` (בדיקת חיבור read-only מול Graph API, שורות 83-113).
- `src/lib/data/agreement-config.ts` — `getAgreementConfigTokens` (קריאה חיה להסכם, service-role) ו-`getAgreementConfigForAdmin` (prefill לטופס, session client); מיפוי camelCase↔`agr_*` מתועד בשורות 28-34.
- `src/lib/data/payments.ts` — readers תפעוליים fail-safe (מחזירים "כבוי" במקום לזרוק): `getPaymentsEnabled`, `getCampaignHoldsEnabled`, `getCloseChargeEnabled`, `getSumitPublicConfig`, `getSumitServerConfig`.
- `src/lib/data/outreach-config.ts` — `getOutreachEnabled`, `getWhatsAppConfig` (צריכת ה-worker/route, fail-closed).
- `src/lib/data/company.ts` — `getCompanyLegal` לקריאת ההסכם החיה; `src/lib/email/sender.ts` ו-`src/lib/sms/sender.ts` צורכים את מפתחות ה-SMTP/DKIM/ExtrA בזמן שליחה.
- ולידציה: `appSettingsSchema` / `companySettingsSchema` ב-`src/lib/validation/admin.ts` (Zod בגבול ה-Server Action).

### איזה טופס עורך אילו מפתחות

| מסך | מפתחות נערכים |
|---|---|
| `/admin/settings` | `payments_enabled`, `sumit_*`, `sms_enabled`, `extra_sms_*`, `email_enabled`, `smtp_*` |
| `/admin/channels` | `outreach_enabled`, `whatsapp_*` |
| `/admin/company` | `company_*`, `privacy_url`, `terms_url`, `warranty_text` |
| `/admin/agreement` (מקטע "פרמטרים של ההסכם") | שבעת מפתחות ה-`agr_*` |

סודות (מפתח SUMIT, טוקן ExtrA, סיסמת SMTP, טוקן/סוד WhatsApp) מוחזרים לטופס האדמין
בלבד ומוצגים **ממוסכים עם כפתור חשיפה** (דפוס gateway-plugin), לעולם לא נרשמים ללוג
(`settings.ts:10-13`, `channels.ts:7-11`).

**מפתחות ללא טופס ניהול** (מנוהלים ישירות ב-DB): `dkim_*`, `campaign_holds_enabled`,
`close_charge_enabled`, `reasonable_coverage_contacts`, `extreme_threshold_contacts`.
זו נקודה ידועה — דגלי-הקילר של החיוב וספי-הכיסוי נצרכים בקוד אך אינם חשופים עדיין ב-UI.

### מסך `/admin/settings` — פירוט

העמוד (`settings/page.tsx`) מחולק לשני מקטעים:

1. **"סליקה (SUMIT)"** ולצדה SMS ו-SMTP — הטופס (`settings-form.tsx` → `settings/actions.ts`) שולח תמיד את כל השדות (הטופס prefilled), וערך ריק פירושו איפוס מכוון ל-`null` (`updateAppSettings`, `settings.ts:94-114`). `smtp_port` עובר coercion למספר בשמירה; `smtp_secure` מבחין בין 465/SSL ל-587/STARTTLS.
2. **"תצורת תשתית (env)"** — תצוגת בריאות קריאה-בלבד: האם `SUPABASE_SERVICE_ROLE_KEY` (כולל זיהוי ערך placeholder) ו-`APP_ORIGIN` מוגדרים. הרציונל מוצג בעמוד עצמו: מפתח ה-service-role הוא המפתח שמאבטח את ה-DB ולכן לא יכול לגור בתוכו.

### מסך `/admin/channels` — פירוט

מעבר לטופס תצורת WhatsApp (`channels-client.tsx` → `channels/actions.ts`), העמוד:

- מציג את כתובת ה-callback שיש להזין ב-Meta App Dashboard — `${APP_ORIGIN}/api/webhooks/whatsapp` (מחושב בשרת, `channels/page.tsx:12-13`).
- כולל **בדיקת חיבור** read-only (`testWhatsAppConnection`): GET למספר-הטלפון ב-Graph API שמאמת טוקן + phone_number_id **בלי לשלוח הודעה**, ומחזיר הודעה בטוחה-לפרטיות (הטוקן לעולם לא בלוג).
- הדגל `configured` נגזר בשרת (מינימום לשליחה = phone id + token, `channels.ts:46`), והעמוד מזהיר שהפעלת ערוץ מתחילה שליחות חיות בתשלום.

## פאנל פרטי חברה — `/admin/company`

מנהל את זהות החברה והמסמכים המשפטיים המוטמעים בהסכם שהלקוח חותם עליו (גילויי חובה
לפי חוק הגנת הצרכן §14ג + קישורי פרטיות/תנאים + נוסח אחריות). הטופס
(`company/company-form.tsx` + `company/actions.ts`) כותב לעמודות `company_*` /
`privacy_url` / `terms_url` / `warranty_text` שב-`app_settings`; ההסכם קורא אותן **חי** דרך
`getCompanyLegal` (`src/lib/data/company.ts`), כך שכל עדכון משתקף מיידית בהסכמים חדשים.
הערה בעמוד ממליצה על אישור עו"ד לפני הפעלה מסחרית.

## ניהול החוזה — `/admin/agreement`

זרימת אישור מונעת-DB מעל טבלת `agreement_documents`
(מיגרציה `202606290022_agreement_documents.sql`), בשכבת
`src/lib/data/admin/agreements.ts` (service-role מאחורי `requireAdmin`, כל שינוי מבוקר):

- **עריכה** (`updateAgreement`, שורות 40-62): שמירת `version` + `body_html` מותאם (או `null` = חזרה לתבנית הקוד המאומתת). **כל שינוי מחזיר את המסמך ל-`draft`** ומאפס `approved_by`/`approved_at` — חוזה שהשתנה חייב אישור מחדש.
- **אישור** (`approveAgreement`, שורות 66-80): `status='approved'`, רישום המאשר והזמן; ה-renderer מסיר את סימון הטיוטה.
- **שחזור לתבנית** (`revertAgreementToTemplate`, שורות 83-92).
- העמוד (`agreement/page.tsx`) מציג badges של סטטוס/גרסה/נוסח, את עורך ה-HTML (`agreement-client.tsx`), את טופס פרמטרי ההסכם (`agreement-config-form.tsx` → `config-actions.ts` → `agr_*`), ותצוגה מקדימה מלאה המרונדרת עם **נתוני דוגמה** לאירוע/מחיר (שורות 28-49) אבל עם הסטטוס/גרסה/נוסח השמורים בפועל.
- הצריכה בצד הלקוח נעשית דרך `getActiveAgreementDoc` (`src/lib/data/agreements-doc.ts`) ותבנית הרינדור ב-`src/lib/agreements/template.ts`.

## Webhook Inspector — `/admin/webhooks`

**מיושם במלואו** (לא מתוכנן-בלבד): המסמך `plans/webhook-inspector-plan.md` נכתב לפני
המימוש (מסומן "לעיון לפני מימוש", והחוסם שזיהה — היעדר `webhook_inbox` — נפתר במיגרציה
`202606290035_webhook_inbox.sql`); כל מה שתוכנן בו קיים היום בקוד, למעט רכיב `RelativeTime`
שלא מומש (מוצג זמן אבסולוטי בלבד). הריצה השוטפת מתועדת ב-`docs/admin-webhooks-runbook.md`,
שנמצא תואם לקוד.

מה שקיים בקוד (`webhooks/page.tsx`, `webhook-detail.tsx`, `webhook-inspector-client.tsx`,
`webhooks/actions.ts`, `src/lib/data/admin/webhook-inbox.ts`):

- **רצועת בריאות**: `getWebhookHealth` (`webhook-inbox.ts:117-143`) — זמן קבלה אחרון, ממתינים לעיבוד, נכשלו.
- **רשימה מעומדת + פילטרים בצד-שרת** (`listWebhookInbox`, שורות 52-93): kind (`message`/`status`), מצב עיבוד נגזר (pending/processed/error), טווח תאריכים, וחיפוש `q` על **מזהים טכניים בלבד** (`message_id`/`context_message_id`/`phone_number_id`) — לעולם לא על טלפון אורח. הקרנת הרשימה משמיטה את `payload` (PII) — הוא נטען רק בפירוט.
- **שיוך לאירוע וסטטוס-מסירה**: `resolveWebhookAssociations` (שורות 157-217) — batched, שתי שאילתות לכל עמוד (ללא N+1), מצליב wamid מול `contact_interactions` ומחזיר שם-אירוע (רמז לא-PII) + `delivery_status` לשורות status.
- **מגירת פירוט** דרך `?inspect=<id>` (server-rendered, bookmarkable): סיכום מפוענח, שגיאות Meta (קוד 131026 = "מספר שגוי", אחרת כשל מסירה — `webhook-detail.tsx:21`), `PhoneReveal` (טלפון ממוסך עד חשיפה מפורשת) ו-`PayloadViewer` (ה-JSON הגולמי מאחורי reveal-gate).
- **Reprocess**: `reprocessWebhookEventAction` (`webhooks/actions.ts:17-43`) מאפס `processed_at`/`last_error`/`attempts` כדי שה-worker ירים את השורה מחדש; בטוח לריצה כפולה (worker אידמפוטנטי + UNIQUE ב-DB), מבוקר ב-`logActivity` (מזהה בלבד, ללא PII).
- שינוי-תצורה של הערוץ עצמו אינו כאן אלא ב-`/admin/channels` (הפרדת אחריות מפורשת ב-runbook).

## טופס בדיקת SUMIT (PoC) — `/admin/sumit-test`

כלי אבחון אדמין-בלבד מול **SUMIT החי** (אזהרה בולטת בעמוד; מומלץ ₪1), לאימות התנהגות
REST לפני/לצד זרימת הייצור:

- **מסלול A — כרטיס חדש**: טופס `data-og="form"` שנטען עם jQuery + `payments.js` של SUMIT; הספרייה מבצעת טוקניזציה בצד-לקוח, מזריקה `og-token`, וה-ResponseCallback משחרר submit נטיבי (`sumit-test-form.tsx:48-75`). פרמטרים נבחרים: J5 (`AutoCapture=false`, ברירת המחדל) / J4, סכום, `VATRate`, `AuthorizeAmount`, `CardTokenNotNeeded`, `PreventDocumentCreation`, אימייל לשליחת מסמך.
- **מסלול B — טוקן שמור (J4)**: טופס שני נפרד לחלוטין, **ללא** `data-og` (כדי ש-`payments.js` לא ייגע בו — אומת מול המקור החי של הספרייה; `sumit-test-form.tsx:288-390` בקירוב). מחייב תוקף כרטיס + CitizenID (חובה לכרטיסים ישראליים) — נדחה בשרת לפני קריאה ל-SUMIT אם חסרים (`route.ts:151-161`). ברירת המחדל למסלול זה היא J4 (`route.ts:130-134`).
- **ה-Route Handler** (`/api/admin/sumit-test/route.ts`): `requireAdmin` + בדיקת Origin/Referer מול `APP_ORIGIN` (שורות 28-44), קריאת התצורה מ-`app_settings`, ואז `chargeRaw` (`src/lib/sumit/raw-charge.ts`).
- **Redaction (safe-preview)**: התגובה הגולמית לעולם לא מגיעה ל-DOM. `summarizeSumitRequest` / `summarizeSumitResponse` (`src/lib/sumit/safe-preview.ts`) הן הקרנת allow-list שטוחה: טוקנים / CitizenID / AuthNumber / אימייל / מזהי-חברה מוחזרים כבוליאני-נוכחות בלבד (`*_present` / `has_*`), ומפתח לא-מוכר לעולם לא מועתק.
- **באנר הצלחה/כישלון אמיתי**: SUMIT מחזירה HTTP 200 גם על עסקה שנדחתה; ההצלחה נקבעת מ-`Status===0 && Data.Payment.ValidPayment===true` (`route.ts:59-65`), והעמוד מציג באנר ✅/❌ מפורש לצד הבהרה שה-HTTP status אינו אינדיקציה.

## ניהול ארגונים (Org / Tenancy)

**אין עמוד ניהול-ארגונים ייעודי בפאנל.** הנוכחות היחידה של שכבת הארגונים באדמין היא בתוך
ניהול המשתמשים: ספירת ארגונים ברשימה ורשימת חברויות + תפקידים בעמוד המשתמש
(`users.ts` — `orgCount`, `orgs`). סכימת ה-multi-tenancy (מיגרציה
`202606280021_org_multitenancy.sql`, ארבעה תפקידים data-driven ו-`has_org_permission()`)
הוחלה ל-DB, אך שלבי ה-UI הניהולי (phases 2-5) **מתוכננים בלבד** נכון לעכשיו.

## עיקרון: עובדות עסקיות מגיעות מה-DB, לא מהקוד

מחיר, ערוצים, מסלולים ומדיניות הם **נתוני אדמין ב-DB** הנקראים בצד-שרת — לעולם לא קבועים
בקוד או ב-UI. כך זה נאכף במבנה:

- **מחירי חבילות ותמחור per-reached** — טבלת `packages` (`price_with_vat` בקטלוג; `price_per_reached`, `channels`, `outreach_schedule`, `min_hold_floor`, `hold_buffer_pct` לתבניות המסחריות). תבניות הקמפיין נקראות מהחבילות הפעילות (`listCampaignTemplates`, `src/lib/data/campaigns.ts:97`), ובעת אישור קמפיין המחיר **ננעל כהעתק** מהתבנית הקנונית (שם:157-166) — כך שגם שינוי עתידי בחבילה לא משנה קמפיין קיים.
- **ספי כיסוי** — `reasonable_coverage_contacts` / `extreme_threshold_contacts` נקראים מ-`app_settings` בזמן חישוב ה-hold (`campaigns.ts:398-427`), לא מקבועים.
- **פרמטרי החוזה** — שבעת ה-`agr_*` מוזרקים לתבנית ההסכם כ-tokens; ההערה ב-`agreement-config.ts:16-17` מנסחת את העיקרון במפורש: "Storing them as admin DB config (not code constants) keeps the agreement free of hardcoded business facts".
- **פרטי חברה ומסמכים משפטיים** — נקראים חיים מ-`app_settings` לתוך ההסכם.
- **תוכן פניות** — `message_templates` מנוהל ב-`/admin/templates`; מפתח ללא תוכן-פעיל לא שולח (fail-closed), כך ששום נוסח אינו קשיח בקוד השליחה.
- **דגלי הפעלה** — כל יכולת בתשלום (payments / holds / close-charge / outreach / sms / email) כבויה כברירת מחדל ונדלקת רק מהגדרת אדמין ב-DB (readers fail-safe ב-`payments.ts` / `outreach-config.ts`).

ערכי הדוגמה היחידים בקוד הם בתצוגה המקדימה של החוזה (`agreement/page.tsx:40-46`) —
מסומנים בעמוד כ"נתוני דוגמה" ואינם משמשים שום זרימה עסקית.

## ביקורת (Audit) וגבולות

- מוטציות אדמין רגישות — חבילות, חוזה, תפקידים/השעיות/זיכויים, reprocess של webhook — נרשמות ל-`activity` דרך `logActivity` (`src/lib/data/activity.ts`) עם מטא-דאטה לא-PII, ונצפות ב-`/admin/activity`.
- שגיאות מוצגות תמיד כהודעות עבריות בטוחות; פרטי DB/ספק לעולם לא מגיעים למשתמש (`users/actions.ts:28-30`, `error.tsx`).

## מגבלות ידועות

1. דגלי `campaign_holds_enabled` / `close_charge_enabled` וספי-הכיסוי ניתנים לשינוי רק ישירות ב-DB — אין להם עדיין טופס.
2. תצורת DKIM (`dkim_*`) נצרכת ב-`email/sender.ts` אך אינה נערכת מה-UI.
3. אין UI לניהול ארגונים (phases 2-5 של ה-multi-tenancy מתוכננים בלבד).
4. `/admin/sumit-test` פוגע בסביבת SUMIT החיה — כלי PoC מכוון, לא מסך תפעול שוטף.

## מסמכים קשורים

- `docs/admin-webhooks-runbook.md` — תפעול שוטף של מסך ה-Webhooks (תואם לקוד).
- `docs/webhook-inbox-data-contract.md` — חוזה הטבלה `webhook_inbox`.
- `docs/sumit-response-capture-and-audit.md` — מודל ה-redaction של תגובות SUMIT.
- `plans/webhook-inspector-plan.md` — מסמך התכנון ההיסטורי של ה-Inspector (מומש).
