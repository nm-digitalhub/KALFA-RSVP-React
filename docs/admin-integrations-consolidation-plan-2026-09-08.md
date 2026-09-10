# איחוד עמודי הספקים בפאנל הניהול (Integrations) — תוכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**תאריך:** 2026-09-08 · **עודכן:** 2026-09-10 (סוף יום) · **§0.5 = מה בוצע בפועל היום ומה הבא בתור** · **סטטוס:** ✅ **Phase 0 מוכנה ליישום.** §0.0 = מה שנפרס בלילה 8→9.9 · §0.1 = מדידת מצב 10.9 · §0.2 = סקירת שני מומחים · **§0.3 = ציר ההרשאות אוחד ונפרס 10.9, ושתי המיגרציות של התוכנית חייבות להשתנות בגללו.** קראו את §0.2 **ו-§0.3** לפני שמתחילים משימה.

---

## 0.0 עדכון 2026-09-09 — מה כבר בוצע, ומה שהתוכנית כתבה ולא נכון עוד

התוכנית נכתבה כמסמך מדידה, אבל מאז נעשו עליה עבודות. הסעיף הזה הוא הדלתא. **כל שורה למטה היא MEASURED מהלילה הזה** (קריאות חיות ל-Meta, ל-Voximplant ול-DB, ושליחות אמיתיות).

### בוצע ונפרס

| # | מה | מצב |
|---|---|---|
| G5 | **גרסת Graph אוחדה** — קבוע יחיד `GRAPH_API_VERSION` (`src/lib/whatsapp/graph-version.ts`). שישה מקומות שקיבעו גרסה בעצמם (v21 ×2, v23 ×4) + ברירת המחדל של ה-SDK מייבאים אותו עכשיו. `WHATSAPP_GRAPH_VERSION` בוטל (מעולם לא הוגדר). `graph-version.test.ts` סורק את עץ הקוד ומפיל כל גרסה קשיחה חדשה. | **סגור** |
| — | **מספרי טלפון בינלאומיים לאורחים** — `isAcceptablePhoneInput` (תוספת מעל `ISRAELI_PHONE_RE`, לא החלפה). אומת חי: הזמנה נמסרה ונקראה ב-‎+33756982370. לא היה בתוכנית. | **חדש** |
| — | **כפתורי אישור הגעה לכל סוגי האירועים** — `components.rsvp_quick_reply` היה `{"brit":true}` בארבע התבניות נושאות-הכפתורים, ולכן כל לחיצה בחתונה/בר מצווה/… נבלעה. מיגרציה `20260908194853`. אומת: לחיצה חיה → `rsvp_attending` → אורח עבר ל-`attending`. | **חדש** |
| — | **תשתית מוקלדת ל-Meta Graph — נכתבה, לא מחוברת.** שלושה מודולים חדשים, כולם `server-only`, **אפס צרכנים כרגע**: `whatsapp-client.ts` (מפעל ל-`@kapso/whatsapp-cloud-api@0.3.0` שמעביר `graphVersion: GRAPH_API_VERSION` במקום ברירת המחדל v23.0 של החבילה) · `graph-client.ts` (לקוח `openapi-fetch@0.17.0` מוקלד מול `paths` של המפרט) · `add-waba-phone-number.ts` (Task 2.1). בנוסף `generated/meta-schema.d.ts` — 1.06MB טיפוסים שנוצרו מ-`meta-openapi/business-messaging-api_v23.0.yaml` (facebook/openapi). זו הקרקע ל-Phase 2, ולא התנהגות שנפרסה. | **תשתית** |
| — | **מתג `whatsapp_consent_required`** ב-`/admin/channels` (לשונית WhatsApp) — תאום מדויק של `call_consent_required`, כולל אזהרת סעיף 30א והתראת `security` ב-Slack. מיגרציה `20260908212916`. **הבעלים כיבה אותו 9.9 00:37.** לא היה בתוכנית. | **חדש** |

### מה שהתוכנית כתבה ואינו נכון עוד

- **D3 — הגרסה היא `v25.0`, לא `v24.0`.** מדוד: קריאות ל-v24.0 ול-v25.0 מחזירות תוצאה זהה על WABA `990921550130385`, וארבע הזמנות אמיתיות נשלחו, נמסרו ונקראו על v25.0 משני המספרים העסקיים.
- **Task 1.3 כבר קיים** (`graph-version.ts`), אבל **בלי** override מ-env — בניגוד לחתימה שבשורה ~723. הקבוע הוא `as const` ובלי ייבואים בכוונה, כדי שגם ה-CLI שרץ ב-tsx וגם חבילת ה-worker יוכלו לטעון אותו.
- **Task 2.1 (אימות גוף `POST /{waba}/phone_numbers`) — נסגר.** המפרט הרשמי של Meta (facebook/openapi, commit `e96a1c9`) קובע: `phone_number` + `verified_name` חובה, `cc` אופציונלי, המספר בפורמט E.164 בלי `+` **עם** קידומת מדינה, ו-`verified_name` באורך 2–75. שימו לב: **75, לא 512** כפי שכתוב ב-Zod ב-Task 2.3. `src/lib/whatsapp/add-waba-phone-number.ts` כבר מממש את זה.
- **Task 2.2 — ארבע מתוך שבע הפונקציות כבר קיימות בחבילה, והחבילה כבר מותקנת.** `@kapso/whatsapp-cloud-api@0.3.0` מספקת `requestCode` / `verifyCode` / `register` / `deregister` + `GraphApiError` ממוין. היא **אינה** מכסה רשימת/הוספת מספרים, `debug_token` או מנויי webhook — אלה נשארים fetch ידני (ולכן `graph-client.ts` המוקלד קיים לצדה). ברירת המחדל שלה היא v23.0; `createWhatsAppManagementClient()` ב-`whatsapp-client.ts` הוא נקודת הכניסה היחידה, והוא מעביר `graphVersion: GRAPH_API_VERSION` — אין לבנות `new WhatsAppClient` ישירות. **המפעל עדיין ללא קוראים**; החיווט הוא Phase 2.
- **✅ פער הגרסאות בוטל מהשורש — מטא כן מפרסמת מפרט OpenAPI ל-v25.0.** קודם כתבתי כאן שאין כזה. זו הייתה טעות שנבעה מהסתמכות על תוויות: `info.version: v23.0` בריפו `facebook/openapi`, `Version: v18.0` ב-environment של Postman, `example: v22.0` בכותרת תגובה. מטא לא מפרסמת מונוליט מעודכן — היא מפרסמת **מסמך OpenAPI לכל API ולכל גרסה**, ישירות מעמודי ה-reference:
  `…/reference/<resource>/<api>/<version>.openapi.yaml`
  MEASURED 2026-09-09: v25.0 מחזיר 200 לשישה ממשקים; v26.0 מחזיר 500 לכולם — ראיה עצמאית לכך ש-v25.0 הוא החדש שפורסם, ואישור להחלטת D3. `npm run meta:types` נכתב מחדש: הוא קורא את `GRAPH_API_VERSION`, מוריד את ששת המפרטים לאותה גרסה אל `openapi/meta/` (מקומטים — קלון נקי חייב לייצר בלי רשת), מאמת ש-`info.version` שחזר תואם למה שביקשנו, ומייצר טיפוסים נפרדים לכל ממשק. **המונוליט של v23.0 (1.06MB) נמחק**; במקומו שישה קבצים ממוקדים, 121KB בסך הכול, כולם v25.0.
  | ממשק | מה הוא פותח |
  |---|---|
  | `phone-number-management` | Task 2.1 — רשימת והוספת מספרים |
  | `subscribed-apps` | **מנויי webhook** — התוכנית רשמה אותם כ"fetch ידני" |
  | `whatsapp-business-account` | משאב ה-WABA |
  | `account-number` | ישות מספר החשבון |
  | `add-phone-numbers` | זרימת ההוספה שמתחילה בצומת ה-business |
  | `client-wabas` | חשבונות לקוח (BSP) |
  ממשקים שאין להם מפרט באף גרסה שנוסתה: `message-template-management`, `messages`, `media`, `debug_token` — אלה נשארים fetch ידני, וזו רשימה מדודה ולא הערכה. `createMetaGraphClient` הפך לגנרי (`<paths>`), כך שכל מודול מביא את הטיפוסים של הממשק שהוא מדבר איתו ואין קובץ אחד שמקבע גרסה לכולם.
- **`unified_cert_status` הוא תקלה במפרט של מטא — השדה פשוט לא קיים.** עברתי כאן שתי מסקנות שגויות לפני שמדדתי: קודם "v25.0 הסירה את השדה", אחר כך "הוא לא זמין לחשבון הזה". שתיהן היו הסקה מתוויות. המדידה, `npm run meta:verify`, שואלת ארבעה שדות על ארבע גרסאות:
  | שדה | v23.0 | v24.0 | v25.0 | v26.0 |
  |---|---|---|---|---|
  | `unified_cert_status` | נדחה #100 | נדחה #100 | נדחה #100 | נדחה #100 |
  | `name_status` | יש ערך | יש ערך | יש ערך | יש ערך |
  | `username` | התקבל | התקבל | התקבל | התקבל |
  | `code_verification_status` (ביקורת) | יש ערך | יש ערך | יש ערך | יש ערך |
  מה שסוגר את זה הוא `name_status`: עמוד השדות הקנוני של מטא (`…/business-phone-numbers/phone-numbers`) מפרט `account_mode, code_method, code_verification_status, identity_key_hash, last_onboarded_time, max_phone_numbers_per_business, name_status, recipient_identity_key_hash, status` — **ו-`unified_cert_status` אינו שם כלל**. השדה שמחזיק את סטטוס ההסמכה הוא `name_status`, וה-enum שלו הוא זה שנושא `EXPIRED` ("the phone number's certificate has expired") ו-`NONE`. הוא עובד בכל ארבע הגרסאות; `unified_cert_status` נכשל בכולן. כלומר `unified_cert_status` מופיע **רק במפרטי ה-OpenAPI** — במונוליט v23 וגם במפרט הרשמי של v25.0 — ובשום מקום בתיעוד של מטא. זו תקלה במפרט, ולא סחיפת גרסה או הגבלת חשבון. אין מה "לתקן" אצלנו מעבר להחרגתו; אם Phase 2 צריך סטטוס הסמכה, השדה הוא `name_status`.
  **אומת משלושה כיוונים בלתי-תלויים (2026-09-09):** על ארבע גרסאות (v23–v26); על שני WABA נפרדים (`990921550130385` הפרודקשן ו-`1643175460059621`); ובשני טוקנים שונים — טוקן ה-System User שב-`app_settings` וטוקן USER של אפליקציית KALFA-RSVP עם `whatsapp_business_management` + `whatsapp_business_messaging`. בכל שנים-עשר הצירופים `unified_cert_status` נדחה ב-#100 ו-`name_status` החזיר `APPROVED`. זה שולל גרסה, חשבון והרשאה כאחד.

- **`host_platform` ו-`platform_type` הם אליאסים — לא פער.** תשובה חיה מחזירה `platform_type`, בעוד המפרט מצהיר `host_platform`; MEASURED: **שניהם מתקבלים ושניהם מחזירים `CLOUD_API`**. נבדק לפני שנרשם כפער, וזה לא כזה. רשום כאן כדי שלא ייפתח שוב.
- **`messaging_limit_tier` ו-`username` מתקבלים אך אינם מוחזרים** על אף אחד משלושת ה-WABA שנבדקו. הם אינם שגיאה — פשוט ריקים כאן. אין להסיק מהם מצב, ואין לצפות להם בטיפוס ללא `| undefined`.
- **החוזה המדוד של `GET /{WABA-ID}/phone_numbers` — מה שמתועד מול מה שעובד.** כל שורה נמדדה חי מול v25.0 ב-`npm run meta:verify`. זה החוזה שעליו Phase 2 בונה, ולא זה שכתוב במפרט.
  | יכולת | מטא אומרת | בפועל |
  |---|---|---|
  | שדה `unified_cert_status` | קיים (מפרט v23 **וגם** v25 הרשמי) | ❌ לא קיים — נשלל על 4 גרסאות, 2 WABA, 2 טוקנים |
  | שדה `name_status` | לא במפרט ה-OpenAPI, כן בתיעוד הפרוזה | ✅ זה השדה האמיתי לסטטוס הסמכה |
  | שדה `username` | לא ברשימת v25.0 | ✅ מתקבל (ריק אצלנו) |
  | `host_platform` / `platform_type` | המפרט אומר `host_platform` | ✅ **אליאסים** — שניהם מחזירים `CLOUD_API` |
  | `filtering` על `account_mode` | נתמך | ✅ |
  | `filtering` על `is_official_business_account` | נתמך | ✅ — **אבל רק עם `value: false` בוליאני**. `"false"` כמחרוזת נדחה |
  | `filtering` על `messaging_limit_tier` | נתמך | ✅ |
  | `sort=<field>.asc` / `.desc` | הפורמט המתועד, וגם היחיד שה-Graph API Explorer של מטא מציע | ❌ נדחה |
  | `sort=<field>_ascending` / `_descending` | **כן מתועד** — בעמוד business-phone-numbers: `sort=['last_onboarded_time_ascending']`. שני מסמכי מטא סותרים | ✅ עובד גם חשוף, גם כמערך |
  שני שדות המיון (`creation_time`, `last_onboarded_time`) ניתנים למיון אך **אינם ניתנים לקריאה** כשדות. הפורמט האמיתי חולץ מהודעת השגיאה: Graph מחזיר `Cannot sort by last_onboarded_time.desc_ascending` — כלומר הוא משרשר `_ascending` לערך שנשלח, מה שחושף את הסיומת הנכונה. **מלכודת שתפסה אותי:** הכישלון הראשון של סינון OBA היה **שלי** — שלחתי `"value":"false"` כמחרוזת. השגיאה הטעתה במפורש (`Filtering field … with operation 'equal' is not supported`) כי היא מאשימה את האופרטור בעוד הבעיה בטיפוס הערך. עם `"value":false` בוליאני זה עובד. הלקח לכל שאר הסינונים: השגיאה של Graph אינה מצביעה בהכרח על החלק השבור.
  **מסקנה ל-Phase 2:** גם מיון וגם שלושת הסינונים אפשריים בשרת.
  **ההגנה מיושמת בצינור:** `npm run meta:types` מתקן את המפרט בזיכרון לפני הייצור — מחליף את ה-enum של `sort` ל-`_ascending`/`_descending`, מסיר את `unified_cert_status` מהסכימה, ומחליף את אזכורו בהערת ה-`fields` באזהרה מנומקת. התיקון נעשה **בזיכרון בלבד**: הקובץ ב-`openapi/meta/` נשאר עותק נאמן של מה שמטא שירתה, כך ש-`git diff` בהרצה הבאה מראה מה מטא שינתה ולא מה הסקריפט עשה. **לכן `meta:verify`, שקורא את הקובץ הגולמי, ימשיך לדווח על `unified_cert_status` כאי-התאמה כל עוד מטא לא תיקנה — וזה מכוון:** השער מודד את מטא, לא את התיקון שלנו. הסרת השדה מהערת ה-`fields` חשובה במיוחד — היא הופכת ל-JSDoc, ומפתח שיעתיק ממנה את השם יקבל בקשה מתה. הדוח למטא: `docs/meta-api-discrepancies-report-2026-09-09.md`.
- **הכלל שנגזר: רשימת השדות במפרט אינה מנבאת מה ה-API מקבל, בשני הכיוונים.** `unified_cert_status` מוצהר ונדחה; `username` אינו מוצהר ב-v25.0 ומתקבל. ולכן Graph דוחה את **כל** הבקשה על שדה אחד שאינו זמין — בניית `fields=` מהטיפוסים בלי סינון מייצרת קריאה מתה. `npm run meta:verify` הוא השער: להריץ אחרי כל `meta:types` ולפני חיווט Phase 2.
- **v26.0 עונה לקריאות, אך אין לו מפרט OpenAPI.** MEASURED: שלושת השדות שנבדקו עובדים על v26.0, בעוד `…/v26.0.openapi.yaml` מחזיר 500 בכל ששת הממשקים. כלומר קפיצה ל-v26.0 אפשרית טכנית אך תשאיר את הטיפוסים מאחור — סיבה נוספת להישאר על v25.0 עד שמטא תפרסם.

- **G2 — המספר השני מוגדר אצל Meta, לא "לא מוגדר".** מדוד: `1298694319994421` (‎+972 3-330-1505) — `CONNECTED`, `LIVE`, איכות `GREEN`, שם `APPROVED`, ואף שלח בהצלחה הזמנה אמיתית הערב. מה שחסר הוא **חיווט בצד קלפא** (אין תפקיד, אין טיפול ב-webhook ממנו), לא רישום אצל Meta. זה מקטין את Phase 1 ומחזק את הצורך בתפקיד `business_line_inbound`.
- **§4.2 — ה-backfill של `voximplant_caller_id` ייכשל כפי שנכתב.** הערך החי הוא 11 ספרות **בלי** `+` (`97237219347`), וה-`case` שבמיגרציה מסנן לפי `^\+…` ולכן היה כותב `null`. יש להוסיף `+` כשהערך ספרות בלבד.
- **§5.2 — רכישת מספר גיאוגרפי בישראל אינה יכולה לעבוד ב"מצב מספר ספציפי".** מדוד: `GetPhoneNumberCategories(IL)` מחזיר `can_list_phone_numbers: false` לכל הקטגוריות פרט ל-MOBILE, ו-`GetNewPhoneNumbers` נכשל עם שגיאה 529. הפלטפורמה בוחרת את המספר. ההגנה שהתוכנית מציעה ("לעולם לא מצב קטלוג") חייבת להתחלף בהצגת מחיר + אישור מוקלד לפני `AttachPhoneNumber` במצב קטלוג.

### שאלות §9 שנסגרו

- **Q3 — כן.** ה-DID היחיד בחשבון Voximplant הוא `97237219347`, `phone_id` 2303422, אזור TEL AVIV, ACTIVE, מקושר לאפליקציה 11107202 ו**לא** מקושר ל-rule (הניתוב לפי pattern). חידוש הבא: 2026-09-14, 5$ לחודש, `auto_charge` פעיל.
- **Q4 — Owner** (`GetKeyRoles` → `role_id` 1). כלומר רכישה, קישור וביטול מספר אפשריים מהפאנל. `GetRegulationsAddress` הצליח, מה שמאשר את התפקיד בפועל.
- **Q5 — `whatsapp_app_id` אינו קיים** ב-`app_settings` (מדוד). `META_APP_ID_WA` קיים ב-`.env.local` ואף קוד לא קורא אותו. ההחלטה עדיין פתוחה.

### סיכונים §8 שנסגרו או השתנו

- **סיכון 7 (טוקן) — חמור יותר ממה שנכתב, ושייך ל-Phase 0.** מדוד ב-`debug_token`: הטוקן הוא **USER ולא System User**, `expires_at: 0` (לא פוקע), אבל `data_access_expires_at = 2026-12-07` (התוכנית כתבה 2.12). ההרשאות רחבות מדי: `ads_management`, `ads_read`, `pages_*`. כל פעולת כתיבה ב-Phase 1 תיפול על טוקן כזה בעוד שלושה חודשים.
- **סיכון 8 (רגולציה IL) — סגור.** לחשבון כבר יש כתובת רגולציה מאומתת: `regulation_address_id` 1418, `status: VERIFIED`. אין צורך בצעד ב-Control Panel.
- **חדש — `code_verification_status: EXPIRED` על `1018741517998430` אינו תקלה.** הערך אינו מתועד כלל לשדה הזה (המפרט והתיעוד מגדירים רק VERIFIED/UNVERIFIED/NOT_VERIFIED). **כרטיס בריאות המספר חייב להתבסס על `health_status.can_send_message`** — הוא מוחזר לכל ארבע הישויות (מספר, WABA, עסק, אפליקציה) וכולן `AVAILABLE`. השדה `health_status` אינו במפרט הרשמי אך מוחזר חי.
- **חדש — SIP calling אינו מוגדר** לשני המספרים (שגיאות 138024/138025 ב-`can_receive_call_sip`). לא משפיע על הודעות. מחוץ להיקף.

---

## 0.1 עדכון 2026-09-10 — מדידת מצב, ושלוש טענות שצריך לתקן

כל שורה כאן **MEASURED היום** (`ls`, `git log`, ושאילתות ל-DB החי). הסעיף הזה נכתב אחרי קריאה מלאה של המסמך, ומטרתו למנוע ממי שיתחיל משימה להניח שמשהו כבר קיים.

### תיקון 1 — הענף כבר לא מתאר את עצמו

`feat/admin-integrations-consolidation` מחזיק **39 קומיטים**, ורובם המכריע הם פיצ'ר **אוטומציית תהליכים** (עורך, מנוע, קטלוג, runner על pg-boss) שאין לו קשר לתוכנית הזו. מה שכן שייך לתוכנית הוא בדיוק התשתית שב-§0.0.

**Phase 0 לא התחילה.** מדוד:

| מה התוכנית מבטיחה | בפועל |
|---|---|
| `(admin)/integrations/**` | ❌ הספרייה אינה קיימת |
| מחיקת `(admin)/channels`, `templates`, `alerts` | ❌ שלושתם קיימים |
| `redirects()` ב-`next.config.ts` | ❌ אין (המופע היחיד של המילה הוא הערה על `/g/:token`) |

לכן הכותרת "כבר לא תוכנית בלבד" הייתה מטעה: **התשתית** בוצעה, **הפאזות** לא.

### תיקון 2 — Phase 1 ו-Phase 5 לא נגעו ב-DB

| טבלה / קובץ | פאזה | קיים? |
|---|---|---|
| `provider_numbers` · `provider_number_roles` | 1 (§4.2) | ❌ |
| `message_template_variant_health` | 5 (§4.3) | ❌ |
| `app_settings.whatsapp_app_id` | 2 (§4.4) | ❌ — Q5 עדיין פתוחה, וזה **חוסם** את `debugToken` (Task 2.2) ואת מנויי ה-webhook (Task 5.4) |
| `src/lib/whatsapp/phone-numbers.ts` | 1.3 | ❌ |
| `src/lib/sms/extra-client.ts` · `docs/extra/openapi-extra-v1.json` | 0.5 | ❌ |

מה ש-§0.0 הכריז כבוצע **אומת שוב היום וכולו במקומו**: `graph-version.ts` (`'v25.0' as const`, בלי override מ-env — כפי ש-§0.0 תיקן), `whatsapp-client.ts`, `graph-client.ts`, `add-waba-phone-number.ts` (שלושתם עדיין **ללא צרכנים**), ששת מפרטי v25.0 ב-`openapi/meta/`, ו-`meta:types` + `meta:verify` ב-`package.json`.

### תיקון 3 — המספרים ב-§2 ו-§1.3 התיישנו, וG2 החמיר

| נתון | התוכנית (8.9) | מדוד 10.9 |
|---|---|---|
| `webhook_inbox` למספר **הלא-מוגדר** `1298694319994421` | 38 | **48** (אחרון 2026-09-08 19:55) |
| `webhook_inbox` למספר ה-RSVP `1018741517998430` | 686 | **707** |

עשרה אירועים נוספים הגיעו למספר שאיש אינו יודע עליו. **G2 אינו סטטי — הוא צובר.**

**D4 / G11 ללא שינוי:** עדיין בדיוק שלוש תבניות ב-drift, ואותן שלוש — `kalfa_sales_signup_link_v1`, `kalfa_event_thankyou_v1`, `kalfa_event_gift_v1`, כולן `UTILITY → MARKETING`. מתוך 9 תבניות.

**סיכון 7 (טוקן) — ספירה לאחור:** `data_access_expires_at = 2026-12-07`, כלומר **88 יום** מהיום. עדיין חוסם כל כתיבה ב-Phase 1+.

### הערת תכנון שנרכשה ביוקר היום, ורלוונטית ל-§4.2

מנוע התהליכים שנבנה בענף הזה נכשל בדיוק בכשל ש-§4.1 מנסה למנוע, ובכיוון ההפוך ממה שהתוכנית שומרת מפניו. `workflow_runs.trigger_source` הוא **טקסט חופשי** וההערה שלו במיגרציה אומרת מפורשות "the set grows with every new trigger node type" — אבל **הקוד** כתב ליטרל `'whatsapp_inbound'`. הסכמה הייתה פתוחה והקוד סגר אותה, ולכן כל דרך חדשה להתחיל תהליך הייתה מחייבת לגעת בקובץ ה-store. **התוצאה הנמדדת: 20 תהליכים שמורים, אחד מחומש, ו-0 הרצות אי-פעם** — עד שנוסף מסלול הפעלה שני (10.9).

**מה זה אומר ל-§4.2:** `provider_number_roles.role` הוא `CHECK` סגור על עשרה ערכים. זו החלטה סבירה (תפקיד הוא חוזה עם קוד ריצה, לא תווית לוג — בניגוד ל-`trigger_source`), אבל היא אומרת שהוספת תפקיד = מיגרציה. כשמגיעים ל-Task 1.1 כדאי לוודא שעשרת הערכים באמת מכסים את מה שידוע היום, כי §5.3 כבר הוסיף אחד (`business_line_inbound`) אחרי הניסוח הראשון — סימן שהרשימה עוד זזה.

---

## 0.2 סקירת מוכנוּת 2026-09-10 — שני מומחים, 34 תיקונים

שני סוכנים מומחים קראו את המסמך במלואו ובחנו אותו מול הקוד ומול ה-DB החי. **כל התיקונים שלהם כבר מוחלים בגוף המסמך** — הסעיף הזה הוא מה שנמצא ומה שנשאר פתוח.

**מה נעשה:** אימות של 37 ציטוטי `file:line` מול הקוד (26 תואמים, 11 התיישנו) · 11 שאילתות קריאה ל-DB · **הרצה יבשה מלאה של §4.2–§4.4 ב-`begin; … rollback;` מול הפרויקט החי**, כולל בדיקת RLS בפועל תחת `authenticated` לא-admin ותחת `anon`. ה-DB לא נגע: `to_regclass` של שלוש הטבלאות = null אחרי, ו-`migration list --linked` = אפס drift.

### פסק דין לפי פאזה

| פאזה | מצב |
|---|---|
| **0** | ✅ **מוכנה.** כל החוסמים היו תיקוני מסמך והוחלו |
| **1** | ✅ **מוכנה** אחרי תיקון §4.2 (ראו למטה) ואחרי `meta:verify` על שישה שדות (Task 1.3 Step 0b) |
| **2** | ⛔ **חסומה** על §9 שאלה 5 — הכרעת בעלים על `whatsapp_app_id` |
| **3** | ⚠️ **פתוחה אחרי הכרעה** — ההגנה שנוסחה מבטלת את הפאזה בישראל; החלופה בגוף §5.2 |
| **4–5** | ✅ מוכנות |
| **6** | פתוחה על D9 (compliance) |

### ארבעה באגים שהיו מפילים את המיגרציה או את הפאזה

1. **§4.2 נפלה בהרצה היבשה** — `ERROR 23514`, הפרת `provider_numbers_ref_or_e164`. `voximplant_caller_id` הוא `97237219347` (11 ספרות בלי `+`), ה-`case` החזיר null, ו-`provider_ref` היה null בכוונה. `on conflict do nothing` **אינו** תופס הפרת CHECK. וחשוב מזה: Task 1.3 ממזג את השורה **לפי E.164**, כך ששורה בלי e164 אינה ניתנת למיזוג לעולם וארבעת תפקידי הקול היו נתקעים. **תוקן:** נרמול E.164 לכל ארבעת המקורות.
2. **המיגרציה לא הייתה אידמפוטנטית** למרות שההערה הבטיחה שכן — האינדקס הייחודי חלקי (`where provider_ref is not null`) ושורת Voximplant נכנסת בלי `provider_ref`. **תוקן:** `unique index … (provider) where source='backfill'`.
3. **הקריאה הראשונה ל-Meta הייתה מחזירה שגיאה** — `last_onboarded_time` ברשימת ה-`fields`, בזמן ש-§0.0 עצמו מדד שהוא ניתן למיון אך **לא לקריאה**, ושגרף דוחה את כל הבקשה על שדה אחד. אושר עצמאית: במפרט הרשמי המקומי הוא מופיע חמש פעמים, **כולן תחת `sort` בלבד**. **תוקן:** הוסר, ונוספו שלושה צעדים חוסמים ל-Task 1.3.
4. **טופס הסכמת הוואטסאפ היה נמחק בשקט** — המתג נוסף 8.9 (חשיפת סעיף 30א) אחרי כתיבת התוכנית, וטווחי ההעתקה ב-Task 0.3/0.4 לא כללו אותו. **תוקן:** חמישה רכיבים יתומים קיבלו קבצי יעד, כל הטווחים אומתו מחדש, ונוספה ספירת שלמות לפני המחיקה.

### שלוש מלכודות שקטות שתוקנו

- **`try/catch` סביב `requirePlatformPermission`** היה בולע `NEXT_REDIRECT` — והדפוס שצוטט כאסמכתא (`nav-counts`) אינו try/catch כלל אלא `hasPlatformPermission`.
- **שער Phase 0 היה ירוק בשקר:** `admin-data-layer-coverage.test.ts` סרק מפה קשיחה, וקובץ שאינו בה לא נבדק. ✅ **תוקן 10.9** — `readdirSync` + נפילה סגורה, והסריקה הורחבה ל-Server Actions ול-route handlers (§0.3).
- **`call_1` (`channel='call'`) היה מייצר התראת `NOT_FOUND` בכל סנכרון לנצח**, כי Task 5.1 לא ירש את הסינון הקיים.

### הקיבעון — מה שהפך לשאלה לבעלים

המשוב על סכמות סגורות נבדק מול התוכנית ונמצא בחמישה מקומות. שניים הפכו לשאלות פתוחות (§9 שאלות 9 ו-12: מיקום עמוד התבניות, ורישום נתוני לספקים), אחד לתיקון (§5.2, מצב הקטלוג בישראל), ואחד למנגנון: **בדיקת drift של ~20 שורות** שמצמידה את ה-`CHECK` ל-union ב-TS (Task 1.1 Step 4). ה-`CHECK` עצמו נשאר — תפקיד וספק הם חוזה עם קוד ריצה, לא תווית לוג — אבל הרשימה כבר זזה פעם אחת בתוך המסמך והטיפוס לא עקב, וזה בדיוק הפער של `trigger_source`.

### הכרעה אחת שנשארה פתוחה — ואינה דחופה

`provider_number_roles.role` הוא היום `text + CHECK`. המומחה שהריץ את המיגרציה ממליץ להפוך אותו (ואת `provider.provider`) ל-**enum של Postgres**, כי אז המנגנון שמונע את פער-הטיפוס **כבר קיים ואינו עולה שורת קוד**: `gen:types` פולט את ה-enum, ו-`scripts/check-supabase-types.mjs` — הצעד הראשון ב-`npm run deploy` (MEASURED) — חוסם פריסה על drift. זה גם דפוס הבית (`app_role`, `campaign_channel` ועוד שמונה). הפירוט והחלופה ב-Task 1.1 Step 4. **אימוץ ההמלצה מחייב להריץ את הדריסה היבשה שוב**, כי היא משנה SQL שכבר אומת.

### שתי הסתייגויות שנרשמות במפורש

- `meta:verify` **לא הורץ** בסקירה. הראיה ל-`last_onboarded_time` היא מדידת §0.0 + ספירת מופעים במפרט המקומי — חזקה, אך לא פרוב חי. Task 1.3 Step 0b סוגר את זה.
- ההרצה היבשה כיסתה את §4.2–§4.4 בלבד. שאר התיקונים הם תיקוני מסמך שלא ניתן להריץ.
- הראיה ל-`ERROR 23514` הגיעה משתי דרכים בלתי-תלויות: הרצה יבשה בפועל (מומחה המיגרציות) והערכת תנאי ה-CHECK מול הערך החי ב-`SELECT` (מומחה המוכנוּת). שתיהן הצביעו על אותה שורה.

---

## 0.3 עדכון 2026-09-10 (ערב) — ציר ההרשאות אוחד, נפרס, ומשנה את התוכנית בארבעה מקומות

שאלה 9.10 ("האם `requireAdmin` מצמצם גישה?") נענתה בתשובה חזקה מהצפוי: **שני צירי ההרשאה מוזגו לאחד.** מיגרציה `20260910090301_platform_staff_is_the_admin_floor.sql` הוחלה ע"י הבעלים, ושבעה קומיטים נפרסו ב-14:22 (`.deploy-id = mtvftwmb`, אומת חי).

**מדוד 10.9 אחרי הפריסה:**

| | |
|---|---|
| מדיניות RLS על `has_role` | **0** |
| מדיניות RLS על `is_platform_staff()` | **21** |
| `await requireAdmin()` בקוד (מחוץ לבדיקות) | **0** |
| `requireAdmin` עצמה | `@deprecated` ב-`dal.ts`, נשארת רק כדי שלא תישבר קריאה חיצונית |

### ⛔ חוסם — §4.2 ו-§4.3 מייצרות מדיניות על הציר שפרש

שלוש המדיניות ב-SQL של התוכנית כתובות `public.has_role((select auth.uid()), 'admin'::app_role)`. הרצתן היום **תחזיר את הציר הישן לבסיס נתונים שהרגע ניקה אותו מ-21 מדיניות**, ותיצור שתי טבלאות שאף אחד מהשומרים החדשים אינו מכסה.

**התיקון (שלוש החלפות, אין שינוי סמנטי — שתי הקבוצות זהות היום):**

```sql
-- provider_numbers_admin_all, provider_number_roles_admin_all, mtvh_admin_select
-  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
+  using ((select public.is_platform_staff()))
```

`is_platform_staff()` היא `SECURITY DEFINER`/`STABLE` עם `search_path` מקובע — אותה חתימה בדיוק שהמיגרציה של 10.9 השתמשה בה ב-21 המדיניות, וה-`( SELECT … )` העוטף נשמר כדי שההערכה תישאר פעם-אחת-לשאילתה ולא פעם-לשורה.

⚠️ **הדריסה היבשה של §4.2–§4.4 (10.9 בוקר) בוצעה על ה-SQL הישן.** אחרי ההחלפה **יש להריץ אותה שוב** ב-`begin; … rollback;` — כולל בדיקת ה-RLS תחת `authenticated` שאינו staff. זה מצטבר עם האזהרה הזהה ב-Task 1.1 Step 4 (אימוץ enum): אם שניהם מאומצים — הרצה יבשה **אחת** אחרי שניהם.

### שער Phase 0 — האזהרה התיישנה, אבל לא במלואה

§0.2 רשמה: *"שער Phase 0 היה ירוק בשקר: `admin-data-layer-coverage.test.ts` סורק מפה קשיחה"*. **תוקן 10.9.** הבדיקה כותבת עכשיו `MODULES = readdirSync('src/lib/data/admin')` ו**נופלת סגור** על כל קובץ חדש שאינו מסווג. נוספו שני שומרים:

- **אין מודול תחת `src/lib/data/admin` שקורא `requireAdmin()`** — הציר הפרוש מחוץ לתיקייה לתמיד;
- **שום דבר שהלייאאוט ממתין לו אינו בודק את הציר הפרוש** — הרגרסיה שנתפסה בפועל: `getAdminNavCounts` קרא `requireAdmin()` ולכן זרק חבר צוות שאינו owner אל `/app` **אחרי** שהלייאאוט כבר הכניס אותו.

**מה שנשאר נכון מהאזהרה:** קובץ חדש עדיין חייב רשומה מפורשת ב-`EXPECTED_PERMISSION` (מפתח) או ב-`COARSE_GATE_ALLOWED` (פטור מנומק). ההבדל: פעם השתיקה עברה, היום היא נופלת.

**בנוסף — הסריקה הורחבה מעבר לתיקיית ה-DAL:** כל `actions.ts` ו-`route.ts` תחת עץ האדמין נבדקים, כי **Server Action היא endpoint בפני עצמה** ושער העמוד אינו רץ עבור מי שקורא לה ישירות. זה נמצא בפועל: 16 פעולות ב-`voice/`, `alerts/` ו-`fleet/` היו על הרצפה הגסה, ביניהן כותבת מפתח ElevenLabs וכותבת webhook secret של Slack. **כל `actions.ts` חדש ב-Phase 0 נכנס לסריקה אוטומטית.**

### §3.6 — `requireAdmin()` לאינדקס כבר אינו אפשרות

התוכנית כותבת *"אינדקס `/admin/integrations`: `requireAdmin()` בלבד"*. הפונקציה `@deprecated` ואפס קוראים. **הרצפה היא `requirePlatformStaff()`** — אותה כוונה בדיוק ("כל חבר צוות נכנס, כל כרטיס נבדק בנפרד ב-`hasPlatformPermission`"), על הציר הנכון. שאר §3.6 עומד כפי שהוא.

### הניווט מסונן — סיכון 12 התהפך

סיכון 12 קבע: *"Nav visibility ≠ gate — כמו היום: כל admin רואה 'אינטגרציות'"*. **זה כבר לא המצב.** `NAV_GROUPS` נושא היום `permission` לכל פריט, `getAdminNavGrants()` פותר בשרת, והלקוח מסנן. אומת חי על `billing_clerk`: 8 קישורים במקום 33.

**מה זה אומר ל-Task 0.6 Step 1:** פריט התפריט החדש **חייב** `permission: 'manage_settings'`, אחרת `src/components/admin-nav-coverage.test.ts` מפיל את הבנייה. אותה בדיקה גם מצמידה שהמפתח בתפריט **שווה** למפתח שהעמוד אוכף — כלומר `integrations/page.tsx` על `requirePlatformStaff()` (בלי מפתח) מחייב רישום ב-`NO_PERMISSION_BY_DESIGN`, בדיוק כמו `/admin` ו-`/admin/analytics`.

**הסינון אינו שער.** הקישור המוסתר עדיין ניתן להקלדה, והעמוד הוא שמסרב — זה מה ש-§3.6 כבר אומר, וזה לא השתנה.

### §9 שאלה 10 — נענתה אחרת ממה שנרשם

הרישום הקודם: *"0 שיאבדו גישה, 0 שיקבלו… השאלה נותרת רלוונטית רק כשיתווסף חבר צוות שאינו owner"*. **זה קרה באותו יום.** הבעלים הקצה `חיוב וגבייה` ל-`yaakov7676@gmail.com`, והוא בפועל **חבר הצוות הראשון שאינו owner**. הפער שהמדידה לא ראתה: `assignStaffRole` כותב רק ל-`platform_staff`, `setPlatformAdmin` כתב רק ל-`user_roles`, ואף מנגנון לא סנכרן — כלומר כל ארבעת התפקידים הלא-owner היו **בלתי שמישים כפי שנשלחו**. זה מה שהכריח את המיזוג.

---

## 0.4 עדכון 2026-09-10 (ערב) — רשימת האינטגרציות כבר קיימת, ויש בה תקלת סודות

הבעלים הצביע על `/admin/debug`. **הפאנל שם כבר עושה את מה ש-Task 0.1 מבקש לבנות מאפס** — `getIntegrationsStatus()` (`src/lib/ops/integrations.ts`) מחזיר שבעה ספקים עם `configured` · `lastCheckedAt` · `healthCheckAvailable` · `note`.

### חפיפה מדודה

| | `/admin/debug` (קיים) | Task 0.1 (מתוכנן) |
|---|---|---|
| מקור | `src/lib/ops/integrations.ts` | `integrations/index.ts` — קובץ חדש |
| שדות | configured · lastCheckedAt · healthCheckAvailable · note | configured · **enabled** · lastCheckedAt · note |
| ספקים | ElevenLabs · Voximplant · Slack · WhatsApp · SUMIT · ExtrA · **GA4** | WhatsApp · Voximplant · ExtrA · **דואר** · **Microsoft** · SUMIT · Slack |
| שער | `requirePlatformOwner()` (בעמוד) | חבר צוות |
| תצוגה | רשימה לקריאה | כרטיסים לחיצים |

**חמישה ספקים חופפים.** התוכנית גם קובעת ש-`/admin/debug` **נשאר** (§3.3), כלומר Task 0.1 כפי שנכתב מייצר **שתי רשימות אינטגרציות** משתי פונקציות עצמאיות — שתיהן יכולות להראות תשובה אחרת על אותו ספק. זה בדיוק הכשל שהתוכנית באה לתקן.

### ⛔ מה שהמדידה חשפה: חמישה סודות כדי לחשב חמישה בוליאנים

§0.2 כבר קבעה לגבי האינדקס החדש: *"אין להשתמש ב-`getSumitCredentials()` וב-`getExtraSmsConfig()` — שתיהן מחזירות סודות, והשימוש היחיד בהן כאן הוא לגזור בוליאני `configured`."* התיקון שנקבע: `getIntegrationsConfiguredFlags()` — שאילתה אחת שמחזירה נוכחות בלבד.

**MEASURED 10.9: הפונקציה הקיימת סובלת בדיוק מאותה בעיה, ובהיקף גדול יותר.**

| ספק | מה `getIntegrationsStatus` טוענת לזיכרון | למה |
|---|---|---|
| WhatsApp | `accessToken` + `appSecret` (`WhatsAppConfig`) | `!== null` |
| Voximplant | ה-service account JSON (`auth: VoximplantConfig`) | `!== null` |
| ElevenLabs | המפתח עצמו (`{ key }`) | `key !== null` |
| Slack | ה-bot token (`botToken`) | `!== null` |
| SUMIT | ה-API key (`{ companyId, apiKey }`) | `!== null` |

חמישה סודות נקראים דרך `createAdminClient()` (service-role, עוקף RLS) כדי להציג חמישה סימני ✔/✘. הם אינם דולפים החוצה — הפאנל מרנדר בוליאנים בלבד — אבל הם **בזיכרון התהליך על כל טעינה של `/admin/debug`**, בלי צורך.

### ההכרעה: להרחיב את הקיימת, לא לכתוב תאומה

**Task 0.1 מוחלף.** במקום `getIntegrationsOverview()` חדש:

1. **`getIntegrationsConfiguredFlags()`** — שאילתה **אחת** ל-`app_settings` שמחזירה נוכחות + מתגים, ואפס סודות. גם מחליפה שבע נסיעות נפרדות לאותה שורת singleton.
2. **`getIntegrationsStatus()` מקבלת ממנה את `configured`** במקום מחמשת ה-resolvers — הפאנל ב-`/admin/debug` ממשיך לעבוד בדיוק כמו היום, בלי סוד אחד בזיכרון.
3. **נוסף `enabled`** לכל שורה — המתג של הספק עצמו. מדוד, כל אחד עמודה ב-`app_settings`:
   `outreach_enabled` (WhatsApp) · `voximplant_live_calls` · `sms_enabled` · `email_enabled` · `payments_enabled` (SUMIT) · `slack_alerts_enabled`. ל-ElevenLabs ול-GA4 **אין מתג** — `enabled = configured`, ונאמר כך במפורש ולא בשקט.
4. **נוספים שני ספקים** שהתוכנית דורשת ו-debug אינו מציג: דואר (`smtp_from` + `email_enabled`) ו-Microsoft. **Exchange מוחרג ב-debug בכוונה** — יש לו פאנל ייעודי שמציג את החיבורים של **כל** האדמינים, בעוד `listMyExchangeConnections()` מחזיר את של הקורא בלבד. העמוד החדש חייב להשתמש באותו מקור של הפאנל הייעודי, לא בגרסת ה-"שלי".
5. **הרשאה.** הפונקציה היום אינה מגדרת את עצמה כלל — היא נשענת על `requirePlatformOwner()` שבעמוד. משנפתחת לכל חבר צוות היא **חייבת שער משלה**. הרצפה: `requirePlatformStaff()` (§0.3), ולכל כרטיס `hasPlatformPermission` שקובע אם הוא לחיץ — בדיוק כפי ש-§3.6 כבר קובע.

**GA4 נשאר ב-debug ואינו עולה לעמוד האינטגרציות**: הוא אינו ספק שמישהו "מחבר" מהפאנל, ואין לו עמוד יעד. הוא נשאר שורה באבחון.

---

## 0.5 סטטוס 2026-09-10 (סוף יום) — Task 0.1 בוצעה, והשלב הבא הוא 0.2

**Phase 0: משימה אחת מתוך שש.** כל שורה מדודה מהעץ (`ls`) ומהמסד, לא מהזיכרון.

| משימה | מצב |
|---|---|
| **0.1 אינדקס + כרטיסי סטטוס** | ✅ **בוצע** — `(admin)/admin/integrations/page.tsx` חי ופרוס |
| 0.2 פיצול `appSettingsSchema` ו-DAL לספקים | ⬜ לא התחיל — אפס מהשלושה (`sumitCredentialsSchema`, `extraSmsSchema`, `emailTransportSchema`) |
| 0.3 עמוד Meta/WhatsApp | ⬜ |
| 0.4 עמוד Voximplant | ⬜ |
| 0.5 ExtrA · Resend · SUMIT · Microsoft · Slack | ⬜ |
| 0.6 Nav + redirects + מחיקת הישנים | 🟡 **פריט הניווט נוסף**; אין `redirects()`, שלושת העמודים הישנים במקומם |

### שלוש סטיות מ-Task 0.1 כפי שנוסחה, כולן מכוונות

1. **ה-DAL אינו `getIntegrationsOverview` חדש** — הוא מרחיב את `getIntegrationsStatus` הקיימת (§0.4). זה מה שמונע שתי רשימות סותרות באתר.
2. **הכרטיסים מקשרים למקום שבו ההגדרות יושבות היום** (`/admin/channels`, `/admin/settings`, `/admin/alerts`), ולא לעמודי `/admin/integrations/<provider>` שטרם קיימים. כך העמוד שימושי מהקומיט הראשון במקום קיר של אריחים מתים. כל href יופנה מחדש כשהעמוד שלו נוחת ב-0.3–0.5.
3. **המתג הראשי וקטלוג הערוצים מקושרים, לא מוטמעים.** הטמעה דורשת לחלץ רכיבים מ-`channels-client.tsx` — שזו בדיוק העבודה של Task 0.3/0.6, ואין טעם לגעת בקובץ ההוא פעמיים.

**מה שלא נעשה מ-0.1 ושווה להשלים:** בדיקת רינדור לעמוד (`integrations/page.test.ts`). ה-DAL מכוסה ב-15 בדיקות, אבל אין בדיקה שמצמידה שהעמוד באמת מרנדר כרטיס נעול כ"אין הרשאה" ולא כקישור — וזו בדיוק הרגרסיה שהייתה מחזירה את הבאג.

### מה שנסגר היום מחוץ ל-Phase 0

- **G10 — בדיקת בריאות ל-WhatsApp.** נסגר. `whatsapp-health-check` רץ כל שעה (`25 * * * *`), שתי קריאות GET ואפס הודעות, עם מיפוי שגיאות Graph לעברית ואבחנה נפרדת ל"המספר אינו משויך ל-WABA". רשומה ב-`QUEUE_EXPECTED_MAX_MINUTES`, ו-`integrations.ts` הפך ל-`healthCheckAvailable: true`. אומת חי: עבודה ידנית הושלמה ב-2.04 שניות, ללא התראה.
- **ציר ההרשאות** (§0.3), **הרשימה הכפולה** (§0.4), ותקלות הבדיקות ב-Debug Mode.

### ⚠️ תיקון ל-Task 1.3 Step 0 — הצעד החוסם נשען על טענה שגויה

Step 0 מורה להסיר את `last_onboarded_time` מרשימת ה-`fields` **כי בקשתו תפיל את כל הקריאה**, בהסתמך על §0.0 ("ניתן למיון אך לא לקריאה"). **מדוד 2026-09-10 ב-`npm run meta:verify`, אחרי שהשדה נוסף ל-`FIELD_MATRIX`:**

| שדה | v23.0 | v24.0 | v25.0 | v26.0 |
|---|---|---|---|---|
| `quality_rating` | יש ערך | יש ערך | יש ערך | יש ערך |
| `account_mode` · `is_official_business_account` · `throughput` · `status` | יש ערך | יש ערך | יש ערך | יש ערך |
| **`last_onboarded_time`** | **התקבל, ריק** | **התקבל, ריק** | **התקבל, ריק** | **התקבל, ריק** |
| `unified_cert_status` | נדחה | נדחה | נדחה | נדחה |

**הוא מתקבל.** הוא פשוט תמיד ריק כאן — בדיוק כמו `username`. הסיווג "סיכון גבוה" היה שגוי, ובכיוון הבטוח.

**להשאיר אותו מחוץ לרשימה, מסיבה אחרת:** שדה שתמיד ריק הוא רעש, לא כישלון. Step 0 יכול להפסיק להיות **חוסם** ולהפוך להערה. **Step 0b בוצע** — ששת השדות שהוא דורש נוספו ל-`FIELD_MATRIX` ונבדקו חי.

### השלב הבא: Task 0.2

זו הדלת לכל 0.3–0.5: כל עמוד ספק צריך סכמת Zod משלו וזוג `get`/`update` משלו, אחרת שמירה בטופס אחד מאפסת שדות של טופס אחר. היא גם **המשימה היחידה ב-Phase 0 שנוגעת בקוד קיים בלי להוסיף עמוד**, ולכן הסיכון בה גבוה יותר מהשאר — סעיף 8 סיכון 3 (`keepMounted` שהיה load-bearing) מדבר בדיוק עליה.

---

**Goal:** עמוד אחד לכל ספק (Meta/WhatsApp, Voximplant, ExtrA, Resend, Microsoft, SUMIT, Slack) תחת `/admin/integrations`, מודול "מספרים" משותף שמציג כל מספר טלפון מחובר ומאפשר להוסיף/לאמת/לקשר מספרים מהפאנל, והצפה של הנתונים שחסרים היום (בריאות וריאנטים, כיסוי webhooks, תוקף טוקן, גרסת Graph, מדיניות שליחה).

**Architecture:** Server Components שמרכיבים את רכיבי הלקוח הקיימים (מועברים, לא נכתבים מחדש), Server Actions דקים עם Zod, DAL תחת `src/lib/data/admin/integrations/*` עם `requirePlatformPermission`. שתי טבלאות חדשות (`provider_numbers`, `provider_number_roles`) במקום ארבע עמודות בודדות ב-`app_settings`. כל פעולה שעולה כסף או בלתי-הפיכה (רכישת מספר, register/deregister) מאחורי `requirePlatformOwner` + דיאלוג אישור שמציג מחיר/תוצאה + `logActivity` + התראת Slack.

**Tech Stack:** Next.js 16 App Router, shadcn על `@base-ui/react`, Tailwind v4, Supabase (RLS `is_platform_staff()` — §0.3), pg-boss worker, `whatsapp-api-js` 6.2.2, Voximplant Management API דרך `src/lib/voximplant/{core,mutations}.ts`, Zod 4, Vitest 4.

**Spec:** הודעת team-lead 2026-09-08 (המסמך הזה הוא ה-spec המאומת שלה). מסמכים משלימים שהתוכנית מסתמכת עליהם ואינה מחליפה: `docs/whatsapp-import-number-split-plan-2026-09-03.md`, `docs/whatsapp-api-js-capability-audit-2026-09-03.md`, `docs/voximplant/digest-management-api.md`, `docs/voice-agent/production-wiring-audit-2026-07-20.md`.

## תיוג ראיות

| תג | משמעות |
|---|---|
| **MEASURED** | נקרא מקוד הריפו (`file:line`), מה-DB החי (`npx supabase db query --linked`, 2026-09-08), או מ-Meta MCP (`devtools_*`) היום |
| **INFERRED** | מסקנה מהקוד/מהנתונים, לא נמדדה ישירות |
| **DOCS-ONLY (נסבל)** | מתיעוד רשמי, לא אומת חי — **בנתיב Voximplant**. ה-API מחזיר שגיאה ממוקדת על פרמטר לא תקין, כך שטעות עולה סבב אחד |
| **DOCS-ONLY (חוסם)** | מתיעוד רשמי, לא אומת חי — **בנתיב Meta**. §0.0 מדד שני כללים שהופכים את זה למחלקת סיכון אחרת לגמרי: Graph דוחה את **כל** הבקשה על שדה אחד שאינו זמין, ו**השגיאה אינה מצביעה בהכרח על החלק השבור** (מלכודת ה-`"false"` כמחרוזת). כל DOCS-ONLY בנתיב Meta הוא חוסם עד `npm run meta:verify` |

## Global Constraints

- `package.json` הוא מקור האמת (`next 16.x`, `whatsapp-api-js ^6.2.2`, `zod ^4`, `vitest ^4`). אין SDK חדש, אין חבילות חדשות.
- Server Components כברירת מחדל; `"use client"` רק לטפסים/state. Server Actions: Zod → `requirePlatformPermission` → DAL → `FormState`.
- הרשאות: `manage_settings` לעמודי Meta/ExtrA/Resend/Microsoft/SUMIT/Slack ולאינדקס; `manage_voice` לעמוד Voximplant (שני המפתחות קיימים ב-`platform_permission_definitions`, MEASURED). `requirePlatformOwner` (קיים, `src/lib/auth/dal.ts`, בשימוש ב-`/admin/debug`) לכל פעולה שעולה כסף/בלתי-הפיכה. **לא** מוסיפים `manage_integrations` (ראו §3.6).
- סודות: הדפוס הקיים "מוסך + כפתור חשיפה" נשאר (הכרעת בעלים 24.8). ה-Service-Account JSON של Voximplant, טוקן Slack ומפתח ElevenLabs נשארים write-only (presence only) כפי שהם היום. שום סוד לא מגיע ל-client component כ-prop חדש.
- מתגי הכיבוי שומרים על כותב יחיד: `outreach_enabled` נכתב **רק** ב-`updateOutreachMasterSwitchAction` (`src/app/(admin)/admin/channels/actions.ts:147-169`); `voximplant_live_calls` **רק** ב-`updateVoximplantLiveCallsAction`. התוכנית מעבירה את הרכיבים, לא את הבעלות.
- אין רכישה אוטומטית. `AttachPhoneNumber` (Voximplant) ו-`register` (Meta) רצים רק אחרי אישור מפורש בדיאלוג עם המחיר/התוצאה, ורק ע"י Platform Owner.
- ללא שינויי צבע/עיצוב; שימוש בפרימיטיבים הקיימים ב-`src/components/ui/` (Tabs, Accordion, Sheet, AlertDialog, Switch, Table, Badge, Card — כולם קיימים, MEASURED `ls src/components/ui`). פרימיטיב חסר = `npx shadcn@latest add`, לא hand-roll.
- RTL: מאפיינים לוגיים בלבד (`ps-*/pe-*`, `start/end`); מזהים ומספרי טלפון ב-`dir="ltr"`; תאריכים דרך `src/lib/date.ts`.
- מיגרציות: `npx supabase migration new <name>` → `npx supabase db push --linked` (הרצה = אישור בעלים). `types.generated.ts` רק דרך `npm run gen:types`; `npm run deploy` נחסם על drift.
- אין `@ts-ignore`/`as any`/השתקת בדיקות. שערים לכל משימה: `npx tsc --noEmit` · `npm run lint` · `npm test -- --run <file>` · ובסוף כל פאזה `npm run build`.
- אין לוגים של payload/טלפון אורח/טוקן. `phone_number_id`, `phone_id`, E.164 של **מספרי העסק** אינם PII ומותרים בתצוגה ובהתראות.
- הודעות commit בסגנון הריפו (`feat(admin): …`), עם הטריילרים `Co-Authored-By:` ו-`Claude-Session:` **שהסשן הפעיל מכריז עליהם** — אין להעתיק את השמות שהופיעו כאן במקור (`Claude Fable 5.1`, ומזהה סשן מ-8.9): הם נכונים לסשן שכתב את המסמך בלבד, ומאז נכתבו קומיטים בענף הזה תחת ייחוס אחר. commit/deploy רק בהוראת הבעלים.

---

## 0. תקציר והחלטות נדרשות מהבעלים

**מה קורה היום.** הגדרות ספק אחד מפוזרות על 6–7 עמודים: WhatsApp ב-`/admin/channels` (credentials, webhook) + `/admin/templates` (תבניות) + `/admin/webhooks` (inspector) + `/admin/debug` (Integrations panel); Voximplant ב-`/admin/channels` (SA, rule ids, caller id, 4 מתגי persona/consent) + `/admin/voice/platform` (יתרה, wiring, ElevenLabs) + `/admin/settings` › שיחות (11 מתגי console/inbound) + `/admin/voice/queues`; ExtrA ו-SMTP ב-`/admin/settings` › הודעות; SUMIT ב-`/admin/settings` › תשלומים + `/admin/sumit-test`; Slack ב-`/admin/alerts`; Microsoft ב-`/admin/settings` (Exchange) + `/admin/calendar`. פירוט מלא ב-§1.

**מה חסר היום (MEASURED, §2).** אין תצוגה של "המספרים המחוברים": ארבעה שדות בודדים (`whatsapp_phone_number_id`, `voximplant_caller_id`, `extra_sms_sender`, `company_contact_phone`) בלי מספר לתצוגה, בלי איכות/tier, בלי מי משתמש במה. **מספר WhatsApp שני (`1298694319994421`, +972 3-330-1505) כבר קיבל 38 אירועים אמיתיים ל-inbox ואינו מוגדר בשום מקום** — ב-`/admin/webhooks` הוא מוצג כ"לא מוגדר ב-/admin/channels". אותו `03-3301505` הוא גם **הקו הווירטואלי היחיד של ExtrA** (שיחות נכנסות מועברות למכשיר הבעלים, 7 שיחות שלא נענו לא מגיעות ל-KALFA), שולח ה-SMS וטלפון החברה בהסכם — "מספר אחד, ארבעה כובעים". מפתח ה-API של ExtrA פוקע 2027-10-27 ואין לו ניטור; הקוד מממש 1 מתוך 11 operations במפרט הרשמי (§5.3). כל ארבע פרסונות השיחות משתמשות ב-caller id **אחד**. 28 שמות וריאנטים של תבניות (`components.variants/media_variants`) אינם מנוטרים — הסנכרון היומי משווה רק לפי `name+language` של שורת המצביע. האפליקציה מנויה ל-28 שדות webhook (+ topic `catalog` זר) והקוד מטפל ב-6. גרסת Graph מפוזרת (v21/v23/v24, Meta ב-v26). אין בדיקת תוקף לטוקן. `whatsapp_send_policy` ניתן לעריכה רק ב-SQL. `whatsapp-template-health-sync` לא מופיע ב-`QUEUE_EXPECTED_MAX_MINUTES`, ו-`/admin/debug` מכריז "אין בדיקת בריאות" ל-WhatsApp. שלוש תבניות (לא שתיים) עם drift של קטגוריה (`gift`, `thankyou`, `sales_signup_link`: התבקש UTILITY, Meta = MARKETING).

**החלטות נדרשות (ברירת המחדל המומלצת מודגשת):**

| # | החלטה | מומלץ | חלופה |
|---|---|---|---|
| D1 | היכן חיים המספרים | **שתי טבלאות חדשות** `provider_numbers` + `provider_number_roles` (§4). per-persona caller id = שורה לכל תפקיד → חייב טבלה, לא עמודה. | להוסיף 4 עמודות `voximplant_caller_id_<persona>` ל-`app_settings` — לא מכסה DIDs/מספר WA שני/היסטוריה; נדחה. |
| D2 | יחס לתוכנית פיצול מספר הייבוא (3.9) | **התוכנית הזו מספקת את התשתית**: תפקיד `whatsapp_import_sender` בטבלת התפקידים מחליף את שתי העמודות `whatsapp_import_*` שהתוכנית ההיא הציעה (§3.2 שם). הלוגיקה של ניתוב ההודעות (`classifyInboundChannel`) נשארת שם ומקבלת את המזהה מהתפקיד. | להריץ את תוכנית 3.9 כפי שהיא (עמודות) ולהעביר אחר כך — עבודה כפולה. |
| D3 | גרסת Graph אחת | ✅ **בוצע — `v25.0`** (לא v24.0; ראו §0.0). `GRAPH_API_VERSION` (מוכח לשליחה על ה-WABA הזה — `docs/whatsapp-import-number-split-plan-2026-09-03.md` §1.1; פקיעה 2028-02-18 DOCS-ONLY) בקובץ אחד, מוצג בעמוד Meta מול "Meta latest" (v26.0). | לקפוץ ל-v26.0 עכשיו — לא נבדק על ה-WABA; דורש מעבר שדות ב-`statuses` (conversation/pricing שונו ב-v24+). |
| D4 | drift קטגוריה ב-3 תבניות | **כפתור "אשר קטגוריה נוכחית"** שמעדכן `requested_category` ל-MARKETING (מפסיק את האזהרה האדומה + מתיעד). | להגיש מחדש כ-UTILITY — הכרעת whatsapp-meta-expert, לא של הפאנל. |
| D5 | topic `catalog` במנוי ה-webhook | **להציג כ"מנוי זר" ולהציע הסרה** (DELETE subscription) מאחורי אישור; ההסרה עצמה DOCS-ONLY עד אימות ב-ctx7 במשימה 5.4. | להשאיר; לא מזיק (fields ריקים). |
| D6 | מי רשאי לרכוש מספר Voximplant / לבצע register ב-Meta | **Platform Owner בלבד** (`requirePlatformOwner`), אישור מוקלד של המספר, מחיר מוצג. | `manage_voice` — מרחיב חשיפה כספית לכל staff עם ההרשאה. |
| D7 | הפניות מנתיבים ישנים | **redirect 307 (זמני) ב-`next.config.ts`** ל-`/admin/channels`, `/admin/templates`, `/admin/alerts`; `/admin/settings`, `/admin/voice/*`, `/admin/webhooks`, `/admin/company` נשארים (ראו §3.4). | להשאיר את העמודים הישנים חיים במקביל — שני מקורות אמת ל-UI. |
| D8 | `/admin/settings` › תשלומים | **המפתחות של SUMIT עוברים** לעמוד SUMIT; **מתגי הכסף** (`payments_enabled`, `close_charge_enabled`, `campaign_holds_enabled`, `billing_exposure_gate`, תמחור מדורג) **נשארים** ב-`/admin/settings` כי הם מדיניות עסקית, לא חיבור ספק. | להעביר גם את מתגי הכסף — מערבב "האם הספק מחובר" עם "האם אנחנו מחייבים". |
| D9 | שיחות שלא נענו בקו ExtrA (7 היום, לא מגיעות ל-KALFA) → בקשת חזרה + סיכום AI + הקלטה (Phase 6) | **כן, ב-polling** (`getCallsHistory`), אחרי אישור israeli-compliance-advisor; ללא webhook נכנס חדש בשלב זה. | webhook automations של ExtrA — לא מתועד במפרט; דורש משטח ציבורי חדש. |

**מה לא בהיקף:** שינוי לוגיקת שליחה/חיוב, שינוי מתגים/כותבים, פיצול ניתוב הייבוא (תוכנית 3.9), Meta App Review, שינויי צבע, מיגרציה של `message_templates.components` למבנה אחר.

---

## 1. מצב קיים (Inventory)

כל השורות MEASURED מקריאה מלאה של הקבצים המצוינים ומ-`information_schema.columns` החי (2026-09-08).

### 1.1 עמודים → סקציות → שדות → מקור → הרשאה → מי עורך

| עמוד | סקציה | שדות / פעולות | מקור נתונים | הרשאה (DAL) | עורך |
|---|---|---|---|---|---|
| `/admin/channels` (`channels/page.tsx`, `channels-client.tsx`) | מתג פנייה ראשי | `outreach_enabled` | `app_settings` דרך `outreach-master.ts` | `manage_settings` | admin |
| | WhatsApp › פרטי התחברות | `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token` (מוסך), `whatsapp_app_secret` (מוסך), `whatsapp_verify_token` | `channels.ts:25-76` | `manage_settings` | admin |
| | WhatsApp › חיווט Webhook | Callback URL (`/api/webhooks/whatsapp`), Verify Token להעתקה | `getAppUrl` | — | קריאה |
| | WhatsApp › בדיקת חיבור | `GET /{pnid}?fields=display_phone_number,verified_name` (גרסה `WHATSAPP_GRAPH_VERSION \|\| 'v23.0'`) | `channels.ts:83-113` | `manage_settings` | admin |
| | שיחות AI › סטטוס + Live calls | `voximplant_live_calls` (fail-closed על `fullyConfigured`) + Slack security | `voximplant-channel.ts:177-185`; action `actions.ts:177-213` | `manage_voice` | admin |
| | שיחות AI › Meeting-confirm | `voximplant_meeting_confirm_enabled`, `voximplant_meeting_confirm_rule_id` | `voximplant-channel.ts:201-214` | `manage_voice` | admin |
| | שיחות AI › Sales-closing | `voximplant_sales_calls_enabled`, `voximplant_sales_call_rule_id` | `voximplant-channel.ts:216-229` | `manage_voice` | admin |
| | שיחות AI › דרישת הסכמה | `call_consent_required` (אדום; Slack security) | `voximplant-channel.ts:237-245` | `manage_voice` | admin |
| | שיחות AI › פרטי חשבון וחיוג | `voximplant_service_account_json` (write-only), `voximplant_rule_id`, `voximplant_caller_id`, `voximplant_callback_secret` (מוסך) | `voximplant-channel.ts:65-171` | `manage_voice` | admin |
| | שיחות AI › מגבלות ותקציב | `voximplant_low_balance_threshold`, `voximplant_min_call_reserve`, `voximplant_max_concurrent_calls`, `voximplant_max_calls_per_campaign_hour` | שם | `manage_voice` | admin |
| | שיחות AI › כתובות התרחיש | ctx/cb base URLs (קריאה) | `getAppUrl` | — | קריאה |
| | שיחות AI › בדיקת חיבור | `GetAccountInfo` → יתרה | `voximplant-channel.ts:381-396` | `manage_voice` | admin |
| | קטלוג הערוצים | `channels.{display_name,is_built,active,sort_order}` | `channel-catalog.ts` | `manage_settings` | admin |
| `/admin/settings` (`settings/page.tsx`, `settings-form.tsx`) | תשלומים | `payments_enabled`, `close_charge_enabled`, `campaign_holds_enabled`, `billing_exposure_gate`, `sumit_company_id`, `sumit_api_public_key` (מוסך), `sumit_api_key` (מוסך) | `settings.ts:55-190`, schema `validation/admin.ts:417-467` | `manage_settings` | admin |
| | הודעות | `sms_enabled`, `extra_sms_sender`, `extra_sms_token` (מוסך); `email_enabled`, `smtp_host/port/secure/user/password/from` + הצגת `EMAIL_PROVIDER` (env) | שם; `email/sender.ts:80` | `manage_settings` | admin |
| | אוטומציות | `inquiry_followup_enabled`, `agreement_archive_enabled`, `signup_reminder_enabled`, `unconfirmed_cleanup_enabled` | שם | `manage_settings` | admin |
| | שיחות | `console_softphone_enabled`, `console_wake_enabled`, `console_manual_dial_enabled`, `console_consult_conference_enabled`, `handoff_enabled`, `console_dtmf_handoff_enabled`, `monitor_enabled`, `console_widget_enabled`, `console_call_me_now_enabled`, `inbound_calls_enabled` | שם | `manage_settings` | admin |
| | מודל תמחור מדורג | `base_overage_pricing_enabled` (fail-closed על הסכם v4) | `settings.ts:197-207`, `payments.ts` | `manage_settings` | admin |
| | חיבור יומן Exchange | `exchange_connections` (create/test/list/revoke/test-appointment), `exchange_connection_mode` | `exchange-connections.ts`, `settings.ts:280-290` | `manage_settings` (mode) / self-scoped | admin |
| | תצורת תשתית (env) | `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN` — presence | `settings.ts:297-315` | `manage_settings` | קריאה |
| `/admin/company` | זהות החברה | `company_legal_name/_id/_address`, `company_contact_phone`, `company_contact_email`, `privacy_url`, `terms_url`, `warranty_text`, `company_instagram_url` | `settings.ts:227-269`; נקרא ציבורית דרך `company.ts` | `manage_settings` | admin |
| `/admin/templates` | תוכן הפניות | לכל שורת `message_templates`: `name`, `language`, `body`, `active` + תצוגת בריאות (`category/requested_category/quality_score/meta_status/rejected_reason/pending_*`) | `message-templates.ts` | `manage_settings` (היה `requireAdmin` עד 10.9) | admin |
| `/admin/webhooks` | Health strip + רשימה מסוננת + Sheet | `webhook_inbox` (provider/kind/state/date/q), detail: identity, outcome, delivery envelope, reprocess | `webhook-inbox.ts` (service-role תחת `view_webhooks`) | `view_webhooks` (reprocess כלול — היה `requireAdmin`) | admin |
| `/admin/alerts` | חיבור Slack | `slack_bot_token` (write-only, presence), `slack_alert_channel_id`; test; disconnect | `alerts.ts` | `manage_settings` — **גם ה-actions** (חמש פעולות הועברו 10.9; §0.3) | admin |
| | אזכור אישי | `slack_mention_user_id`, `slack_mention_min_level` | שם | | |
| | מתגי התראות | `slack_alerts_enabled` + 5 קטגוריות (`errors`, `send_health`, `campaign_billing`, `security`, `customer_inquiry`) | שם | | |
| | היסטוריה | `ops_alerts` (paginated) | שם | | קריאה |
| `/admin/voice` | tiles + אירועים | יתרה (cache), פעילות שיחות | `voice-ops.ts`, `voice-balance-cache.ts` | `manage_voice` | קריאה |
| `/admin/voice/platform` | יתרה וחיווט | `GetAccountInfo`, מצב `voximplant_account_callback_state`, wire/rollback (`SetAccountInfo` מוגבל) | `voice-ops.ts:479-562`, `voximplant-channel.ts:263-374` | `manage_voice` — **גם ה-actions** (חמש פעולות הועברו 10.9, כולל כתיבת מפתח ElevenLabs; §0.3) | admin |
| | רשימות חיוג / audit / allowlist / log export | `GetCallLists`, `GetAuditLog`, IPs, `runLogExport` | שם | | |
| | צי ElevenLabs | agents.json + API status + quota; `elevenlabs_api_key` (write-only) | `elevenlabs-status.ts` | `manage_voice` (דרך `saveElevenLabsKeyAction`; §0.3) | admin |
| `/admin/voice/queues` | מחלקות | `console_queues.is_active`, `console_agent_queues` | `console-queues.ts` | `manage_voice` | admin |
| `/admin/voice/console` | התחברות SDK (dev) | node/login | `console_me` | `requireUser` (membership) | agent |
| `/admin/debug` (הכוונה ב-brief ל-"ops") | Integrations panel | ElevenLabs, Voximplant, Slack, WhatsApp, SUMIT, ExtrA, GA4 — configured + lastChecked (מ-pg-boss) | `ops/integrations.ts` | `requirePlatformOwner` | קריאה |
| Nav (`admin-shell.tsx:98-180`) | קמפיינים ושליחה / מערכת ותפעול / כלי בדיקה | קישורים ל-channels, templates, settings, alerts, webhooks, voice… | — | — | — |

**הערה:** אין עמוד `/admin/ops` בריפו (MEASURED `find`); הפאנל שה-brief מתייחס אליו הוא `/admin/debug` (`src/app/(admin)/admin/debug/page.tsx`, `_panels.tsx`).

### 1.2 עמודות `app_settings` הרלוונטיות (MEASURED, live)

WhatsApp: `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`, `whatsapp_send_policy jsonb`, `outreach_enabled`. **אין** `whatsapp_app_id`, **אין** `whatsapp_import_*` (תוכנית 3.9 לא יושמה).
Voximplant: `voximplant_service_account_json`, `voximplant_rule_id`, `voximplant_caller_id`, `voximplant_callback_secret`, 4 עמודות תקציב, `voximplant_live_calls`, `voximplant_account_callback_{token_hash,salt,state,prev,wired_at}`, `voximplant_balance_callback_at`, `voximplant_application_id`, `voximplant_call_me_now_rule_id`, `voximplant_meeting_confirm_{enabled,rule_id}`, `voximplant_sales_{calls_enabled,call_rule_id}`, `call_consent_required`, `inbound_ai_answer_enabled`, 10 מתגי console.
ExtrA: `sms_enabled`, `extra_sms_token`, `extra_sms_sender`. SMTP: 6 עמודות. SUMIT: 3. Slack: 9. Company: 9. ElevenLabs: `elevenlabs_api_key`. Exchange: `exchange_connection_mode`.

ערכים חיים (לא סודות, MEASURED): `voximplant_caller_id` מסתיים ב-`9347`; `whatsapp_phone_number_id` מסתיים ב-`8430` (= `1018741517998430`); `extra_sms_sender = '03-3301505'`; `whatsapp_send_policy` **מוגדר** (לא null); rule ids: RSVP `1520915` (OutCallAgent), call-me-now `1523124`, meeting-confirm `1523903`, sales `1523906`; `company_contact_phone` מוגדר.

### 1.3 טבלאות נוספות (MEASURED)

- `channels(key, display_name, is_built, active, sort_order, …)` — 2 שורות (`whatsapp`, `call`). RLS: `channels_admin_all` (ALL) + `channels_auth_read` (SELECT).
- `message_templates` — 9 שורות; `components jsonb` עם מפתחות `variants`, `media_variants`, `media_variant`, `param_contract`, `rsvp_quick_reply`; **28** ערכי וריאנט בסה"כ. RLS `message_templates_admin_all` (authenticated). ⚠️ grants ל-`anon` = ALL (RLS חוסם, אבל היגיינה — §8).
- `webhook_inbox` — לפי `phone_number_id` (provider=whatsapp): `1018741517998430` n=686; **`1298694319994421` n=38 (אחרון 2026-09-07 22:41)**; `123456123` (sandbox) n=9; `<null>` n=9 (אירועי תבניות/security). לפי kind: `whatsapp/status` 642, `message` 91, `template_status` 2, `template_quality` 1, **`security` 3, `business_username_updates` 3** (נשמרים גנרית, לא מטופלים).
- `platform_permission_definitions` — 12 מפתחות; רלוונטיים: `manage_settings` (platform), `manage_voice` (ops), `view_webhooks` (ops).
- `console_queues` — 4 (sales/support/events/billing); `console_agents` — 3, כולם עם `vox_username`.

### 1.4 Voximplant — יישום ותקנות (MEASURED מ-`voxfiles/`)

אפליקציה `kalfa-rsvp` (11107202). Rules (`rules.metadata.config.json`): `incoming` 1494687 pattern `97237219347` → `ConsoleInbound` (919510); `ConsoleInternal`/`ConsoleOut` → `ConsoleDial`; `ConsoleCallMeNow` 1523124; `OutCall` 1494311 → `RSVP`; `OutCallAgent` 1520915 → `RSVPAgent`; `OutCallMeetingConfirm` 1523903; `OutCallSalesClose` 1523906. **INFERRED:** ה-DID היחיד של Voximplant הוא `+972 3-721-9347` (הסיומת `9347` של `voximplant_caller_id` + ה-pattern של rule `incoming` + מספר ה-RSVP של WhatsApp לפי `docs/whatsapp-import-number-split-plan-2026-09-03.md`) — כלומר **אותו מספר** משמש caller id יוצא, DID נכנס ומספר WhatsApp RSVP. `src/lib/voximplant/core.ts:332` כבר עוטף `GetPhoneNumbers` (read-only); אין עטיפה ל-`AttachPhoneNumber`/`BindPhoneNumberToApplication`.

---

## 2. פערים (עם ראיות)

| # | פער | ראיה | תג |
|---|---|---|---|
| G1 | אין תצוגת "מספרים מחוברים" | ארבעה שדות טקסט בודדים: `channels.ts:15`, `voximplant-channel.ts:30`, `settings.ts:23`, `settings.ts:216`. אין `display_phone_number`, `verified_name`, איכות, tier, שיוך לתפקיד. | MEASURED |
| G2 | מספר WhatsApp שני לא מוגדר | `webhook_inbox`: `phone_number_id=1298694319994421` n=38, אחרון 2026-09-07; `webhook-inbox.ts:183-187` מזהה רק את `whatsapp_phone_number_id`; `webhook-detail.tsx:175` מציג "לא מוגדר ב-/admin/channels". המספר = `+972 3-330-1505` = גם `extra_sms_sender` = גם `company_contact_phone` (לפי תוכנית 3.9 §1.1). | MEASURED |
| G3 | caller id אחד לכל הפרסונות | `voximplant-config.ts:97,157` — RSVP, meeting-confirm, sales קוראים את אותו `voximplant_caller_id`; call-me-now (`ConsoleCallMeNow`) — אין caller id נפרד בסכמה. | MEASURED |
| G4 | וריאנטים לא מנוטרים | `template-health-sync.ts:58-65` מתאים `metaTemplates.find(t => t.name === row.name && t.language === row.language)` — רק שם המצביע; 28 וריאנטים ב-`components` לא נבדקים. `fetchTemplateHealth` **כבר מוריד את כל התבניות של ה-WABA** (`template-health.ts:45-69`) — הנתון קיים, לא נשמר. | MEASURED |
| G5 | ✅ **נסגר 9.9** — גרסת Graph מפוזרת (היה) | `channels.ts:89` v23 (fallback), `template-health.ts:16` v23, `whatsapp-import.ts:253` v23, `relocation/meta-templates.ts:34` v23, `relocation/preflight.ts:720` v21, `relocation/external.ts:201` v21, `client.ts` `DEFAULT_API_VERSION` של ה-SDK = v24.0 (`node_modules/whatsapp-api-js/lib/types.js:1`). Meta latest v26.0 (29.7.2026); v21 פוקע 21.1.2027, v23 8.10.2027, v24 18.2.2028. | MEASURED + DOCS-ONLY (changelog) |
| G6 | מנוי webhook רחב, טיפול צר | MCP `devtools_webhook_list`: topic `whatsapp_business_account` עם **28** שדות + topic **`catalog`** (fields ריקים, זר). מטופלים ב-`webhook-processing.ts:78-150`: `message`, `status`, `template_status`, `template_category`, `template_category_misuse`, `template_quality` (6). השאר נשמרים גנרית (`route.ts:106-144`) ומסומנים processed בלי טיפול. | MEASURED |
| G7 | אין בדיקת תוקף טוקן | אין קריאה ל-`debug_token` על `whatsapp_access_token` בשום מקום (grep `debug_token`: רק `relocation/env-validation.ts:238` על טוקן Ads). | MEASURED |
| G8 | סטטוס אפליקציית Meta לא מוצג | MCP `devtools_app basic_settings` (היום): `contact_email_verified: false`, `data_deletion_url: null`, `support_url: null`, `privacy_policy_url: http://www.kalfa.me/en/privacy` (http), `terms_of_service_url: http://www.kalfa.me/terms`, `app_status: dev_mode`, `is_live: false`. Graph API אינו חושף mode/review (זיכרון `meta-devtools-mcp-app-status`). | MEASURED (MCP) |
| G9 | `whatsapp_send_policy` ללא UI | העמודה קיימת ומוגדרת; אין קורא/כותב ב-`src/app/(admin)`; `parseSendPolicy` (`send-policy.ts:79-102`) מספק את הגדרות הבטיחות. | MEASURED |
| G10 | ✅ **נסגר 10.9** — WhatsApp קיבל בדיקת בריאות (`whatsapp-health-check`, שעתי, שתי קריאות GET). היה: template-health-sync לא מנוטר | `QUEUES.templateHealthSync = 'whatsapp-template-health-sync'` (`queue/queues.ts:59`), מתוזמן `35 3 * * *` (`worker/main.ts:1369`); **חסר** ב-`ops/queue-schedule.ts:12-32`; `ops/integrations.ts:81-87` — WhatsApp `healthCheckAvailable: false`. | MEASURED |
| G11 | drift קטגוריה | live: `gift`, `thankyou`, `sales_signup_link` — `requested_category=UTILITY`, `category=MARKETING` (3, לא 2). ה-UI מציג "ירדה בקטגוריה" בלי דרך לאשר/לסגור. | MEASURED |
| G12 | תכלית ה-SMS לא מוצגת; ExtrA ידוע לקוד רק כ-`/sms/send/` | `getSmsSender` נקרא מ-`otp.ts`, `event-cancellation.ts`, `callback-scheduling.ts`, `sls/tool/signup-link/[token]/route.ts` — OTP, SMS ביטול, תזמון חזרה, קישור הרשמה למכירות. ה-sender הוא מספר (`03-3301505`), לא שם. `sender.ts` מממש endpoint אחד מתוך 11 ב-OpenAPI הרשמי (§5.3): אין בדיקת מפתח (`getAuthKey`), אין ניטור תפוגה (המפתח החי פוקע **2027-10-27**, MEASURED team-lead), אין תצוגת קו העסק. | MEASURED |
| G16 | קו ExtrA "חובש ארבעה כובעים" בלי תיעוד | MEASURED (team-lead, קריאות read-only ל-`/auth/key/` ו-`/calls/`, 2026-09-08): החשבון מחזיק **קו וירטואלי אחד** `03-3301505` (`line_type: vn`, `own_type: VNUM`, ללא IVR). 62 שיחות מאז 2025-03: 39 נכנסות מועברות למכשיר פיזי שמסתיים ב-`…3588`, 23 יוצאות מאותו מכשיר דרך ExtrA, **7 `incoming_missed` שלא מגיעות ל-KALFA** בשום צורה. אותו מספר = שולח SMS = מספר WhatsApp ייבוא (`1298694319994421`) = `company_contact_phone`. Verified IDs/מכשירים **אינם חשופים ב-API** (פורטל `/my/verified-ids/` בלבד). | MEASURED + DOCS-ONLY |
| G13 | קטגוריות Slack לפי ספק לא ממופות | `send_health` נפלט מ-`whatsapp`, `sms`, `sumit`, `whatsapp-template-*`; `security` מ-`voximplant-*-toggle`, `call-consent-toggle`, `admin-voice`; אין תצוגה "מה יישלח לספק X". | MEASURED |
| G14 | DIDs נכנסים של Voximplant רק בפלטפורמה | rule `incoming` pattern `97237219347` ב-`rules.config.json`; אין קריאה ל-`getPhoneNumbers` מהפאנל (grep: מוגדר ב-`core.ts:332`, לא בשימוש ב-`src/app`). | MEASURED |
| G15 | `security`/`business_username_updates` בלי label | `labels.ts:205+` — אין תוויות ל-kinds הגנריים; מוצגים בשם הגולמי. | MEASURED |

---

## 3. ארכיטקטורת יעד

### 3.1 מפת ניווט (IA)

```
/admin/integrations                       אינדקס: כרטיס-סטטוס לכל ספק (מוגדר? חי? בדיקה אחרונה? מספרים?)
/admin/integrations/meta-whatsapp         Meta / WhatsApp Cloud API
/admin/integrations/meta-whatsapp             ↳ סקציית "בריאות התבניות" בתוך עמוד Meta (לא עמוד נפרד)
/admin/integrations/voximplant            Voximplant (שיחות AI + מוקד)
/admin/integrations/extra-sms             ExtrA SMS
/admin/integrations/resend-email          Resend / SMTP
/admin/integrations/microsoft             Microsoft Graph / Exchange
/admin/integrations/sumit                 SUMIT / OfficeGuy
/admin/integrations/slack                 Slack (התראות תפעול; מחליף /admin/alerts)
/admin/integrations/numbers               מודול המספרים המאוחד (כל הספקים)
```

Nav: פריט אחד **"אינטגרציות"** (`Plug` מ-lucide) במקום `ערוצי תקשורת`, `תבניות פנייה` ו-`התראות תפעול`. **תיקון (מדוד 10.9, `admin-shell.tsx:128-144`):** שלושת הפריטים אינם באותה קבוצה — `ערוצי תקשורת` ו-`תבניות פנייה` יושבים ב**"קמפיינים ושליחה"**, ורק `התראות תפעול` ב"מערכת ותפעול". ההסרה נוגעת אפוא בשתי קבוצות, ויש להכריע לאיזו מהן נכנס הפריט החדש. **בנוסף:** `/admin/workflows` ("תהליכי אוטומציה") נוסף לקבוצת "קמפיינים ושליחה" מאז כתיבת התוכנית ואינו מוזכר בה כלל — הוא אינו עמוד ספק ואינו בהיקף, אך יש לוודא שהוא אינו נמחק או מוסתר בשינוי ה-nav. `הגדרות`, `יומן Exchange`, `בדיקת Webhooks`, `בדיקת SUMIT`, `מוקד שיחות AI` נשארים.

### 3.2 תבנית עמוד ספק (wireframe)

כל עמוד ספק = Server Component שמרכיב:

1. **כרטיס סטטוס** — Badge (מוגדר/פעיל/כבוי), "בדיקה אחרונה" (מ-pg-boss `lastCompletedOn` או מה-DAL), כפתור "בדיקת חיבור" (ה-actions הקיימים).
2. **מספרים/נכסים** — טבלת המספרים של הספק מתוך `provider_numbers` (Phase 1), עם התפקידים (`provider_number_roles`), snapshot מהספק (איכות/tier/verification/renewal), כפתור "סנכרן מהספק" ו-"הוסף מספר" (Phase 2/3).
3. **פרטי התחברות** — הטופס הקיים (מועבר), מוסך+חשיפה, write-only היכן שכבר כך.
4. **Webhooks** — Callback URL + verify token (Meta), wiring state (Voximplant), קישור ל-`/admin/webhooks?provider=<x>`; ב-Meta: טבלת "שדות מנויים ↔ מטופלים" (Phase 5).
5. **תבניות / פרסונות** — Meta: קישור לעמוד התבניות + סיכום בריאות; Voximplant: ארבע הפרסונות (RSVP/meeting-confirm/sales/call-me-now) עם rule id, caller id (Phase 4), מתג.
6. **בריאות ומשימות** — תורי pg-boss הרלוונטיים לספק + התראות Slack מה-30 יום האחרונים (`ops_alerts` לפי `source`).
7. **אזור מסוכן** — מתגי כיבוי (בכותב הקיים), ניתוק, deregister/deactivate (Owner).

### 3.3 מיפוי "מה עובר לאן"

| היום | יעד | מה משתנה בקוד |
|---|---|---|
| `/admin/channels` › מתג פנייה ראשי | `/admin/integrations` (כרטיס עליון) **וגם** בראש עמוד Meta ו-Voximplant (אותו רכיב `OutreachMasterSwitch`, אותו action) | העברת קומפוננטה; `revalidatePath` מתעדכן לנתיבים החדשים |
| `/admin/channels` › WhatsApp | `/admin/integrations/meta-whatsapp` › פרטי התחברות + Webhooks | פיצול `channels-client.tsx` ל-`whatsapp-credentials-form.tsx`, `whatsapp-webhook-card.tsx` |
| `/admin/channels` › שיחות AI | `/admin/integrations/voximplant` › פרטי התחברות, פרסונות, אזור מסוכן | פיצול ל-`voximplant-credentials-form.tsx`, `voximplant-personas.tsx`, `voximplant-danger-zone.tsx` |
| `/admin/channels` › קטלוג הערוצים | `/admin/integrations` › סקציה "קטלוג ערוצים" (תחתית) | העברה כפי שהוא |
| `/admin/templates` | **נשאר** (ראו ההכרעה בסוף §3.3); עמוד Meta מקבל סקציית *בריאות* בלבד + קישור | הבריאות (drift, quality, status, וריאנטים, כפתור "אשר קטגוריה") עוברת ל-Meta; טופס התוכן נשאר |
| `/admin/alerts` | `/admin/integrations/slack` | העברה כפי שהוא |
| `/admin/settings` › הודעות (ExtrA) | `/admin/integrations/extra-sms` | schema נפרד `extraSmsSchema`; טופס נפרד |
| `/admin/settings` › הודעות (SMTP/Resend) | `/admin/integrations/resend-email` | schema נפרד `emailTransportSchema`; טופס נפרד; שורת סטטוס `EMAIL_PROVIDER` |
| `/admin/settings` › תשלומים (3 מפתחות SUMIT) | `/admin/integrations/sumit` | schema נפרד `sumitCredentialsSchema`; מתגי הכסף נשארים ב-settings (D8) |
| `/admin/settings` › Exchange | `/admin/integrations/microsoft` | העברת `ExchangeManager` + `ExchangeModeToggle`; `/admin/calendar` נשאר |
| `/admin/settings` › שיחות (10 מתגי console) | **נשאר** ב-settings (מדיניות מוקד, לא חיבור); עמוד Voximplant מקשר אליו | ללא שינוי |
| `/admin/voice/platform` | **נשאר** (תפעול מוקד); עמוד Voximplant מציג יתרה+wiring בכרטיס הסטטוס ומקשר | שימוש חוזר ב-`getVoicePlatformView` |
| `/admin/webhooks` | **נשאר** (inspector חוצה-ספקים) | Phase 1: "המספר העסקי שקיבל" נפתר מול `provider_numbers` במקום עמודה אחת |
| `/admin/debug` › Integrations | **נשאר**; מקבל WhatsApp health check (G10) | `integrations.ts` |
| `/admin/company` | **נשאר** (חוזה/משפטי); `company_contact_phone` מוצג במודול המספרים כתפקיד `company_contact` (קריאה בלבד, עריכה ב-company) | ללא שינוי בטופס |

**הכרעה 2026-09-10 — עמוד התבניות נשאר, והבריאות היא זו שעוברת.**

הטיוטה הראשונה העבירה את `/admin/templates` כמקשה אחת ל-`meta-whatsapp/templates`. סקירה מדדה מה יש בטבלה בפועל:

| | מדוד 10.9 |
|---|---|
| שורות `channel='whatsapp'` | **8**, כולן `active`, עם שם Meta, קטגוריה וסנכרון בריאות |
| שורות `channel='call'` | **1** — `call_1`, `name=''`, **`active=false`**, בלי components/קטגוריה |
| קוד שמבקש את `call_1` | **אפס אזכורים**. וגם אם היה — `getTemplateByKey` מסנן `.eq('active', true)` |
| היכן באמת יושב תסריט שיחת ה-AI | `agent_configs/*.json` מול ElevenLabs — מקור אמת מתועד שאסור לערוך ביד |

כלומר תמיכת שני-הערוצים בעמוד (`isCall ? null : <TemplateHealth/>`, המיון לפי `channel`, נוסח הפסקה) היא **כוונת תכנון שלא מומשה** — הערוץ השני נזרע ונזנח כשהתשובה התבררה כ-ElevenLabs.

**מה שכן נכון:** הטבלה מחזיקה **שני סוגי מידע**, ורק אחד מהם שייך לעמוד ספק —

- **תוכן** (מה אומרים לאורח): עריכה שוטפת, תדירה, של מי שכותב. **נשאר** `/admin/templates` בקבוצת "קמפיינים ושליחה". מי שכותב הודעה לאורחים לא צריך להיכנס לעמוד תצורה של ספק.
- **בריאות מול מטא** (`category`/`requested_category`, `quality_score`, `meta_status`, `rejected_reason`, ניטור וריאנטים, כפתור "אשר קטגוריה"): קריאה בלבד, ספציפי לוואטסאפ, מסונכרן ע"י worker. **עובר** לסקציה בעמוד Meta, ליד הטוקן והמספרים.

**`call_1` — לסגור.** שורה ריקה וכבויה שגרמה לסוקר זהיר להסיק שהעמוד חוצה-ערוצים. מומלץ למחוק אותה ולהסיר את ענפי `isCall`, ולשים בטקסט העמוד מצביע ל-ElevenLabs. **שינוי נתונים בייצור — דורש אישור בעלים.**

**ולעתיד, וזו הסיבה העיקרית להשאיר את עמוד התוכן עצמאי:** תוכן ה-SMS **קשיח היום ב-TypeScript** — `src/lib/data/otp.ts:60` מחזיק `` `קוד האימות שלך ל-KALFA: ${code}` `` בתוך הקוד, וכך גם ביטול אירוע ותזמון חזרה. אם התוכן הזה יעבור ל-DB — וכנראה שכן, כי מחרוזת עברית בקוד דורשת פריסה כדי לשנות — העמוד יהפוך לחוצה-ערוצים **באמת**, ואז הבית שלו כבר קיים.

### 3.4 redirects

`next.config.ts` אין היום `redirects()` (MEASURED grep). מוסיפים:

```ts
async redirects() {
  return [
    { source: '/admin/channels', destination: '/admin/integrations/meta-whatsapp', permanent: false },
    { source: '/admin/alerts', destination: '/admin/integrations/slack', permanent: false },
    // אין redirect ל-/admin/templates — הוא נשאר עמוד תוכן עצמאי.
  ];
},
```

`(admin)/channels/**` ו-`(admin)/alerts/**` נמחקים (Task 0.6 Step 4b) כדי שלא יהיו שני מקורות UI. **`(admin)/templates/**` אינו נמחק** — ראו ההכרעה בסוף §3.3. כל `revalidatePath('/admin/channels')` / `'/admin/alerts'` מוחלף לנתיב החדש (grep מלא במשימה).

### 3.5 מודול המספרים

`/admin/integrations/numbers` — טבלה אחת: מספר (E.164, `dir="ltr"`) · ספק · מזהה ספק · תפקידים (chips) · סטטוס ספק (snapshot) · סונכרן · פעולות. אותו מספר E.164 יכול להופיע בכמה שורות (ספק שונה) — זה **המצב האמיתי** (G2, §1.4). קיבוץ ויזואלי לפי E.164 עם `rowspan` לא נדרש; מסננים לפי ספק.

### 3.6 הרשאות

- **אינדקס `/admin/integrations`: `requirePlatformStaff()` בלבד** (`requireAdmin` פרשה — §0.3), ולכל כרטיס `hasPlatformPermission(<key>)` שקובע אם הוא לחיץ או מוצג כ"אין הרשאה". **לא** `requirePlatformPermission('manage_settings')` על העמוד עצמו: הוא **מפנה ל-`/app`** ואינו מציג הודעה, כך שאיש תפעול עם `manage_voice` בלבד — קהל היעד של עמוד Voximplant — יועף מהפאנל ברגע שילחץ על פריט התפריט. עמודי Meta/ExtrA/Resend/Microsoft/SUMIT/Slack נשארים מגודרים `manage_settings` כפי שנכתב.
- Voximplant: `manage_voice` (כמו היום). מודול המספרים: קריאה `manage_settings`; כתיבת שורות Voximplant `manage_voice`, שורות Meta/ExtrA `manage_settings`.
- רכישה (`AttachPhoneNumber`), `DeactivatePhoneNumber`, `register`/`deregister`, הסרת מנוי webhook: `requirePlatformOwner` (D6).
- `manage_integrations` חדש — **לא**. שני המפתחות הקיימים כבר מבחינים בין "הגדרות מערכת" ל"מוקד"; מפתח שלישי היה מייצר מטריצת הרשאות בלי צורך מוכח. אם הבעלים ירצה staff שרואה סטטוס בלי לערוך — זה מפתח `view_integrations` נפרד ולא בהיקף.

---

## 4. מודל נתונים ומיגרציה

### 4.1 החלטה: טבלאות, לא עמודות

per-persona caller id = 4 תפקידים (RSVP, meeting-confirm, sales, call-me-now) + DID נכנס + שני מספרי WhatsApp (RSVP, ייבוא) + SMS sender + קו העסק הנכנס (`business_line_inbound`, §5.3) + טלפון החברה = **10 תפקידים על ≥3 מספרים פיזיים משלושה ספקים** (מתוכם 9 משויכים כבר ב-backfill; `whatsapp_import_sender` מחכה ל-`syncMetaNumbers`). `app_settings` הוא singleton — כל תפקיד היה עמודה, וכל snapshot מהספק עוד עמודות. טבלה עם שורה למספר ושורה לתפקיד היא המודל הטבעי, ומאפשרת היסטוריה (`created_at`, `source`) ו-snapshot לכל מספר.

### 4.2 SQL (מיגרציה `provider_numbers_and_roles`)

```sql
-- =====================================================================
-- provider_numbers + provider_number_roles
--
-- provider_numbers: every business phone number / sender identity KALFA holds at a
-- provider, one row per (provider, provider_ref). The same E.164 may legitimately
-- appear under several providers (VERIFIED-LIVE 2026-09-10: the backfill below
-- produces +972 3-330-1505 twice — once as the ExtrA line, once as the company
-- contact phone). Snapshot = non-secret provider status fields (quality, tier,
-- verification, renewal…), never a token.
--
-- Grouping by E.164 in the numbers module (§3.5) on day one: the ExtrA row and the
-- company row both normalize to +97233301505 below, so they group immediately. The
-- meta_whatsapp row is the ONE row this backfill deliberately leaves with e164 = null
-- — display_phone_number comes from the first syncMetaNumbers() call (Task 1.3
-- Step 3) and is not guessed here, so the Meta numbers join their groups only after
-- that sync. VERIFIED-LIVE 2026-09-10 (simulated syncs, same rolled-back txn): after
-- syncMetaNumbers + syncVoximplantNumbers the groups are +97233301505 ×3
-- (ExtrA line, company contact, WhatsApp import number 1298694319994421) and
-- +97237219347 ×2 (Voximplant DID/caller id, WhatsApp RSVP sender) — the "מספר אחד,
-- ארבעה כובעים" view of §5.3-3.
--
-- Access model mirrors channels_admin_all (20260726111038): admin writes go through
-- the cookie client (authenticated + platform staff); the worker/runtime reads via
-- service_role, which keeps the schema-default ALL grant (VERIFIED-LIVE: the ACL
-- this file produces is byte-identical to channels' —
-- {postgres=arwdDxtm,service_role=arwdDxtm,authenticated=arwd}).
-- ⚠️ THE PREDICATE CHANGED 2026-09-10 (evening) — see §0.3. It was
-- has_role(uid,'admin') on user_roles; migration 20260910090301 moved all 21 existing
-- policies to is_platform_staff() and left ZERO on has_role. Creating these two tables
-- on the retired axis would put it straight back into a database just cleaned of it.
-- is_platform_staff() VERIFIED-LIVE: SECURITY DEFINER, STABLE, search_path=public,
-- returns boolean — the same shape has_role had, and the two sets are identical
-- today, so the swap is semantically a no-op on day one.
-- public.set_updated_at() VERIFIED-LIVE: trigger fn, sets new.updated_at = now().
-- Policies use the post-audit initplan-wrapped form so auth is evaluated once per
-- statement, not per row.
--
-- VERIFIED-LIVE 2026-09-10 — this file was executed inside `begin; … rollback;`
-- against the linked project (precedent 20260822114850). Result inside the txn:
--   provider_numbers = 4 rows, provider_number_roles = 9 rows (NOT 7);
--   re-running the whole backfill block a second time in the same txn left it at
--   4 / 9; authenticated+admin sees 4 rows, authenticated non-admin sees 0,
--   non-admin INSERT = 42501, anon SELECT = 42501; both updated_at triggers fire.
--
-- ROLLBACK (at the bottom of this file as well): drop the roles table first (FK).
-- =====================================================================
create table if not exists public.provider_numbers (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null
                constraint provider_numbers_provider_chk
                check (provider in ('meta_whatsapp','voximplant','extra_sms','company')),
  provider_ref  text,                              -- Meta phone_number_id / Voximplant phone_id / ExtrA sender / 'contact'
  e164          text
                constraint provider_numbers_e164_chk
                check (e164 is null or e164 ~ '^\+[1-9][0-9]{6,14}$'),
  display_label text,                              -- admin-facing label ("מספר RSVP", "מספר ייבוא")
  is_active     boolean not null default true,
  snapshot      jsonb,                             -- provider status fields only. DELIBERATELY untyped:
                                                   -- the one open surface here, so a provider adding a
                                                   -- status field needs no migration. Do not "improve" it
                                                   -- into a rigid type. NEVER a token, PIN or app secret —
                                                   -- it is written straight from a provider response.
  snapshot_at   timestamptz,
  source        text not null default 'admin'
                constraint provider_numbers_source_chk check (source in ('admin','backfill','sync')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint provider_numbers_ref_or_e164 check (provider_ref is not null or e164 is not null)
);
create unique index if not exists provider_numbers_provider_ref_uq
  on public.provider_numbers (provider, provider_ref) where provider_ref is not null;
-- FIX 2026-09-10 (bug 2): the Voximplant backfill row carries provider_ref = null, so
-- the partial index above does not cover it — `on conflict do nothing` had no arbiter
-- for that row and a second execution inserted a DUPLICATE Voximplant number. This
-- second partial index makes "at most one backfill row per provider" a real DB
-- invariant, which is also exactly the assumption the role backfill's
-- `source='backfill'` join makes (bug 3): with it, that join can never match two rows.
-- Known interaction, documented rather than designed around: Phase 1.3 upserts the
-- synced row with source='sync', which moves it out of this index's scope; a backfill
-- re-run after that point could insert a fresh 'backfill' row, and
-- `on conflict (role) do nothing` would keep the OLD role pointer. Migrations do not
-- re-run, so this only matters if someone replays the block by hand.
create unique index if not exists provider_numbers_backfill_uq
  on public.provider_numbers (provider) where source = 'backfill';
create index if not exists provider_numbers_e164_idx on public.provider_numbers (e164);

comment on table public.provider_numbers is
  'Business phone numbers / sender identities per provider. Replaces the four single fields on app_settings (whatsapp_phone_number_id, voximplant_caller_id, extra_sms_sender, company_contact_phone) which stay as read-fallbacks until the cleanup migration. Snapshot holds non-secret provider status only.';

-- provider_number_roles: exactly ONE number per role (role is the PK); a number may
-- hold many roles. The runtime resolvers read this first and fall back to the legacy
-- app_settings column while the backfill is verified.
create table if not exists public.provider_number_roles (
  role       text primary key
             constraint provider_number_roles_role_chk
             check (role in (
               'whatsapp_rsvp_sender','whatsapp_import_sender',
               'voice_caller_id_rsvp','voice_caller_id_meeting_confirm',
               'voice_caller_id_sales','voice_caller_id_call_me_now',
               'voice_inbound_did','sms_sender','company_contact','business_line_inbound')),
  number_id  uuid not null references public.provider_numbers(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create index if not exists provider_number_roles_number_idx on public.provider_number_roles (number_id);

comment on table public.provider_number_roles is
  'Which provider_numbers row serves which runtime role. One row per role. Voice caller ids are per persona (RSVP / meeting-confirm / sales / call-me-now) — the four personas shared app_settings.voximplant_caller_id before this table. business_line_inbound = the ExtrA virtual line that forwards inbound calls to the owner''s device (display/ops role, no runtime reader).';

drop trigger if exists provider_numbers_set_updated_at on public.provider_numbers;
create trigger provider_numbers_set_updated_at
  before update on public.provider_numbers
  for each row execute function public.set_updated_at();
drop trigger if exists provider_number_roles_set_updated_at on public.provider_number_roles;
create trigger provider_number_roles_set_updated_at
  before update on public.provider_number_roles
  for each row execute function public.set_updated_at();

-- RLS: mirrors channels_admin_all (20260726111038), with `to authenticated` added —
-- the app_settings_admin_all form (VERIFIED-LIVE: polroles = {authenticated}). anon
-- has every privilege revoked, so it never reaches policy evaluation at all.
alter table public.provider_numbers enable row level security;
alter table public.provider_number_roles enable row level security;
revoke all on public.provider_numbers from anon, authenticated;
revoke all on public.provider_number_roles from anon, authenticated;
grant select, insert, update, delete on public.provider_numbers to authenticated;
grant select, insert, update, delete on public.provider_number_roles to authenticated;

drop policy if exists provider_numbers_admin_all on public.provider_numbers;
create policy provider_numbers_admin_all on public.provider_numbers for all
  to authenticated
  using ((select public.is_platform_staff()))
  with check ((select public.is_platform_staff()));
drop policy if exists provider_number_roles_admin_all on public.provider_number_roles;
create policy provider_number_roles_admin_all on public.provider_number_roles for all
  to authenticated
  using ((select public.is_platform_staff()))
  with check ((select public.is_platform_staff()));

-- Backfill from the four legacy fields. Idempotent: every insert has an arbiter index
-- (see provider_numbers_backfill_uq above) — re-running the block leaves 4 / 9 rows.
--
-- E.164 normalization is a ONE-TIME expression over the four values measured
-- 2026-09-10, not a runtime rule and not a country assumption for new numbers
-- (the admin form validates E.164 in Zod):
--   whatsapp_phone_number_id = '1018741517998430'  (a Meta id, not a phone number)
--   voximplant_caller_id     = '97237219347'       (11 digits, NO '+')
--   extra_sms_sender         = '03-3301505'        (Israeli local, punctuated)
--   company_contact_phone    = '033301505'         (Israeli local, digits only)
-- Digits-only with a country code get a '+'; a leading '0' is the Israeli local form
-- of the two lines this account actually holds; anything else stays null, the screen
-- says "השלימו E.164", and the Phase 1.3 sync fills it.
insert into public.provider_numbers (provider, provider_ref, display_label, source)
select 'meta_whatsapp', whatsapp_phone_number_id, 'מספר אישורי הגעה (RSVP)', 'backfill'
  from public.app_settings where whatsapp_phone_number_id is not null
on conflict do nothing;

-- FIX 2026-09-10 (bug 1 — this is the one that aborted the whole migration).
-- MEASURED: voximplant_caller_id = '97237219347', so the original
-- `case when … ~ '^\+…' then … else null end` wrote e164 = null on a row whose
-- provider_ref is also null, and provider_numbers_ref_or_e164 raised
--   ERROR: 23514 new row for relation "provider_numbers" violates check constraint
--          "provider_numbers_ref_or_e164"
-- (reproduced verbatim in a begin/rollback dry run). Two changes: normalize
-- digits → '+digits', and only insert when the result IS a valid E.164 — Phase 1.3
-- Step 4 merges this row BY E.164, so a null-e164 row would also be unmergeable and
-- would strand its four voice roles on a number the sync can never complete. If the
-- value is ever unnormalizable, no row is created, no voice role is assigned, and the
-- resolvers keep falling back to app_settings.voximplant_caller_id (fail-safe).
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'voximplant', null, '+' || d.digits, 'מספר יוצא (Caller ID)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.voximplant_caller_id,''), '[^0-9]', '', 'g') as digits) d
 where s.voximplant_caller_id is not null
   and d.digits ~ '^[1-9][0-9]{6,14}$'
on conflict do nothing;

-- ExtrA: provider_ref = the verified sender id string as stored today ('03-3301505').
-- The e164 CASE is SEPARABLE from the fix above — the insert cannot fail without it
-- (provider_ref is not null). It is here because §3.5 and §5.3-3 group the numbers
-- module by E.164, and MEASURED both this line and company_contact_phone normalize to
-- +97233301505 — that is what makes "מספר אחד, ארבעה כובעים" render on day one
-- instead of after the first Phase 1.3 sync.
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'extra_sms', s.extra_sms_sender,
       case when d.digits ~ '^0[1-9][0-9]{6,12}$' then '+972' || substring(d.digits from 2)
            when d.digits ~ '^[1-9][0-9]{6,14}$'  then '+' || d.digits
            else null end,
       'קו העסק / שולח SMS (ExtrA)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.extra_sms_sender,''), '[^0-9]', '', 'g') as digits) d
 where s.extra_sms_sender is not null
on conflict do nothing;

-- Company: same separable normalization; provider_ref stays the literal 'contact'
-- (this row is a pointer to the agreement field, edited in /admin/company).
insert into public.provider_numbers (provider, provider_ref, e164, display_label, source)
select 'company', 'contact',
       case when d.digits ~ '^0[1-9][0-9]{6,12}$' then '+972' || substring(d.digits from 2)
            when d.digits ~ '^[1-9][0-9]{6,14}$'  then '+' || d.digits
            else null end,
       'טלפון החברה (הסכם)', 'backfill'
  from public.app_settings s
  cross join lateral (select regexp_replace(coalesce(s.company_contact_phone,''), '[^0-9]', '', 'g') as digits) d
 where s.company_contact_phone is not null
on conflict do nothing;

-- 9 roles, not 7. Each branch matches at most one row thanks to
-- provider_numbers_backfill_uq; a provider whose backfill row was not created simply
-- contributes no role, and its resolver keeps the legacy fallback.
-- voice_inbound_did is assigned here and not left to Phase 3, because §0.0 Q3 measured
-- that the account holds exactly ONE DID — 97237219347, phone_id 2303422 — and it is
-- the very number this backfill just inserted as the caller id. The role is
-- descriptive (nothing dials "the inbound DID"; Voximplant routes by rule pattern), so
-- assigning it cannot break a runtime reader, and if a second DID is ever bought the
-- Phase 3 UI repoints the role with a one-row UPDATE.
insert into public.provider_number_roles (role, number_id)
select 'whatsapp_rsvp_sender', id from public.provider_numbers where provider='meta_whatsapp' and source='backfill'
union all select 'voice_caller_id_rsvp', id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_inbound_did', id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_meeting_confirm', id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_sales', id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'voice_caller_id_call_me_now', id from public.provider_numbers where provider='voximplant' and source='backfill'
union all select 'sms_sender', id from public.provider_numbers where provider='extra_sms' and source='backfill'
union all select 'business_line_inbound', id from public.provider_numbers where provider='extra_sms' and source='backfill'
union all select 'company_contact', id from public.provider_numbers where provider='company' and source='backfill'
on conflict (role) do nothing;

-- ROLLBACK:
--   drop table public.provider_number_roles; drop table public.provider_numbers;
-- (roles first — the FK is `on delete restrict`. Indexes, triggers and policies drop
-- with their tables.) Legacy app_settings columns are untouched by this migration, so
-- rollback restores the exact pre-migration runtime (resolvers fall back to the
-- columns).
```

**מצב הדריסה היבשה (VERIFIED-LIVE 2026-09-10).** הבלוק לעיל הורץ במלואו בתוך `begin; … rollback;` מול הפרויקט המקושר (תקדים `20260822114850`). התוצאה בתוך הטרנזקציה:

| בדיקה | תוצאה |
|---|---|
| `provider_numbers` | 4 שורות: `meta_whatsapp/1018741517998430` (e164 null — ממולא בסנכרון Meta), `voximplant/+97237219347`, `extra_sms/03-3301505/+97233301505`, `company/contact/+97233301505` |
| `provider_number_roles` | **9** שורות (לא 7 — Task 1.1 Step 2 עדיין כתוב 7; `voice_inbound_did` נוסף 10.9) |
| הרצה שנייה של כל בלוק ה-backfill באותה טרנזקציה | נשאר 4 / 9 |
| `authenticated` + admin | רואה 4 שורות |
| `authenticated` שאינו admin | 0 שורות; `insert` → `42501` |
| `anon` | `select` → `42501` (ה-grants נשללו) |
| ACL של שתי הטבלאות | זהה ל-`channels`: `{postgres=arwdDxtm, service_role=arwdDxtm, authenticated=arwd}` |
| שני טריגרי `updated_at` | דרסו `updated_at` שנשתל כ-2000-01-01 → הטריגר מחווט |

**אזהרת מחיקה:** `provider_number_roles.number_id` הוא `on delete restrict`. מחיקת מספר שמחזיק תפקיד תיכשל בשגיאת foreign key — **ה-DAL חייב לתפוס אותה** ולהחזיר "לא ניתן למחוק מספר המשויך לתפקיד; הסירו את השיוך תחילה", ולא להעביר את הודעת Postgres למשתמש (Global Constraint: אין לחשוף פרטי DB).

**הערות למיגרציה:** ה-Voximplant `phone_id` (מספרי) לא ידוע בזמן ה-backfill — ממולא ב-Phase 3 מסנכרון `GetPhoneNumbers` (התאמה לפי E.164 → `provider_ref = phone_id`); לכן ה-`e164` של אותה שורה חייב להיות מלא כבר עכשיו, וזה מה שה-fix מבטיח. שורת ה-WhatsApp נשארת בלי `e164` בכוונה — `display_phone_number` מגיע מהסנכרון הראשון מול Meta ולא מנוחש כאן.

### 4.3 טבלת בריאות וריאנטים (Phase 5)

```sql
-- message_template_variant_health: one row per Meta template name we actually send —
-- the pointer row's own name plus every name hiding in message_templates.components
-- (variants / media_variants / media_variant). VERIFIED-LIVE 2026-09-10:
-- message_templates.id is a uuid PRIMARY KEY, so the FK below resolves; the table has
-- 9 rows and 28 variant names.
-- Read = admin (cookie client). Writes = worker only: service_role keeps the
-- schema-default ALL grant and bypasses RLS, while `authenticated` gets SELECT and
-- nothing else — VERIFIED-LIVE in the dry run, an admin INSERT is rejected 42501.
create table if not exists public.message_template_variant_health (
  template_id     uuid not null references public.message_templates(id) on delete cascade,
  variant_name    text not null,           -- the Meta template name (pointer name or a components.* variant)
  language        text not null,
  variant_kind    text not null check (variant_kind in ('pointer','variants','media_variants','media_variant')),
  event_type      text,                    -- key inside components.variants / media_variants; null for pointer/media_variant
  meta_template_id text,
  category        text,
  quality_score   text,
  meta_status     text,
  rejected_reason text,
  last_synced_at  timestamptz not null default now(),
  primary key (template_id, variant_name, language)
);
alter table public.message_template_variant_health enable row level security;
revoke all on public.message_template_variant_health from anon, authenticated;
grant select on public.message_template_variant_health to authenticated;
drop policy if exists mtvh_admin_select on public.message_template_variant_health;
create policy mtvh_admin_select on public.message_template_variant_health for select
  to authenticated
  using ((select public.is_platform_staff()));
-- writes: worker only (service_role). The sync must set last_synced_at explicitly in
-- the upsert — the default only applies on INSERT.
-- No index beyond the PK: listVariantHealth(templateId) is a prefix scan of it.
-- ROLLBACK: drop table public.message_template_variant_health;
```

**דריסה יבשה (VERIFIED-LIVE 2026-09-10):** רץ באותה טרנזקציה עם §4.2 והוחזר לאחור. ה-FK, ה-PK וה-CHECK נוצרו כמצופה; ACL = `{postgres=arwdDxtm, service_role=arwdDxtm, authenticated=r}`; `anon` → `42501`; admin `insert` → `42501` (רק ה-worker כותב).

### 4.4 עמודה חדשה ב-`app_settings`: `whatsapp_app_id text` (Phase 5)

נדרשת ל-`GET /{app-id}/subscriptions` ול-`debug_token` (app access token = `APP_ID|APP_SECRET`; DOCS-ONLY ctx7 `/websites/developers_facebook_graph-api` "app access token or an app developer's user access token… is required"). לא סוד. נכתבת בטופס Meta › פרטי התחברות.

```sql
-- app_settings is a singleton settings row with admin-only RLS
-- (app_settings_admin_all, to authenticated — on is_platform_staff() since 20260910090301,
-- one of the 21 policies that migration converted) — adding a column does
-- not touch it. VERIFIED-LIVE 2026-09-10: app_settings has TABLE-level grants only
-- (authenticated=rw, service_role=arwdDxtm) and zero column-level ACLs, so the new
-- column inherits SELECT/UPDATE — no 42501 of the show_meal_pref kind. No CHECK: the
-- Meta app id is validated in Zod (^\d{10,20}$) at the form boundary, like every other
-- credential column here.
alter table public.app_settings add column if not exists whatsapp_app_id text;

comment on column public.app_settings.whatsapp_app_id is
  'Meta app id (numeric string, NOT a secret) for the WhatsApp app. Needed to build the app access token "{app_id}|{app_secret}" used by GET /{app-id}/subscriptions and debug_token. The secret half already lives in whatsapp_app_secret.';

-- ROLLBACK: alter table public.app_settings drop column whatsapp_app_id;
```

**דריסה יבשה (VERIFIED-LIVE 2026-09-10):** רץ באותה טרנזקציה והוחזר לאחור — העמודה נוצרה, ה-ACL של `app_settings` נשאר `{postgres=arwdDxtm, service_role=arwdDxtm, authenticated=rw}`, ולא נוצר ACL ברמת עמודה. שימו לב שה-`ALTER` נוטל `ACCESS EXCLUSIVE` על `app_settings` — טבלה שנקראת כמעט בכל בקשה; זה שינוי קטלוג בלבד (בלי `default`, בלי rewrite) ולכן מיידי, אבל אין להריץ אותו יחד עם עבודה ארוכה באותה טרנזקציה.

---

## 5. חיבור/הוספת מספרים לפי ספק

### 5.1 Meta WhatsApp Cloud API

**רשימת מספרים ב-WABA** — DOCS-ONLY (ctx7 `phone-number-management-api`, WebFetch `cloud-api/reference/phone-numbers`):
`GET /{API_VERSION}/{WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type,account_mode,is_official_business_account` — **בלי `last_onboarded_time`**, שאינו ניתן לקריאה כשדה (Task 1.3 Step 0). סינון `account_mode` (SANDBOX/LIVE, beta), מיון `last_onboarded_time`. `name_status ∈ {APPROVED, AVAILABLE_WITHOUT_REVIEW, DECLINED, EXPIRED, PENDING_REVIEW, NONE}`. tier דרך `GET /{pnid}?fields=whatsapp_business_manager_messaging_limit` → `TIER_250`… (ctx7 `messaging-limits`).

**הוספת מספר** — DOCS-ONLY, **שתי גרסאות תיעוד סותרות**: (א) reference `phone-number-management-api`: `POST /{WABA_ID}/phone_numbers` body `phone_number` (E.164 בלי `+`, required), `verified_name` (required), `cc` (optional), `migrate_phone_number`, `preverified_id`; (ב) מדריך המיגרציה: `cc` + `phone_number` (בלי קידומת) + `verified_name` כולם required. **משימה 2.1 חייבת לאמת מול העמוד החי לפני קידוד**; המימוש ישלח `cc`, `phone_number` (ספרות לאומיות), `verified_name` — הצורה שמופיעה בדוגמה המלאה. תגובה: `{ id }` = `phone_number_id` החדש. עמוד `cloud-api/reference/phone-numbers` **אינו** מתעד POST כזה ומפנה ל-WhatsApp Manager/Embedded Signup — עוד סיבה לאימות.

**אימות בעלות** — DOCS-ONLY: `POST /{PHONE_NUMBER_ID}/request_code` body `code_method ∈ {SMS, VOICE}`, `language` (2 תווים, למשל `he`/`en`); `POST /{PHONE_NUMBER_ID}/verify_code` body `code` (מספרי). "Authenticate yourself with a system user access token."

**רישום ל-Cloud API** — DOCS-ONLY (`cloud-api/reference/registration`): `POST /{PHONE_NUMBER_ID}/register` body `{ messaging_product: "whatsapp", pin: "<6 digits>" }`. "If your verified business phone number already has two-step verification enabled, set this value to your number's 6-digit two-step verification PIN"; אחרת ה-PIN שנשלח **מפעיל** אימות דו-שלבי. `POST /{PHONE_NUMBER_ID}/deregister`. **מגבלה:** "limited to 10 requests per business number in a 72-hour moving window" → שגיאה `133016` וחסימה ל-72 שעות (שני ה-endpoints).

**שם תצוגה** — DOCS-ONLY (`display-names`): `POST /{pnid}?new_display_name=…` (עד 10 שינויים ב-30 יום, דורש סקירה); מעקב `GET /{pnid}?fields=new_display_name,new_name_status`.

**הרשאות/טוקן** — DOCS-ONLY: `whatsapp_business_management` + `whatsapp_business_messaging`; טוקן System-User (הטוקן שכבר ב-`whatsapp_access_token`). "Advanced Access" נדרש רק בפעולה בשם עסק אחר.

**אילוצים** — DOCS-ONLY (`cloud-api/phone-numbers`): המספר לא יכול להיות בשימוש ב-WhatsApp Messenger/Business App ("Numbers already in use with WhatsApp cannot be registered unless they are deleted first"); חייב לקבל SMS/שיחה; לא short code; "New business portfolios are initially capped at two registered business phone numbers" → 20 אחרי אימות עסקי או tier 2K. שם התצוגה מחויב סקירה (`name_status`).

**תוקף טוקן** — DOCS-ONLY (ctx7 `/websites/developers_facebook_graph-api` → `GET /v26.0/debug_token?input_token=…`): דורש app access token (`{APP_ID}|{APP_SECRET}`) או טוקן של מפתח האפליקציה; תגובה `data.{is_valid, expires_at, data_access_expires_at, issued_at, scopes[], granular_scopes[], app_id, type, user_id}`. INFERRED: לטוקן System-User "never expires" `expires_at = 0`. דורש `whatsapp_app_id` (§4.4).

**מנויי webhook** — MEASURED (MCP): `GET /{app-id}/subscriptions` (בשימוש כבר ב-`relocation/external.ts:201`, v21.0) מחזיר topics + fields. הסרת topic זר: `DELETE /{app-id}/subscriptions` עם `object=catalog` — **DOCS-ONLY, לא אומת היום**; משימה 5.4 מאמתת ב-ctx7 לפני קידוד.

### 5.2 Voximplant Management API

כל השורות DOCS-ONLY מ-`voximplant.com/api/v2/getDoc?fqdn=references.httpapi.*` (נשלף 2026-09-08), אלא אם צוין. Roles = תפקידי ה-service account שנדרשים.

| שלב | מתודה | פרמטרים עיקריים | Roles | הערות |
|---|---|---|---|---|
| רשימת המספרים שלנו | `GetPhoneNumbers` (**קיים** `core.ts:332`) | סינון `application_id`, `is_bound_to_application`, `is_bound_to_rule`, `activation_status`, `phone_number` | Owner/Admin/Developer/Supervisor/Accountant/Support/Payer | תגובה `AttachedPhoneInfoType`: `phone_id`, `phone_number`, `activation_status`, `verification_status ∈ {REQUIRED,IN_PROGRESS,VERIFIED}`, `unverified_hold_until` (**"The number is detached on that day automatically!"**), `phone_next_renewal`, `phone_price`, `phone_purchase_date`, `application_id/name`, `rule_id/name`, `is_sms_supported`, `deactivated`, `canceled` |
| שייכות זולה | `IsAccountPhoneNumber` | `phone_number` (בלי `+`) | כל התפקידים | לבדיקת caller id שהוקלד ידנית |
| קטלוג | `GetPhoneNumberCategories` → `GetPhoneNumberRegions(country_code, phone_category_name)` | | Owner/Admin/Accountant/Payer | `PhoneNumberCountryRegionInfoType`: `account_price`, `account_installation_price`, `account_currency`, `phone_count` (מלאי), **`is_need_regulation_address`**, `regulation_address_type ∈ {LOCAL,NATIONAL,WORLDWIDE}` |
| מלאי | `GetNewPhoneNumbers(country_code, phone_category_name, phone_region_id[, phone_number_mask])` | | Owner/Admin/Accountant | `NewPhoneInfoType`: `phone_number`, `phone_id`, `phone_price` (+`phone_tax_reserve`), `phone_installation_price` (+`phone_installation_tax_reserve`), `phone_period` |
| רגולציה (IL) | `GetAvailableRegulations(country_code='IL', phone_category_name)` | | Owner/Accountant | `result=false` ⇒ "the regulations address needs to be created"; `GetRegulationsAddress` מחזיר `RegulationAddress{status ∈ IN_PROGRESS,VERIFIED,DECLINED, reject_message}`. יצירת כתובת רגולציה — **לא נמצאה מתודה ב-getDoc היום (UNVERIFIED)**; עד לאימות: הפאנל מציג הוראה לבצע ב-Control Panel |
| **רכישה** | `AttachPhoneNumber` | מצב קטלוג: `country_code+phone_category_name+phone_region_id`; מצב ספציפי: `phone_number` (מ-GetNewPhoneNumbers); `regulation_address_id`; `phone_count` | Owner/Admin/Accountant | **עולה כסף**: `digest-management-api.md:136` — "הרכישה שומרת מראש את דמי המנוי של החודש הבא + מסים" (DOCS-ONLY). ⚠️ **מצב "מספר ספציפי" אינו זמין בישראל** (MEASURED §0.0: `GetPhoneNumberCategories(IL)` → `can_list_phone_numbers: false` לכל הקטגוריות פרט ל-MOBILE; `GetNewPhoneNumbers` נכשל ב-529). הפלטפורמה בוחרת את המספר, **ולכן ההגנה "לעולם לא מצב קטלוג" מבטלת את Phase 3 בישראל.** ההגנה החלופית אינה על המצב אלא על מה שמוצג לפני הכפתור: מחיר חודשי + התקנה + מטבע מ-`GetPhoneNumberRegions`, `phone_count` **מקובע ל-1 בקוד** ולא נגזר מהקלט, והקלדת מחרוזת אישור. אותה בטיחות כספית, בלי לסגור את המדינה היחידה שבה אנחנו פועלים. |
| קישור לאפליקציה | `BindPhoneNumberToApplication(phone_id\|phone_number, application_id\|application_name, bind=true, rule_id\|rule_name)` | | Owner/Admin/Developer | `application_id` = `app_settings.voximplant_application_id` (קיים; `console-agent-provisioning.ts:412-426`) |
| SMS callback | `SetPhoneNumberInfo(phone_id, incoming_sms_callback_url)` | | Owner/Admin/Accountant | לא בהיקף |
| ביטול | `DeactivatePhoneNumber(phone_id)` | | **Owner בלבד** | סביר שה-service account אינו Owner → הפאנל מציג "ב-Control Panel בלבד" עד שמשימה 3.1 מודדת |
| Caller ID ממספר חיצוני | `GetCallerIDs` (`verified_until`, ניסיונות) | | Owner/Admin | `AddCallerID/VerifyCallerID/ActivateCallerID` **אינם קיימים ב-HTTP API** (getDoc החזיר `{}`; גם `digest-management-api.md:143`). אימות CLI חיצוני = Control Panel בלבד |

**כלל ה-CLI:** `mutations.ts` לעולם לא מיובא ע"י ה-CLI (`cli-guard.test.ts` מצמיד). כל העטיפות החדשות שמשנות מצב (`attachPhoneNumber`, `bindPhoneNumberToApplication`, `deactivatePhoneNumber`) נכנסות ל-`mutations.ts`; הקריאה בלבד (`getNewPhoneNumbers`, `getPhoneNumberRegions`, `getPhoneNumberCategories`, `isAccountPhoneNumber`, `getAvailableRegulations`, `getRegulationsAddress`) ל-`core.ts`.

**איך מספר חדש מגיע ל-route-inbound** — MEASURED + INFERRED: היום rule `incoming` (1494687) עם pattern `97237219347` מפנה ל-`ConsoleInbound` (919510), שקורא ל-`POST /api/voximplant/console/route-inbound` (`route-inbound/route.ts:30-51`). Rules מנוהלים ב-`voxfiles/applications/kalfa-rsvp…/rules.config.json` + `voxengine-ci upload` (בעלים). INFERRED מתיעוד `BindPhoneNumberToApplication` ("bind… to the application… rule_name"): קישור מספר חדש ל-rule 1494687 מנתב שיחות אליו ל-`ConsoleInbound` **בלי לשנות pattern**, אבל זה לא נמדד. משימה 3.4 מאמתת בשיחה נכנסת אחת (הבעלים מחייג) לפני שהפאנל מציע bind ל-rule; עד אז הפאנל מציע bind לאפליקציה בלבד + הוראה לעדכן `rules.config.json`.

### 5.3 ExtrA (exm.co.il)

**מקור:** OpenAPI 3.0.3 רשמי "extra API" v1.0.0 שהבעלים העלה (`.claude/uploads/…/3c74c4ae-api1_1.json`, 78 KB, 11 operations). כל השורות DOCS-ONLY מהמפרט אלא אם צוין; מספרי operationId מצוטטים. **הצעה:** לקבע את המפרט בריפו כ-`docs/extra/openapi-extra-v1.json` (Phase 0, Task 0.5) — `src/lib/sms/sender.ts` מממש היום `smsSend` בלבד.

**כללי:** servers `https://api.exm.co.il/v1` ו-`https://www.exm.co.il/api/v1` (הקוד משתמש בשני); `Authorization: Bearer <API key>` מ-`/my/api/`; "The key grants access to the whole account - keep it server-side only". שגיאות עסקיות חוזרות **HTTP 200 עם `success:false`** — הקוד הקיים כבר מתייחס לזה (`sender.ts:92-101`). זמנים ISO 8601 עם offset (Asia/Jerusalem).

| שימוש בפאנל | operationId | פרטים | הערות |
|---|---|---|---|
| **בדיקת חיבור + ניטור תפוגת מפתח** | `getAuthKey` — `GET /auth/key/` | תגובה `AuthKeySuccess{ key, scopes (null = legacy/unscoped key "which may do everything"), times.{created,expire} (Y-m-d), user.{id,email_address} }`; 401 = מפתח לא תקין. | ⚠️ התגובה **מחזירה את המפתח עצמו** — הקליינט חייב להשליך את `key` ולא להעביר/לרשום אותו. MEASURED (team-lead): המפתח החי תקין, `scopes: null`, נוצר 2025-10-27, **פוקע 2027-10-27**. |
| **שליחת SMS (קיים)** | `smsSend` — `POST /sms/send/` | `SmsSendRequest{message, destination (050-… או 972…), sender}` → `SmsSendSuccess{id, messages_count.{sent,charged}}` או `ApiErrors{errors[]{id,code,description}}`. | **"The sender must be one of the account's verified IDs (managed at /my/verified-ids/) with the `sms_sender` permission granted."** אין operation ליצירה/אימות/רשימה של verified IDs → **פורטל בלבד** (DOCS-ONLY, מאשר את ההנחה הקודמת). |
| מיפוי שגיאות ל-UI | `smsSend` | 7321 message חסר · 7526/7520 destination לא תקין · **9404 אין כרטיס אשראי** · **1214 אין פרופיל חיוב API-SMS** ("Contact support") · **1215 sender לא מאומת** · 7521 sender נדחה אצל הספק · 7462 טלפון כשר · 7404 שגיאת ספק לא מתועדת. | היום `sender.ts:92-101` זורק הודעה כללית עם `JSON.stringify(errors)`; הפאנל ימפה 1215/7521 → "השולח אינו verified ID — הוסיפו ב-/my/verified-ids/", 9404/1214 → "חיוב: פנו ל-ExtrA". |
| **רשימת קווי החשבון (עקיף)** | `getCallsHistory` — `POST /calls/` | body: `call_types[]`, `line_types[]` (1=vn, 2=ivr, 5=mobile, 7=sip), `time.{from,to}`, `pagination.{items 20..100, next}`; **לא** `direction` (מסומן deprecated/מקולקל). תגובה `Call[]` עם `numbers.own.{e164, friendly, line_type}`, `numbers.caller`, `numbers.destination`, `type`, `duration`, `recording`, `AI`. | אין endpoint ייעודי למספרים; `distinct numbers.own.e164` מ-N העמודים האחרונים = קווי החשבון. token עימוד קשור לפילטר (5010). |
| הקלטה / AI (Phase 6) | `downloadCallRecording` (`GET /calls/recording/?call_id=`), `getRecordingUrls` (`POST /calls/get-recording-urls/`, `config.ttl` 1..10 דק' signed, 0 = **ציבורי לצמיתות**), `getCallAi` (`GET /calls/ai/?id=`: `summary.{gist,body,next_steps}`, `transcription`) | `Call` = "the same shape as the automations webhook POST payload"; `AI` = "the same canonical shape delivered in the `AI-DONE` webhook payload". | לעולם לא `ttl: 0` (URL ציבורי לצמיתות של שיחת לקוח). |
| Click2Call (הערה בלבד) | `click2call` — `GET /click2call/?caller_id&physical&destination` | שתי רגליים: `physical` (מכשיר מאומת) מקבל שיחה, ואז `destination` רואה `caller_id`; "billing-agnostic - it makes the call regardless of your billing preferences"; `already_dialing` idempotency 45 שנ'; 93039 מחוץ לשעות פעילות. | אפשרות עתידית לקונסולה; **לא בהיקף**. |
| When (יומנים) | `listCalendars`, `listWhenBookings`, `cancelWhenBooking` | דורש When Pro (403 `when_pro_required`). | לא בהיקף. |

**מה זה אומר לפאנל (עמוד ExtrA):**
1. **כרטיס סטטוס** = `getAuthKey`: תקין/לא, `expire`, ימים לתפוגה (אדום < 60 יום), `scopes` ("מפתח מלא ללא scopes" כשהוא null), חשבון (`user.email_address`, לא PII של לקוח). **ניטור:** תור pg-boss יומי `extra-key-check` (עם רשומה ב-`QUEUE_EXPECTED_MAX_MINUTES`) → Slack `send_health` כשהמפתח לא תקין או < 30 יום לתפוגה; `integrations.ts` ExtrA → `healthCheckAvailable: true`.
2. **Sender** = שדה `extra_sms_sender` (קיים) + כפתור **"אמת ב-SMS בדיקה"** (`manage_settings`, יעד = מספר שהאדמין מקליד, 3/שעה דרך `rateLimit` הקיים, `logActivity`, ללא PII בהודעה) + קישור ל-`https://www.exm.co.il/my/verified-ids/` להוספת verified IDs. תוצאה 1215/7521 מוצגת כשגיאת שדה על `extra_sms_sender`.
3. **קווי החשבון (קריאה בלבד)** = `syncExtraLines()`: `POST /calls/` עם `pagination.items: 100`, עד 3 עמודים, `distinct numbers.own` → upsert ל-`provider_numbers` (`provider:'extra_sms'`, `provider_ref` = `e164` בלי `+` אם אין sender תואם, snapshot `{friendly, line_type, last_call_at, inbound_30d, missed_30d, forwards_to_last4}` — `forwards_to_last4` נגזר מ-`numbers.destination.e164` של שיחות `incoming`, **4 ספרות אחרונות בלבד**, זה מכשיר של הבעלים). התוצאה המצופה: שורה אחת, `03-3301505`, עם התפקידים `sms_sender` + `business_line_inbound`, ולידה — באותו E.164 — שורת Meta (`whatsapp_import_sender` כשישויך) ושורת `company_contact`. במודול המספרים זה מוצג כקבוצה: **"מספר אחד, ארבעה כובעים"**.
4. **"verified device"** מוצג כ-"מנוהל בפורטל" — אין API.

### 5.4 Resend / SMTP, Microsoft Graph, SUMIT, Slack — קריאה בלבד

- **Resend:** `EMAIL_PROVIDER` (env) + `email_enabled` + `smtp_from`. שורת סטטוס "דומיין שליחה `send.kalfa.me`" נגזרת מ-`smtp_from`; אין קריאת API לרשימת דומיינים (לא בהיקף; אפשר בעתיד עם `resend.domains.list()` — DOCS-ONLY, לא נבדק).
- **Microsoft:** `exchange_connections` (status/lastVerifiedAt) + `exchange_connection_mode`; שורות קריאה; הפעולות הקיימות (test/list/revoke) מועברות כפי שהן.
- **SUMIT:** מפתחות (מוסך) + קישור ל-`/admin/sumit-test`; מתגי הכסף נשארים ב-settings (D8).
- **Slack:** כל `/admin/alerts` כפי שהוא + טבלת "קטגוריה ↔ מקורות" (G13) סטטית מהקוד.

---

## 6. שלבי ביצוע

כל פאזה ניתנת לפריסה בנפרד ומסתיימת ב-`npm run build` + בדיקת דפדפן ב-RTL בשני הנושאים (skill `verifying-kalfa-changes`). שמות קבצים מלאים; `(admin)` = `src/app/(admin)/admin`.

### Phase 0 — איחוד קריאה-בלבד (הזזת רכיבים, אפס שינוי התנהגות) · **M**

**File Structure**

| קובץ | פעולה |
|---|---|
| `(admin)/integrations/page.tsx` | חדש — אינדקס |
| `(admin)/integrations/_components/provider-card.tsx` | חדש — כרטיס סטטוס משותף (Server) |
| `(admin)/integrations/_components/provider-page-shell.tsx` | חדש — heading + tabs-less סקציות |
| `(admin)/integrations/meta-whatsapp/page.tsx` + `whatsapp-credentials-form.tsx` + `whatsapp-webhook-card.tsx` | חדש — תוכן מ-`channels-client.tsx:328-405` (**הטווח 319-410 שהופיע כאן קודם שגוי; אומת 10.9**) |
| `(admin)/integrations/_components/outreach-master-switch.tsx` | חדש — **מ-`channels-client.tsx:214-252`**. הרכיב מוגדר בתוך הקובץ שנמחק ונדרש בשלושה מקומות (אינדקס + ראש עמוד Meta + ראש עמוד Voximplant). §3.3 מבטיח "אותו רכיב, אותו action" אך לא הקצה לו קובץ |
| `(admin)/integrations/meta-whatsapp/whatsapp-consent-toggle.tsx` | חדש — **מ-`channels-client.tsx:408-448`** (הערה 408-414 + טופס 415-448), action `updateWhatsAppConsentRequiredAction` (`channels/actions.ts:413`). מתג `whatsapp_consent_required` + אזהרת סעיף 30א. נוסף 8.9 (מיגרציה `20260908212916`) **אחרי** כתיבת התוכנית ולכן נפל מחוץ לכל טווח. **חשיפה משפטית — אסור שייעלם** |
| `(admin)/integrations/meta-whatsapp/whatsapp-connection-test.tsx` | חדש — מ-`channels-client.tsx:450-459`, action `testWhatsAppConnectionAction` (`channels/actions.ts:69`) |
| `(admin)/integrations/voximplant/voximplant-scenario-urls.tsx` | חדש — מ-`channels-client.tsx:739-751` (אקורדיון "כתובות התרחיש (לעיון)"). דורש `voxCtxBase`/`voxCbBase`, שמחושבים ב-`channels/page.tsx:24-26` דרך `getAppUrl` — להעביר את שתי הקריאות לעמוד החדש |
| `(admin)/integrations/voximplant/voximplant-connection-test.tsx` | חדש — מ-`channels-client.tsx:757-766`, action `testVoximplantConnectionAction` (`channels/actions.ts:133`) |
| שתי פסקאות ההסבר ב-`channels/page.tsx` | **להעביר, לא לאבד**: `:35-40` ("הפעלת ערוץ מתחילה שליחות חיות בתשלום…") לראש עמוד Meta; `:58-63` ("הוספת ערוץ חדש אינה עריכת-תצוגה אלא שינוי סכמה וקוד") לצד `ChannelCatalogEditor` באינדקס — זו ההנחיה שמונעת מאדמין לנסות להוסיף ערוץ מה-UI |
| `(admin)/integrations/meta-whatsapp/template-health-card.tsx` | חדש — **סקציית בריאות בלבד** בעמוד Meta: סיכום drift/quality/status, ניטור וריאנטים (Phase 5) וכפתור "אשר קטגוריה", + קישור ל-`/admin/templates`. `(admin)/templates/**` **אינו זז ואינו נמחק** |
| `(admin)/integrations/voximplant/page.tsx` + `voximplant-credentials-form.tsx` + `voximplant-personas.tsx` + `voximplant-danger-zone.tsx` | חדש (תוכן מ-`channels-client.tsx:412-717`) |
| `(admin)/integrations/_actions/outreach-master.ts`, `whatsapp.ts`, `voximplant.ts`, `channel-catalog.ts` | הועבר מ-`(admin)/channels/actions.ts` (מפוצל לפי ספק; **הלוגיקה זהה**) |
| `(admin)/integrations/extra-sms/page.tsx` + `extra-sms-form.tsx` + `actions.ts` | חדש |
| `(admin)/integrations/resend-email/page.tsx` + `email-transport-form.tsx` + `actions.ts` | חדש |
| `(admin)/integrations/sumit/page.tsx` + `sumit-credentials-form.tsx` + `actions.ts` | חדש |
| `(admin)/integrations/microsoft/page.tsx` | חדש (מרכיב `ExchangeManager`, `ExchangeModeToggle` המועברים) |
| `(admin)/integrations/slack/page.tsx` + `alerts-client.tsx` + `actions.ts` | הועבר מ-`(admin)/alerts/*` |
| `src/lib/data/admin/settings.ts` | `AppSettings`/`updateAppSettings` **בלי** שדות SUMIT/ExtrA/SMTP; 3 DAL חדשים `getSumitCredentials/updateSumitCredentials`, `getExtraSmsConfig/updateExtraSmsConfig`, `getEmailTransportConfig/updateEmailTransportConfig` |
| `src/lib/validation/admin.ts` | `appSettingsSchema` מצומצם + `sumitCredentialsSchema`, `extraSmsSchema`, `emailTransportSchema` |
| `(admin)/settings/settings-form.tsx` + `actions.ts` | הסרת פאנל "הודעות" ושלושת שדות SUMIT; 3 טאבים |
| `src/components/admin-shell.tsx` | nav |
| `next.config.ts` | `redirects()` |
| `(admin)/channels/**`, `(admin)/alerts/**` | **נמחקים** (הבדיקות שלהם מועברות ליד הקבצים החדשים). `(admin)/templates/**` נשאר במקומו |

**Interfaces (Produces):** `ProviderCard({ title, href, configured, enabled?, lastCheckedAt?, note? })`; `IntegrationKey = 'meta-whatsapp'|'voximplant'|'extra-sms'|'resend-email'|'microsoft'|'sumit'|'slack'`.

#### Task 0.1: אינדקס + כרטיס סטטוס

> ⚠️ **שוכתב 10.9 ערב — ראו §0.4.** ה-DAL ב-Step 3 (`getIntegrationsOverview`) **אינו נכתב**: הרשימה כבר קיימת ב-`src/lib/ops/integrations.ts` ומזינה את `/admin/debug`, והתוכנית גם משאירה את העמוד ההוא חי — כלומר הקוד כפי שנכתב כאן היה מייצר שתי רשימות שיכולות לסתור זו את זו. במקומו: `getIntegrationsConfiguredFlags()` (שאילתה אחת, אפס סודות) → `getIntegrationsStatus()` הקיימת מקבלת ממנה `configured` + `enabled` חדש → **שני העמודים נשענים על אותה פונקציה**. הבלוק למטה נשמר כתיעוד של מה שתוכנן, לא כהוראה.


- [ ] **Step 1: בדיקת רינדור נכשלת** — `(admin)/integrations/page.test.ts` (דפוס `src/app/(customer)/app/page.test.ts:46-55` — קריאה ישירה ל-Server Component + `collect()` **מקומי** לקובץ הבדיקה; אין מודול משותף לזה, MEASURED):

```ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/integrations/index', () => ({
  getIntegrationsOverview: vi.fn().mockResolvedValue([
    { key: 'meta-whatsapp', title: 'Meta / WhatsApp', configured: true, enabled: true, lastCheckedAt: null },
    { key: 'voximplant', title: 'Voximplant', configured: true, enabled: false, lastCheckedAt: null },
  ]),
}));
import IntegrationsIndexPage from './page';

// Same walker as src/app/(customer)/app/page.test.ts:46-55 — flattens the React
// element tree into its element props so text/href assertions need no DOM.
function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
  const el = node as { props?: Record<string, unknown> & { children?: unknown } };
  if (el.props) out.push(el.props);
  collect(el.props?.children, out);
  return out;
}
const textOf = (tree: unknown) =>
  collect(tree).map((p) => (typeof p.children === 'string' ? p.children : '')).join(' ');

describe('/admin/integrations', () => {
  it('renders one card per provider with its status badge', async () => {
    const tree = await IntegrationsIndexPage();
    const text = textOf(tree);
    expect(text).toContain('Meta / WhatsApp');
    expect(text).toContain('Voximplant');
    expect(text).toContain('פעיל');
    expect(text).toContain('מוגדר · כבוי');
  });
});
```

- [ ] **Step 2:** `npm test -- --run "src/app/(admin)/admin/integrations/page.test.ts"` → FAIL (module not found).
- [ ] **Step 3: DAL** `src/lib/data/admin/integrations/index.ts`:

```ts
import 'server-only';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { getExtraSmsConfig, getEmailTransportConfig, getSumitCredentials } from '@/lib/data/admin/settings';
import { getSlackAlertsView } from '@/lib/data/admin/alerts';
import { listMyExchangeConnections } from '@/lib/data/exchange-connections';
import { selectedEmailProvider } from '@/lib/email/sender';

export type IntegrationKey =
  | 'meta-whatsapp' | 'voximplant' | 'extra-sms' | 'resend-email' | 'microsoft' | 'sumit' | 'slack';

export interface IntegrationOverviewRow {
  key: IntegrationKey;
  title: string;
  configured: boolean;
  enabled: boolean;      // the provider's own gate (outreach master / live calls / sms_enabled …)
  lastCheckedAt: string | null;
  note?: string;
}

export async function getIntegrationsOverview(): Promise<IntegrationOverviewRow[]> {
  await requirePlatformPermission('manage_settings');
  const [wa, vox, master, sms, email, sumit, slack, exchange] = await Promise.all([
    getWhatsAppChannelConfig(), getVoximplantChannelConfig(), getOutreachMasterState(),
    getExtraSmsConfig(), getEmailTransportConfig(), getSumitCredentials(), getSlackAlertsView(),
    listMyExchangeConnections(),
  ]);
  return [
    { key: 'meta-whatsapp', title: 'Meta / WhatsApp', configured: wa.configured, enabled: master.enabled && wa.configured, lastCheckedAt: null },
    { key: 'voximplant', title: 'Voximplant', configured: vox.configured, enabled: vox.liveEnabled, lastCheckedAt: null },
    { key: 'extra-sms', title: 'ExtrA SMS', configured: sms.configured, enabled: sms.sms_enabled, lastCheckedAt: null },
    { key: 'resend-email', title: `דואר (${selectedEmailProvider() === 'resend' ? 'Resend' : 'SMTP'})`, configured: email.configured, enabled: email.email_enabled, lastCheckedAt: null },
    { key: 'microsoft', title: 'Microsoft Graph / Exchange', configured: exchange.some((c) => c.status === 'verified'), enabled: exchange.some((c) => c.status === 'verified'), lastCheckedAt: exchange.find((c) => c.lastVerifiedAt)?.lastVerifiedAt ?? null },
    { key: 'sumit', title: 'SUMIT', configured: sumit.configured, enabled: sumit.configured, lastCheckedAt: null, note: 'מתגי החיוב ב-/admin/settings' },
    { key: 'slack', title: 'Slack', configured: slack.connected, enabled: slack.enabled, lastCheckedAt: null },
  ];
}
```

**אין להשתמש ב-`getSumitCredentials()` וב-`getExtraSmsConfig()` באינדקס.** שתיהן מחזירות סודות (`sumit_api_key`, `extra_sms_token`), והשימוש היחיד בהן כאן הוא לגזור בוליאני `configured`. ההערה ב-`settings.ts` מנמקת את החזרת הסוד ב**טופס** המסכה — ולאינדקס אין טופס. במקומן `getIntegrationsConfiguredFlags()`: קריאה **אחת** שמחזירה נוכחות בלבד, ומחליפה גם את שש הנסיעות הנפרדות לאותה שורת singleton (`app_settings` הוא `.eq('id', true)`).

```sql
select (whatsapp_access_token is not null and whatsapp_phone_number_id is not null) as wa_configured,
       (sumit_api_key is not null and sumit_company_id is not null)                 as sumit_configured,
       (extra_sms_token is not null and extra_sms_sender is not null)               as extra_configured,
       (smtp_from is not null)                                                      as email_configured,
       outreach_enabled, sms_enabled, email_enabled, voximplant_live_calls
  from app_settings where id = true
```

שש נסיעות → אחת, ואפס סודות בזיכרון עבור שבעה כרטיסי סטטוס.

`getVoximplantChannelConfig` דורש `manage_voice`, והאינדקס נטען גם למי שאין לו אותו. **אין לעטוף ב-`try/catch`:** `requirePlatformPermission` קורא `redirect('/app')` (`src/lib/auth/dal.ts:135-139`), כלומר זורק `NEXT_REDIRECT` — `catch` עירום יבלע ניווט של הפריימוורק, לא שגיאת הרשאה. הדפוס הנכון הוא הפרדיקט שאינו זורק, `hasPlatformPermission` (`dal.ts:117`), וזה בדיוק מה ש-`nav-counts.ts:78-80` עושה — הקובץ שצוטט כאן קודם כ"אותו דפוס", בטעות: אין בו `try/catch` כלל.

```ts
const canVoice = await hasPlatformPermission('manage_voice');
const vox = canVoice
  ? await getVoximplantChannelConfig()
  : { configured: false, liveEnabled: false, note: 'אין הרשאת manage_voice' };
```

- [ ] **Step 4: הרכיב** `_components/provider-card.tsx` (Server; מחזיר `<Link>` עם `Badge` מ-`@/components/ui/badge`; טקסטי הסטטוס זהים ל-`StatusBadge` הקיים: `פעיל` / `מוגדר · כבוי` / `לא מוגדר`). `page.tsx`: `requirePlatformPermission('manage_settings')` → `getIntegrationsOverview()` → grid `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` → למטה `OutreachMasterSwitch` (מועבר) + `ChannelCatalogEditor` (מועבר).
- [x] **Step 5:** בדיקות עוברות (15 על ה-DAL); `tsc`; `lint`. ⬜ בדיקת רינדור לעמוד עצמה עדיין חסרה — ראו §0.5.
- [x] **Step 6:** commit `0d3123a` + `da579ea` (תיקון כפילות נוסח).

#### Task 0.2: פיצול `appSettingsSchema` ו-DAL לספקים

- [ ] **Step 1: בדיקות נכשלות** ב-`src/lib/data/admin/settings.test.ts` (קיים) — להוסיף:

```ts
it('updateExtraSmsConfig writes only the three ExtrA columns', async () => {
  const { builder } = mock(null);
  await updateExtraSmsConfig({ sms_enabled: true, extra_sms_sender: '03-3301505', extra_sms_token: 'T' });
  expect(vi.mocked(builder.update).mock.calls[0][0]).toEqual({
    sms_enabled: true, extra_sms_sender: '03-3301505', extra_sms_token: 'T',
  });
});
it('updateAppSettings no longer touches provider credential columns', async () => {
  const { builder } = mock(null);
  await updateAppSettings(baseInput); // baseInput = the reduced AppSettingsInput fixture
  const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
  for (const k of ['sumit_api_key','sumit_company_id','sumit_api_public_key','extra_sms_token','extra_sms_sender','sms_enabled','smtp_host','smtp_password','smtp_from','email_enabled']) {
    expect(patch).not.toHaveProperty(k);
  }
});
```

- [ ] **Step 2:** הרצה → FAIL.
- [ ] **Step 3:** ב-`validation/admin.ts` — להסיר מ-`appSettingsSchema` את 13 שדות הספקים ולהוסיף:

```ts
export const sumitCredentialsSchema = z.object({
  sumit_company_id: z.string().trim().regex(/^\d*$/, { error: 'מזהה חברה חייב להכיל ספרות בלבד' }),
  sumit_api_public_key: z.string().trim(),
  sumit_api_key: z.string().trim(),
});
export const extraSmsSchema = z.object({
  sms_enabled: z.boolean(),
  extra_sms_sender: z.string().trim().max(32),
  extra_sms_token: z.string().trim(),
});
export const emailTransportSchema = z.object({
  email_enabled: z.boolean(),
  smtp_host: z.string().trim(),
  smtp_port: z.string().trim().regex(/^\d*$/, { error: 'פורט חייב להכיל ספרות בלבד' }),
  smtp_secure: z.boolean(),
  smtp_user: z.string().trim(),
  smtp_password: z.string().trim(),
  smtp_from: z.string().trim(),
});
```

ב-`settings.ts`: `AppSettings`/`UpdateAppSettingsInput`/`getAppSettings`/`updateAppSettings` מצומצמים; שלושה זוגות get/update חדשים (אותו דפוס `.select(...)`/`.update(...)`, `manage_settings`, `'' → null`), עם `configured` נגזר: SUMIT = `company_id && api_key`; ExtrA = `token && sender`; Email = `smtp_from && (provider==='resend' || smtp_host)`.
- [ ] **Step 4:** `settings-form.tsx` — להסיר את `Panel value="messaging"` ואת שלושת `EditableField` של SUMIT. **ה-`TabsList` נשאר `grid w-full grid-cols-2 sm:inline-flex sm:w-auto` — אל תשנו ל-`grid-cols-3`:** ההערה ב-`settings-form.tsx:161-165` מתעדת שרשת 2×2 נבחרה כי ארבע תוויות עבריות לא נכנסות בשורה אחת בנייד, ו-`grid-cols-3` מחזיר בדיוק את הבעיה. לעדכן את ההערה עצמה מ-"Four Hebrew labels" ל-"Three". `settings/actions.ts` — להסיר 13 השדות מהקריאה ל-`safeParse`. `settings/page.tsx` — להסיר `ExchangeManager`/`ExchangeModeToggle`/`emailProvider` (עוברים ל-microsoft/resend). **לשמור על `keepMounted`** בפאנלים שנותרו (הכלל ב-`settings-form.tsx:135-145`).
- [ ] **Step 5:** בדיקות עוברות; `tsc`; lint. **בדיקת רגרסיה חובה:** `settings/actions.test.ts` — לעדכן את ה-fixture; לוודא שאין בדיקה שמצפה לשדות שהוסרו.
- [ ] **Step 6:** commit `refactor(admin): split provider credentials out of appSettingsSchema`.

#### Task 0.3: עמוד Meta/WhatsApp (credentials + webhook + master switch)

- [ ] **Step 1:** להעביר את `channels/actions.ts` ל-`integrations/_actions/{outreach-master,whatsapp,voximplant,channel-catalog}.ts` **ללא שינוי לוגיקה**; `revalidatePath` → `/admin/integrations`, `/admin/integrations/meta-whatsapp`, `/admin/integrations/voximplant`. להעביר `channels/actions.test.ts`, `outreach-master.test.ts` בהתאמה (רק נתיבי import ו-`revalidatePath` משתנים בבדיקות).
- [ ] **Step 2:** לפצל את `TabsPanel value="whatsapp"` (`channels-client.tsx:327-460`) ל-**שלושה** קבצים. **הטווחים אומתו 10.9 — אל תסתמכו על טווחים ישנים במסמך:** `whatsapp-credentials-form.tsx` ← `:328-405` (מכיל את אקורדיוני `creds` 343-384 ו-`webhook` 386-402); `whatsapp-consent-toggle.tsx` ← `:408-448` (**כולל בלוק ההערה 408-414** — הוא הראיה לבאג שהוא מונע: `<form>` מקונן גרם ל-"React form was unexpectedly submitted"); `whatsapp-connection-test.tsx` ← `:450-459`. `Field`/`SecretField`/`CopyRow` (`:157+`) → `_components/form-fields.tsx`. `whatsapp-webhook-card.tsx` = האקורדיון `webhook` שנחתך מהטופס + קישור `/admin/webhooks?provider=whatsapp`.
- [ ] **Step 2b (רגרסיה, חובה):** `meta-whatsapp/page.test.ts` מצמידה ששלושת הרכיבים נוכחים — לכל הפחות `expect(text).toContain('דרישת הסכמה')` ו-`expect(text).toContain('בדיקת חיבור')`. **הענף הזה כבר איבד רכיב בהעברה** (`b09240b` — "restore the auto-save that replacing the TopBar silently removed"); בדיקה היא ההבדל בין הזזה למחיקה שקטה.
- [ ] **Step 3:** `meta-whatsapp/page.tsx`:

```tsx
export const metadata: Metadata = { title: 'Meta / WhatsApp — אינטגרציות' };
export default async function MetaWhatsAppPage() {
  await requirePlatformPermission('manage_settings');
  const [whatsapp, master, callbackUrl] = await Promise.all([
    getWhatsAppChannelConfig(), getOutreachMasterState(), getAppUrl('/api/webhooks/whatsapp'),
  ]);
  return (
    <ProviderPageShell title="Meta / WhatsApp Cloud API" backHref="/admin/integrations">
      <OutreachMasterSwitch enabled={master.enabled} anyChannelReady={master.anyChannelReady} />
      <Section title="סטטוס"><StatusBadge configured={whatsapp.configured} enabled={master.enabled && whatsapp.configured} /> …</Section>
      <Section title="פרטי התחברות"><WhatsAppCredentialsForm whatsapp={whatsapp} /></Section>
      <Section title="Webhooks"><WhatsAppWebhookCard callbackUrl={callbackUrl} verifyToken={whatsapp.whatsapp_verify_token} /></Section>
      <Section title="תבניות"><Link href="/admin/integrations/meta-whatsapp/templates">ניהול תבניות ובריאותן</Link></Section>
    </ProviderPageShell>
  );
}
```

- [ ] **Step 4:** בדיקת רינדור `meta-whatsapp/page.test.ts` (דפוס Task 0.1): כותרות הסקציות + `callbackUrl` מופיעים.
- [ ] **Step 5:** `tsc`, lint, test. commit `feat(admin): /admin/integrations/meta-whatsapp`.

#### Task 0.4: עמוד Voximplant

- [ ] **Step 1:** לפצל את `TabsPanel value="voximplant"` (`channels-client.tsx:462-767`). **טווחים מאומתים 10.9 — הטווחים הקודמים (`592-716`, `432-590`) שגויים: שורה 432 נופלת בתוך טופס ההסכמה של וואטסאפ, בפאנל אחר לגמרי, ו-`592-716` מתחיל באמצע טופס המכירות ונגמר לפני אקורדיון כתובות התרחיש.** `voximplant-personas.tsx` ← ארבעת הטפסים `482-509` (live calls), `520-556` (meeting-confirm), `561-597` (sales), `606-637` (consent) — **טפסים אחים, לא מקוננים** (ההערה ב-`:464-478`); `voximplant-credentials-form.tsx` ← `642-754`, כולל אקורדיון `vox-creds` (647-699) ו-`vox-tuning` (701-737); `voximplant-scenario-urls.tsx` ← אקורדיון `vox-urls` (739-751) + שני ה-props; `voximplant-connection-test.tsx` ← `757-766`; `voximplant-danger-zone.tsx` = טופס ההסכמה (606-637, אדום) + קישור ל-`/admin/voice/platform` ול-`/admin/settings`.
- [ ] **Step 2:** `voximplant/page.tsx` — `requirePlatformPermission('manage_voice')`; כרטיס סטטוס משתמש ב-`getVoicePlatformView().balance/wiring` (קיים, `voice-ops.ts:479`) + `StatusBadge liveGateOff`.
- [ ] **Step 3:** בדיקת רינדור; `tsc`; lint. commit `feat(admin): /admin/integrations/voximplant`.

#### Task 0.5: ExtrA, Resend/SMTP, SUMIT, Microsoft, Slack

- [ ] **Step 1:** לכל אחד `page.tsx` + טופס (Client, `useActionState`, `EditableField` המועבר מ-`settings-form.tsx:22-94` ל-`_components/form-fields.tsx`) + `actions.ts` דק:

```ts
export async function updateExtraSmsAction(_p: FormState, fd: FormData): Promise<FormState> {
  const parsed = extraSmsSchema.safeParse({
    sms_enabled: fd.get('sms_enabled') === 'on',
    extra_sms_sender: fd.get('extra_sms_sender') ?? '',
    extra_sms_token: fd.get('extra_sms_token') ?? '',
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try { await updateExtraSmsConfig(parsed.data); } catch (err) { unstable_rethrow(err); return { error: 'עדכון הגדרות ה-SMS נכשל. נסו שוב.' }; }
  revalidatePath('/admin/integrations/extra-sms');
  return { notice: 'הגדרות ה-SMS נשמרו' };
}
```

- [ ] **Step 2:** עמוד ExtrA: (א) לקבע את המפרט — `cp <upload> docs/extra/openapi-extra-v1.json` + `docs/extra/README.md` (מקור, תאריך, 11 operations, "sender.ts מממש smsSend בלבד"); (ב) `src/lib/sms/extra-client.ts` חדש עם `getAuthKey(token)` (משליך את `key` מהתגובה; מחזיר `{ valid, scopes, createdAt, expireAt, accountEmail }`) ו-`mapSmsError(code)` לתוויות עברית (1215/7521/9404/1214/7520/7462); בדיקות עם `fetch` ממוקק: המפתח לא מופיע בערך המוחזר ולא בהודעות שגיאה; (ג) כרטיס סטטוס מ-`getAuthKey` (ימים לתפוגה, scopes); (ד) "למה משמש": רשימה סטטית של 4 המקורות (G12); (ה) כפתור "אמת ב-SMS בדיקה" (action `sendExtraTestSmsAction`, Zod יעד E.164 ישראלי, `rateLimit` 3/שעה, `logActivity('admin.extra.test_sms', { ok, code })`); (ו) קישור ל-`/my/verified-ids/` (§5.3). סנכרון הקווים (`syncExtraLines`) — Phase 1.3. עמוד Resend מציג `selectedEmailProvider()` (המשפט מ-`settings-form.tsx:282-286`). עמוד SUMIT: 3 שדות + קישור `/admin/sumit-test` + הערה "מתגי החיוב ב-/admin/settings". Microsoft: `ExchangeManager` + `ExchangeModeToggle` (קבצים מועברים; `revalidatePath` מתעדכן; `exchange-actions.ts` עובר איתם). Slack: `alerts/*` מועבר; `PATH = '/admin/integrations/slack'`.
- [ ] **Step 3:** בדיקות action לכל טופס (העתקת דפוס `settings/actions.test.ts`), `tsc`, lint. commit אחד לכל ספק.

#### Task 0.6: Nav + redirects + מחיקת העמודים הישנים

- [ ] **Step 1:** `admin-shell.tsx` — להסיר **שני** פריטים (`ערוצי תקשורת` מ"קמפיינים ושליחה", `התראות תפעול` מ"מערכת ותפעול"); **`תבניות פנייה` נשאר** במקומו. להוסיף ב"מערכת ותפעול" אחרי "הגדרות":

```ts
{ href: '/admin/integrations', label: 'אינטגרציות', icon: Plug, permission: 'manage_settings' },
```

⚠️ **`permission` חובה מאז 10.9 (§0.3).** `src/components/admin-nav-coverage.test.ts` מפיל פריט ניווט בלי מפתח, מפיל מפתח ש-`getAdminNavGrants()` אינו פותר, ו**מצמיד שהמפתח בתפריט שווה למפתח שהעמוד אוכף לעצמו**. כלומר אם `integrations/page.tsx` ייגמר על `requirePlatformStaff()` בלי מפתח (§3.6) — הפריט חייב להיכנס ל-`NO_PERMISSION_BY_DESIGN` באותה בדיקה, כמו `/admin` ו-`/admin/analytics`, **ולא** לשאת `manage_settings`. הכריעו לפני שכותבים את שניהם, אחרת הבדיקה תתפוס את הסתירה. `isActive` כבר מטפל בתת-עץ.
- [ ] **Step 2:** `next.config.ts` — `redirects()` (§3.4).
- [ ] **Step 3:** grep מלא: `revalidatePath('/admin/channels'|'/admin/templates'|'/admin/alerts')`, `href="/admin/channels"` (למשל `voice/page.tsx:101`, `webhook-detail.tsx:175` הטקסט "לא מוגדר ב-/admin/channels" → "לא מוגדר ב-/admin/integrations/numbers"), `docs/routes-webhooks.md`, `docs/admin-webhooks-runbook.md`.
- [ ] **Step 3b (ספירת שלמות לפני מחיקה):** `grep -c '<AccordionItem' src/app/\(admin\)/admin/channels/channels-client.tsx` = **5**, וספירת `<form>` שאינם בתוך הערות = **10** (`grep -c '<form'` מחזיר 13; שלושה — שורות 408, 409, 464 — יושבים בתוך הערות שמסבירות למה אסור לקנן). לוודא שסך הטפסים והאקורדיונים בקבצים החדשים תואם **לפני** ה-`rm`. חמש שניות שמכסות בדיוק את מחלקת הבאג של `b09240b`.
- [ ] **Step 4a:** `npm run build` (webpack) — לוודא 3 ה-redirects ברשימת ה-routes. **העמודים הישנים נשארים בעץ.** commit `feat(admin): integrations nav + redirects`.
- [ ] **Step 4b (commit נפרד, אחרי פריסה מוצלחת אחת לפחות):** מחיקת `(admin)/channels/**` ו-`(admin)/alerts/**` (10 קבצים; `templates/**` נשאר). הפרדת המחיקה מה-redirect היא מה שהופך את Phase 0 להפיכה בעלות אפס: כשל בפרודקשן נפתר בהסרת שלוש שורות מ-`next.config.ts`, לא ב-revert של פאזה שלמה.
- [ ] **Step 5:** בדיקת דפדפן: 8 העמודים ב-RTL, שני נושאים, טאב-פוקוס; `/admin/channels` מפנה. commit `feat(admin): integrations nav, redirects, retire channels/templates/alerts pages`.

**Gate Phase 0:** `tsc` · lint · `npm test` מלא · build · דפדפן · **הרחבה ידנית של `admin-data-layer-coverage.test.ts`**.

⚠️ **התיישן חלקית 10.9 (§0.3).** הבדיקה **כן** סורקת קבצים חדשים מעצמה מאז: `MODULES = readdirSync('src/lib/data/admin')`, והיא **נופלת סגור** על מודול לא מסווג. גם כל `actions.ts` ו-`route.ts` תחת עץ האדמין נסרקים — Server Action היא endpoint בפני עצמה, ושער העמוד אינו רץ עבורה.

**מה שנשאר נכון:** הסיווג עצמו עדיין ידני. כל קובץ חדש חייב רשומה — מפתח ב-`EXPECTED_PERMISSION` או פטור מנומק ב-`COARSE_GATE_ALLOWED`. ההבדל מול הניסוח הישן: פעם השתיקה עברה בירוק, היום היא מפילה. להוסיף במפורש: `src/lib/data/admin/integrations/index.ts` → `manage_settings`; `…/provider-numbers.ts` → `manage_settings`; `…/whatsapp-numbers.ts` → `manage_settings`; `…/voximplant-numbers.ts` → `manage_voice`. `src/lib/data/provider-numbers-resolve.ts` נשאר **מחוץ** למפות בכוונה — הוא runtime service-role חסר-בקשה, ומגודר ע"י `worker:deps` (רץ אוטומטית ב-`pretest`, `package.json:46`, כלל `worker-no-request-scoped-next` ב-`.dependency-cruiser.cjs:3-6`).

---

### Phase 1 — טבלת המספרים + רשימה קריאה-בלבד · **M**

**Files:** `supabase/migrations/<ts>_provider_numbers_and_roles.sql` (§4.2) · `src/lib/data/admin/integrations/provider-numbers.ts` (DAL admin) · `src/lib/data/provider-numbers-resolve.ts` (runtime, service-role, request-free) · `src/lib/validation/provider-numbers.ts` · `(admin)/integrations/numbers/page.tsx` + `numbers-table.tsx` · `src/lib/data/admin/webhook-inbox.ts:152-187` (resolve business number מול הטבלה) · `src/lib/whatsapp/graph-version.ts` · `src/lib/whatsapp/phone-numbers.ts` (Graph GET) · `src/lib/voximplant/core.ts` (`isAccountPhoneNumber`).

**Interfaces (Produces):**
```ts
export type ProviderKey = 'meta_whatsapp' | 'voximplant' | 'extra_sms' | 'company';
export type NumberRole = 'whatsapp_rsvp_sender' | 'whatsapp_import_sender' | 'voice_caller_id_rsvp'
  | 'voice_caller_id_meeting_confirm' | 'voice_caller_id_sales' | 'voice_caller_id_call_me_now'
  | 'voice_inbound_did' | 'sms_sender' | 'company_contact' | 'business_line_inbound';
// עשרה ערכים — בדיוק כמו ה-CHECK ב-§4.2. `business_line_inbound` נוסף ב-§5.3 אחרי
// הניסוח הראשון והטיפוס לא עקב, בעוד ה-backfill כותב את השורה הזו: בלי התיקון
// `listProviderNumbers` מחזירה ביום הראשון ערך שאינו בטיפוס, `tsc` נשאר ירוק,
// וכל מפת תוויות ממצה משמיטה אותו בשקט. §4.1 ("9 תפקידים") עודכנה ל-10.
export interface ProviderNumber { id: string; provider: ProviderKey; providerRef: string | null; e164: string | null; displayLabel: string | null; isActive: boolean; snapshot: Record<string, unknown> | null; snapshotAt: string | null; source: 'admin'|'backfill'|'sync'; roles: NumberRole[] }
export async function listProviderNumbers(): Promise<ProviderNumber[]>            // manage_settings
export async function upsertProviderNumber(input: UpsertProviderNumberInput): Promise<string> // manage_settings | manage_voice by provider
export async function assignRole(role: NumberRole, numberId: string): Promise<void>
export async function resolveNumberForRole(role: NumberRole): Promise<{ e164: string | null; providerRef: string | null } | null> // service-role, no auth (runtime)
// ⚠️ כבר קיים ונפרס — אין מה לייצר כאן. `export const GRAPH_API_VERSION = 'v25.0' as const`
// ב-src/lib/whatsapp/graph-version.ts: בלי override מ-env, בלי ולידציה, בלי ייבואים
// (מכוון — גם ה-CLI ב-tsx וגם חבילת ה-worker טוענים אותו). **Task 1.3 Step 1 בוצעה
// במלואה:** תשעה מודולים מייבאים היום, ו-graph-version.test.ts סורק את העץ ומפיל כל
// גרסה קשיחה חדשה. `WHATSAPP_GRAPH_VERSION` נמחק מהקוד לגמרי.
```

#### Task 1.1: מיגרציה

- [ ] **Step 1:** `npx supabase migration new provider_numbers_and_roles` → להדביק §4.2.
- [ ] **Step 2:** בדיקה יבשה: `npx supabase db query --linked -f <file-wrapped-in-begin-rollback>`; לוודא 0 שגיאות ו-`select count(*) from provider_number_roles` = **9** בתוך הטרנזקציה (1 whatsapp + 4 קול + `voice_inbound_did` + `sms_sender` + `business_line_inbound` + `company_contact`). **הערך 7 שהופיע כאן במקור נוסח לפני ש-§5.3 הוסיף את `business_line_inbound`, ולפני ש-`voice_inbound_did` שויך ב-backfill** — קריטריון קבלה שהיה נכשל דווקא מול מיגרציה נכונה, הסוג הגרוע ביותר של שער מיושן. אומת בהרצה יבשה 10.9: **4** שורות ב-`provider_numbers`, **9** ב-`provider_number_roles`.
- [ ] **Step 3:** **אישור בעלים** → `npx supabase db push --linked` → `npm run gen:types` → commit `feat(db): provider_numbers + provider_number_roles (backfill from app_settings)`.
- [ ] **Step 4 (הכרעה לפני `db push` — איך מונעים את פער הטיפוס מלחזור).** הרשימה כבר זזה פעם אחת בתוך המסמך הזה: §5.3 הוסיף `business_line_inbound`, ה-backfill כותב את השורה, והטיפוס ב-TS נשאר על 9. זה בדיוק הפער של `workflow_runs.trigger_source` שתועד ב-§0.1 — סכמה שמזמינה הרחבה, בלי מנגנון שאוכף שהקוד יעקוב. שתי דרכים, **הראשונה מומלצת**:

  **(א) `role` כ-enum של Postgres במקום `text + CHECK`** — `create type public.provider_number_role as enum (…)`, ואותו דבר ל-`provider`. אז המנגנון קיים כבר ואינו עולה שורת קוד: `npm run gen:types` פולט את ה-enum ל-`types.generated.ts`, ו-`scripts/check-supabase-types.mjs` — **הצעד הראשון ב-`npm run deploy`** (MEASURED 10.9) — חוסם פריסה על drift. ה-union ב-TS מפסיק להיות מתוחזק ביד: `type NumberRole = Enums<'provider_number_role'>`. זה גם דפוס הבית: `public.app_role`, `public.campaign_channel` ו-8 נוספים הם enums (MEASURED). המחיר זהה ל-CHECK — הוספת ערך היא מיגרציה — וזה **נכון** לחוזה ריצה. ⚠️ אימוץ (א) משנה את ה-SQL ב-§4.2 שכבר עבר הרצה יבשה מאומתת; **יש להריץ אותה שוב** ב-`begin; … rollback;` לפני `db push`.

  **(ב) להישאר ב-CHECK + בדיקת drift** — ריאלי רק כשלב **deploy-time עם גישה ל-DB**: בדיקת vitest הרמטית אינה רואה `CHECK`, כי הוא לא מופיע בטיפוסים הנוצרים. השאילתה, **בדוקה בפועל** (הוחזרו בדיוק עשרת הערכים):

```sql
select array_agg(m[1] order by m[1]) as roles
  from pg_constraint c,
       lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
 where c.conrelid = 'public.provider_number_roles'::regclass
   and c.conname  = 'provider_number_roles_role_chk';
```

  (`pg_get_constraintdef` מרנדר `CHECK ((role = ANY (ARRAY['a'::text, …])))`, ולכן ה-regex מכוון ל-`'…'::text`. `pg_catalog`, לא `information_schema` — ראו [[sb-query-use-pg-catalog-for-constraints]].)

  **חריג שמצדיק מעקב:** `business_line_inbound` הוא תווית תצוגה/תפעול **ללא קורא ריצה**, בניגוד לתשעת האחרים. אם תוויות כאלה יצטברו — לפצל: תפקידי ריצה ב-enum, תגיות תצוגה בעמודה חופשית או ב-`snapshot`. **לא** לפתוח את כל הסט.

#### Task 1.2: DAL + resolver

- [ ] **Step 1: בדיקה נכשלת** `provider-numbers.test.ts`:

```ts
it('listProviderNumbers joins roles onto numbers', async () => {
  mock([{ id: 'n1', provider: 'voximplant', provider_ref: null, e164: '+97237219347', display_label: 'x', is_active: true, snapshot: null, snapshot_at: null, source: 'backfill',
          provider_number_roles: [{ role: 'voice_caller_id_rsvp' }, { role: 'voice_inbound_did' }] }]);
  const rows = await listProviderNumbers();
  expect(rows[0].roles).toEqual(['voice_caller_id_rsvp', 'voice_inbound_did']);
});
it('upsertProviderNumber rejects a non-E.164 value', async () => {
  await expect(upsertProviderNumber({ provider: 'voximplant', e164: '03-7219347', displayLabel: null, providerRef: null }))
    .rejects.toThrow('E.164');
});
```

- [ ] **Step 2:** FAIL. **Step 3:** מימוש: `select('*, provider_number_roles(role)')` דרך `createClient()` (cookie, RLS); `upsert` על `(provider, provider_ref)`; Zod `e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'נא להזין מספר בפורמט E.164 (+972…)')`. `resolveNumberForRole` ב-`provider-numbers-resolve.ts` — `createAdminClient`, `select('provider_numbers(e164, provider_ref)').eq('role', role).maybeSingle()`, מחזיר null על שגיאה (fail-safe, כמו `outreach-config.ts`). **ללא `next/headers`** (worker bundle; `.dependency-cruiser.cjs`).
- [ ] **Step 4:** PASS; `tsc`; lint. commit.

#### Task 1.3: קבוע גרסת Graph + GET מספרים מ-Meta

- [x] **Step 0 — ✅ בוצע 10.9, ואינו חוסם עוד. הטענה שביסודו הופרכה:** `last_onboarded_time` **מתקבל** בכל ארבע הגרסאות, פשוט חוזר ריק (`npm run meta:verify` אחרי שנוסף ל-`FIELD_MATRIX`). הוא נשאר מחוץ לרשימת ה-`fields` — אבל כי שדה שתמיד ריק הוא רעש, לא כי הוא מפיל את הקריאה. הטקסט המקורי נשמר למטה כתיעוד של ההנמקה שהוחלפה. ראו §0.5.
- [ ] ~~**Step 0 (חוסם — לפני שורת קוד):**~~ **`last_onboarded_time` הוסר מרשימת ה-`fields`.** שתי ראיות בלתי-תלויות: (א) §0.0 מדד ששני שדות המיון (`creation_time`, `last_onboarded_time`) ניתנים למיון אך **אינם ניתנים לקריאה כשדות**; (ב) במפרט הרשמי המקומי `openapi/meta/phone-number-management.v25.0.yaml` הוא מופיע **חמש פעמים, כולן תחת פרמטר `sort` בלבד** (שורות 184, 270, 275-278, 279) — ואף לא פעם אחת בסכמת התגובה. אין דרך לקבל את הערך: `sort` מסדר שורות, לא מחזיר שדה. אם צריך את הסדר בלבד — `sort=last_onboarded_time_descending` (הצורה `.desc` שבמפרט **נדחית**, §0.0). **סייג:** עמוד הפרוזה של מטא, שגם הוא מצוטט ב-§0.0, כן מונה אותו כשדה; הסתירה נסגרת בפרוב ולא בהכרעה על הנייר.
- [x] **Step 0b — ✅ בוצע 10.9.** ששת השדות נוספו ל-`FIELD_MATRIX` ב-`scripts/verify-meta-schema.ts` ונבדקו חי מול v23–v26. התוצאה: `quality_rating`, `account_mode`, `is_official_business_account`, `throughput`, `status` — כולם מחזירים ערך; `last_onboarded_time` מתקבל וריק. **אף אחד מהם אינו חוסם.** `quality_rating` הוא הבסיס לבדיקת הבריאות שנבנתה (G10). הטקסט המקורי:
- [ ] ~~**Step 0b (חוסם):**~~ **תשעה מתוך 13 השדות ברשימה מעולם לא נבדקו חי** — `scripts/verify-meta-schema.ts:39-54` מכיל ארבעה בלבד. להוסיף ל-`FIELD_MATRIX` שישה — `last_onboarded_time`, `throughput`, `account_mode`, `is_official_business_account`, `status`, `quality_rating` — ולהריץ `npm run meta:verify`. דירוג סיכון: `last_onboarded_time` **גבוה** (רק תחת `sort`); `throughput` **בינוני** (0 מופעים במפרט, אובייקט מקונן, לא נמדד); `account_mode`/`is_official_business_account` בינוני-נמוך (נמדד עליהם **סינון**, לא קריאה כשדה); `status`/`quality_rating`/`messaging_limit_tier` נמוך; `display_phone_number`/`verified_name` **אפס** (רצים בפרודקשן, `channels.ts:128`); `name_status` אפס (נמדד למרות שאינו מוצהר); `platform_type` נמוך (אליאס מדוד של `host_platform`). זכרו את הכלל של §0.0: **Graph דוחה את כל הבקשה על שדה אחד, והשגיאה מאשימה את החלק הלא נכון.**
- [ ] **Step 0c:** `listWabaPhoneNumbers` נכשלת **רכה**: אם Graph מחזיר `#100` על ה-`fields=` המלא — לנסות שוב עם ליבה מצומצמת (`id,display_phone_number,verified_name,status`) ולהחזיר `{ numbers, degraded: true }` שהעמוד מציג כהערה. מטא הסירה שדות בעבר; שדה אחד שנעלם לא צריך להפיל עמוד שלם.

- [ ] **Step 1:** `src/lib/whatsapp/graph-version.ts`:

```ts
// ⚠️ מיושן — הקובץ שנכתב בפועל שונה: קבוע `as const`, v25.0, בלי override.
const PINNED = 'v24.0'; // proven on this WABA (sent/read statuses 2026-09-03); Meta latest v26.0; v24 sunset 2028-02-18
const override = process.env.WHATSAPP_GRAPH_VERSION;
export const GRAPH_API_VERSION: string = override && /^v\d{2}\.\d$/.test(override) ? override : PINNED;
export const META_LATEST_GRAPH_VERSION = 'v26.0'; // DOCS-ONLY changelog 2026-09-08; display only
```

+ בדיקה. **תיאום:** תוכנית 3.9 מציעה את אותו קובץ; מי שנוחת ראשון — השני משתמש בו. להחליף ב-`channels.ts:89`, `template-health.ts:16`, `whatsapp-import.ts:253`, `client.ts` (4 מקומות) ל-`GRAPH_API_VERSION`. `relocation/*` (v21) — **לא נוגעים** (מחוץ להיקף; רשום ב-§8).
- [ ] **Step 2:** `src/lib/whatsapp/phone-numbers.ts`:

```ts
import 'server-only';
import { GRAPH_API_VERSION } from './graph-version';
export const WABA_PHONE_FIELDS = 'id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type,account_mode,is_official_business_account';
export interface WabaPhoneNumber { id: string; display_phone_number: string; verified_name?: string; status?: string; quality_rating?: string; code_verification_status?: string; name_status?: string; messaging_limit_tier?: string; throughput?: { level?: string }; platform_type?: string; account_mode?: string; is_official_business_account?: boolean; last_onboarded_time?: string }
export async function listWabaPhoneNumbers(creds: { wabaId: string; accessToken: string }): Promise<WabaPhoneNumber[]> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(creds.wabaId)}/phone_numbers?fields=${WABA_PHONE_FIELDS}&limit=50`,
    { headers: { authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Meta phone_numbers fetch failed: HTTP ${res.status}`); // status only, never the body
  const body = (await res.json()) as { data?: WabaPhoneNumber[] };
  return body.data ?? [];
}
```

בדיקה עם `fetch` ממוקק: URL כולל `GRAPH_API_VERSION` ו-`fields`; שגיאה לא כוללת גוף.
- [ ] **Step 3:** `syncMetaNumbers()` ב-DAL: לכל מספר מ-`listWabaPhoneNumbers` → `upsertProviderNumber({provider:'meta_whatsapp', providerRef:id, e164: '+'+display_phone_number.replace(/\D/g,''), snapshot:{verified_name, quality_rating, code_verification_status, name_status, messaging_limit_tier, throughput, platform_type, account_mode, status}, source:'sync'})`. המספר השני (`1298694319994421`) נכנס כך לטבלה **בלי תפקיד** — מוצג "ללא תפקיד" עד שהאדמין משייך `whatsapp_import_sender` (Phase 1.5 בלבד UI; הניתוב עצמו = תוכנית 3.9).
- [ ] **Step 4:** `syncVoximplantNumbers()`: `getPhoneNumbers(cfg.auth)` (קיים) → upsert `provider:'voximplant', providerRef: String(phone_id), e164: '+'+phone_number, snapshot:{activation_status, verification_status, unverified_hold_until, phone_next_renewal, phone_price, application_name, rule_name, is_sms_supported, deactivated, canceled}`. שורת ה-backfill ללא `provider_ref` ממוזגת לפי E.164 (עדכון `provider_ref` על השורה הקיימת כדי שהתפקידים לא יאבדו).
- [ ] **Step 4b:** `syncExtraLines()` (§5.3 סעיף 3): `POST /calls/` דרך `extra-client.ts` (`getCallsHistory`, `pagination.items:100`, עד 3 עמודים עם `next`), `distinct numbers.own.e164` → upsert `provider:'extra_sms'`; מיזוג עם שורת ה-backfill לפי `provider_ref` שווה ל-`friendly`/`e164` מנורמל (`toE164Israel` מ-`company.ts:27`); snapshot בלי PII (רק `forwards_to_last4`). בדיקה: 2 עמודים ממוקקים עם אותו קו → שורה אחת.
- [ ] **Step 5:** actions `syncProviderNumbersAction(provider)` (`manage_settings` / `manage_voice`), `logActivity({action:'admin.integrations.numbers_synced', meta:{provider, count}})`.

#### Task 1.4: עמוד המספרים + שילוב ב-`/admin/webhooks`

- [ ] **Step 1:** `numbers/page.tsx` (`manage_settings`) + `numbers-table.tsx` (Server; `Table` מ-ui; מספרים `dir="ltr"`; chips תפקידים; snapshot כ-`dl` מקופל ב-`Accordion`; כפתורי "סנכרן" לכל ספק). מסנן `?provider=`.
- [ ] **Step 2:** `webhook-inbox.ts:152-187` — להחליף את קריאת `app_settings.whatsapp_phone_number_id` ב-`select provider_numbers where provider='meta_whatsapp' and provider_ref = item.phone_number_id` → `businessNumber = { label: display_label ?? roles.join(', ') ?? 'מספר ללא תפקיד', phoneNumberId }`; ללא התאמה → `null` (הטקסט "לא מוגדר ב-/admin/integrations/numbers" — G2 נסגר).
- [ ] **Step 3:** `labels.ts` — תוויות ל-`security` ("אירוע אבטחה (Meta)"), `business_username_updates` ("עדכון username"), `messages_other` (G15).
- [ ] **Step 4:** בדיקות (`webhook-inbox.test.ts` קיים — להוסיף מקרה "unknown number"), `tsc`, lint, build, דפדפן. commit.

**Gate Phase 1:** אחרי deploy — לחיצה על "סנכרן מ-Meta" מציגה 2 מספרים עם `display_phone_number`; "סנכרן מ-Voximplant" מציג את ה-DID עם `phone_next_renewal`; `/admin/webhooks?inspect=<row of 1298…>` מציג את התווית החדשה.

---

### Phase 2 — WhatsApp: הוספה, אימות, רישום · **M**

**Files:** `src/lib/whatsapp/phone-numbers.ts` (+ `addWabaPhoneNumber`, `requestCode`, `verifyCode`, `registerNumber`, `deregisterNumber`, `setDisplayName`, `debugToken`) · `src/lib/data/admin/integrations/whatsapp-numbers.ts` · `(admin)/integrations/meta-whatsapp/numbers-wizard.tsx` + `numbers-actions.ts` · `src/lib/validation/whatsapp-numbers.ts`.

#### Task 2.1: אימות תיעוד לפני קידוד (חובה)

- [ ] `npx ctx7@latest docs /websites/developers_facebook_business-messaging_whatsapp "POST WABA_ID phone_numbers request body cc phone_number verified_name required"` — לתעד בקובץ הזה (§5.1) איזו צורה נכונה; אם עדיין סותר → `cc`+`phone_number`+`verified_name` (הדוגמה המלאה). לוודא גם `request_code`/`verify_code`/`register` (מאומתים היום ב-WebFetch).

#### Task 2.2: לקוח Graph

```ts
export async function addWabaPhoneNumber(creds, input: { cc: string; nationalNumber: string; verifiedName: string }): Promise<{ id: string }>
export async function requestCode(creds, phoneNumberId: string, input: { codeMethod: 'SMS'|'VOICE'; language: string }): Promise<void>
export async function verifyCode(creds, phoneNumberId: string, code: string): Promise<void>
export async function registerNumber(creds, phoneNumberId: string, pin: string): Promise<void>   // body { messaging_product:'whatsapp', pin }
export async function deregisterNumber(creds, phoneNumberId: string): Promise<void>
export async function setDisplayName(creds, phoneNumberId: string, newDisplayName: string): Promise<void> // POST /{pnid}?new_display_name=
export async function debugToken(input: { appId: string; appSecret: string; token: string }): Promise<{ isValid: boolean; expiresAt: number | null; dataAccessExpiresAt: number | null; scopes: string[] }>
```

- [ ] בדיקות עם `fetch` ממוקק לכל פונקציה: URL/גוף מדויקים; PIN ו-token לעולם לא בהודעת שגיאה; `133016` ממופה ל-`'RATE_LIMITED_72H'`.
- [ ] `debugToken` — Authorization = `Bearer ${appId}|${appSecret}` (app access token, DOCS-ONLY). דורש `whatsapp_app_id` (§4.4) — מיגרציה קטנה `app_settings add column whatsapp_app_id text` + שדה בטופס Meta (Zod `^\d{10,20}$`).

#### Task 2.3: Zod + actions (Owner-gated היכן שצריך)

```ts
export const addNumberSchema = z.object({
  cc: z.string().regex(/^\d{1,3}$/, 'קידומת מדינה (972)'),
  nationalNumber: z.string().regex(/^\d{7,12}$/, 'ספרות בלבד, בלי קידומת'),
  verifiedName: z.string().trim().min(2).max(75), // 2–75 לפי המפרט הרשמי (לא 512)
});
export const requestCodeSchema = z.object({ phoneNumberId: z.string().regex(/^\d+$/), codeMethod: z.enum(['SMS','VOICE']), language: z.enum(['he','en']) });
export const verifyCodeSchema = z.object({ phoneNumberId: z.string().regex(/^\d+$/), code: z.string().regex(/^\d{6}$/, '6 ספרות') });
export const registerSchema = z.object({ phoneNumberId: z.string().regex(/^\d+$/), pin: z.string().regex(/^\d{6}$/, 'PIN של 6 ספרות'), confirm: z.literal('REGISTER') });
```

- `addNumberAction`, `requestCodeAction`, `verifyCodeAction`: `manage_settings`; `registerAction`, `deregisterAction`, `setDisplayNameAction`: `requirePlatformOwner()`. כל אחד: `logActivity({ action: 'admin.whatsapp.number_<op>', meta: { phoneNumberId } })` + Slack `security` (register/deregister). אחרי `add`/`verify`/`register`: `syncMetaNumbers()`.
- **PIN:** לא נשמר לעולם; ההודעה למשתמש מסבירה שזה PIN האימות הדו-שלבי של המספר ושכישלון PIN ×N נועל את המספר אצל Meta.

#### Task 2.4: אשף UI

Client component ב-Sheet (`side="right"`, DirectionProvider כבר ב-`AdminShell`): שלבים **הוסף → קבל קוד (SMS/VOICE, שפה) → אמת קוד → רשום (PIN + הקלדת `REGISTER`)**; כל שלב `useActionState` נפרד; שלב "רשום" מוצג רק ל-Owner (prop `isOwner` מהשרת — `isPlatformOwner()` הקיים ב-`src/lib/auth/dal.ts:74`, MEASURED; ה-action עצמו נשאר מגודר ב-`requirePlatformOwner` — הסתרת ה-UI אינה השער). הצגת האילוצים (§5.1) כ-`Alert` לפני "הוסף". מגבלת `133016` מוצגת כשגיאת שדה עם "נסו שוב בעוד 72 שעות".

#### Task 2.5: כרטיס סטטוס Meta מורחב

`getMetaStatus()` (DAL, `manage_settings`): `debugToken` (cache 10 דק' ב-`unstable_cache`? — לא; קריאה ישירה, הכרטיס נטען בעמוד אחד בלבד) → `is_valid`, `expires_at` ("ללא תפוגה" כשהערך 0), `scopes` (בדיקה ש-`whatsapp_business_management`, `whatsapp_business_messaging`, `business_management` קיימים — הרשימה מ-`channels-client.tsx:358`) + `GRAPH_API_VERSION` מול `META_LATEST_GRAPH_VERSION` + שורת "אפליקציית Meta": `GET /{app-id}?fields=name,privacy_policy_url,terms_of_service_url,user_support_email,app_domains` (DOCS-ONLY; לאמת ב-ctx7) ורשימה סטטית "נבדק ידנית ב-Meta Dashboard/MCP: contact email verified, data deletion URL, App Review" עם הערכים שנמדדו היום ב-§2 G8 כ-placeholder שהבעלים מעדכן? — **לא** (כלל "אין placeholder שמזדקן"). מציגים רק מה שנקרא חי + קישור לדשבורד.

**Gate Phase 2:** בדיקה חיה = הוספת המספר **הקיים** `+972 3-330-1505` תיכשל צפוי ("already in use") — זה בסדר; בדיקת `debugToken` על הטוקן החי מציגה `is_valid=true`. **אין** register/deregister בבדיקה (מגבלת 10/72h).

---

### Phase 3 — Voximplant: רשימה, קישור, רכישה מאחורי אישור · **L**

**Files:** `src/lib/voximplant/core.ts` (+ `getNewPhoneNumbers`, `getPhoneNumberCategories`, `getPhoneNumberRegions`, `getPhoneNumberCountryStates`, `isAccountPhoneNumber`, `getAvailableRegulations`, `getRegulationsAddress`) · `src/lib/voximplant/mutations.ts` (+ `attachPhoneNumber`, `bindPhoneNumberToApplication`, `deactivatePhoneNumber`) · `src/lib/voximplant/cli-guard.test.ts` (מצמיד שהחדשים ב-mutations לא נגישים ל-CLI) · `src/lib/data/admin/integrations/voximplant-numbers.ts` · `(admin)/integrations/voximplant/numbers-panel.tsx` + `buy-number-dialog.tsx` + `numbers-actions.ts`.

#### Task 3.1: מדידת תפקיד ה-service account (לפני UI)

- [ ] `testVoximplantCapabilities()` (DAL, `manage_voice`): קורא `GetPhoneNumbers` (כל התפקידים), `GetPhoneNumberCategories` (Payer+), `GetNewPhoneNumbers` בלי locators (Owner/Admin/Accountant), `GetAvailableRegulations('IL','GEOGRAPHIC')` (Owner/Accountant). כל תשובה `403`/error code → `capability: false`. התוצאה נשמרת ב-snapshot של הספק (`app_settings`? לא — ב-`provider_numbers`? לא) — **ב-`unstable_cache` ל-10 דקות + כפתור רענון**; ה-UI מציג לכל פעולה "זמין / דורש תפקיד Owner בפאנל Voximplant".

#### Task 3.2: עטיפות API

`core.ts` (read-only, אותו סגנון של `getPhoneNumbers`):

```ts
export interface NewPhoneInfo { phone_id: number; phone_number: string; phone_price: number; phone_tax_reserve: number; phone_installation_price: number; phone_installation_tax_reserve: number; phone_period: string; phone_category_name: string; phone_country_code: string; phone_region_name: string }
export function getNewPhoneNumbers(config, params: { country_code?: string; phone_category_name?: string; phone_region_id?: number; phone_number_mask?: string; count?: number }, timeoutMs?)
export interface PhoneRegionInfo { phone_region_id: number; phone_region_name: string; phone_region_code: string; account_price?: number; account_installation_price?: number; account_currency?: string; phone_count: number; is_need_regulation_address?: boolean; regulation_address_type?: string; is_sms_supported: boolean }
export function getPhoneNumberRegions(config, params: { country_code: string; phone_category_name: string }, timeoutMs?)
export function isAccountPhoneNumber(config, phoneNumberNoPlus: string, timeoutMs?): Promise<{ result: boolean }>
export function getAvailableRegulations(config, params: { country_code: string; phone_category_name: string; phone_region_code?: string })
```

`mutations.ts` (body בנוי inline, אין spread של קלט — כמו `setAccountCallbackUrl`):

```ts
// Israel supports the CATALOG mode only (§5.2). `phone_count` is pinned to 1 in the
// body and never derived from input — that, plus the quoted price and the typed
// confirmation, is the money guard. Refusing the catalog mode outright would refuse
// the only country we operate in.
export function attachPhoneNumber(config, params: { country_code: string; phone_category_name: string; phone_region_id: number; regulation_address_id?: number }, timeoutMs?)
export function bindPhoneNumberToApplication(config, params: { phone_id: number; application_id: number; bind: boolean; rule_id?: number }, timeoutMs?)
export function deactivatePhoneNumber(config, phoneId: number, timeoutMs?)
```

- [ ] בדיקות: `cli-guard.test.ts` — הרשימה החדשה; `mutations.test.ts` — גוף מדויק לכל אחת; `attachPhoneNumber` **מקבע `phone_count: 1`** בגוף הבקשה ואינו גוזר אותו מהקלט (הגנה מרכישת כמות).

#### Task 3.3: זרימת רכישה מאחורי אישור

DAL (`manage_voice` לקריאה; `requirePlatformOwner` ל-`purchase`):
1. `quoteNumber(regionId, mask?)` → `getPhoneNumberRegions('IL', category)` + `getNewPhoneNumbers(...)` → מחזיר לכל מועמד `{ e164, monthly: phone_price + phone_tax_reserve, installation: phone_installation_price + phone_installation_tax_reserve, currency: account_currency, needsRegulation: is_need_regulation_address, regulationStatus }` — **הצגת המחיר היא תנאי לכפתור**.
2. אם `needsRegulation && !getAvailableRegulations().result` → הכפתור נעול עם "יש ליצור כתובת רגולציה ב-Control Panel" (§5.2 UNVERIFIED).
3. `purchaseNumberAction(fd)` — Zod `{ e164, confirmE164 (חובה זהה), acknowledgeCost: z.literal('on'), regulationAddressId? }`; `requirePlatformOwner`; `attachPhoneNumber({ phone_number: e164NoPlus, regulation_address_id })`; upsert ל-`provider_numbers` (`source:'admin'`, snapshot מהתשובה); `logActivity('admin.voximplant.number_purchased', { e164, monthly, installation, currency })`; Slack `security` warn "Voximplant number PURCHASED".
4. `bindNumberAction` — `manage_voice`; `bindPhoneNumberToApplication({ phone_id, application_id: Number(app_settings.voximplant_application_id), bind: true })` **בלי `rule_id`** עד Task 3.4; snapshot מתעדכן.
5. `deactivateNumberAction` — `requirePlatformOwner`; מוצג רק אם Task 3.1 מדד יכולת; AlertDialog עם הקלדת המספר.

UI: `AlertDialog` (קיים) עם טבלת מחיר, checkbox "אני מאשר חיוב של X ₪/חודש + Y ₪ התקנה", שדה הקלדת המספר. **לא** `window.confirm`.

#### Task 3.4: DID חדש → route-inbound (אימות חי, לא קוד)

- [ ] אחרי bind של מספר בדיקה (או שימוש במספר הקיים): הבעלים מחייג ל-DID; לבדוק ב-`console_calls` שנוצרה שורה דרך `route-inbound`. אם לא — להוסיף rule pattern ב-`rules.config.json` ו-`voxengine-ci upload` (בעלים). התוצאה מתועדת כאן; רק אז הפאנל מציע `rule_id: 1494687` ב-bind.

**Gate Phase 3:** `npm test` (כולל cli-guard) · build · **אין** רכישה בבדיקה; ה-`quote` מוצג ומראה מחיר אמיתי; ה-`bind` נבדק על ה-DID הקיים (idempotent); בדיקת יחידה שמצמידה `phone_count: 1` בגוף של `attachPhoneNumber`.

---

### Phase 4 — caller id לכל פרסונה · **M**

**Files:** `src/lib/data/voximplant-config.ts` (`getVoximplantConfig`, `getPersonaDispatchConfig`) · `src/lib/data/console-calls.ts` / `call-me-now` (היכן שנקרא caller id — grep `callerId` במשימה) · `(admin)/integrations/voximplant/voximplant-personas.tsx` (select מספר לכל פרסונה) · `src/lib/data/admin/integrations/provider-numbers.ts` (`assignRole`).

- [ ] **Step 1 (בדיקה):** `voximplant-config.test.ts` — כאשר `resolveNumberForRole('voice_caller_id_sales')` מחזיר `+972…B`, `getSalesCallDispatchConfig().callerId === '+972…B'`; כאשר מחזיר null → fallback ל-`voximplant_caller_id`.
- [ ] **Step 2:** ב-`getVoximplantConfig`: `const callerId = (await resolveNumberForRole('voice_caller_id_rsvp'))?.e164 ?? str(row,'voximplant_caller_id')`; ב-`getPersonaDispatchConfig(enabledColumn, ruleIdColumn, role)` — אותו דפוס. **Fail-closed נשמר:** אם שניהם ריקים → `null` (הערוץ כבוי).
- [ ] **Step 3:** UI: בכל כרטיס פרסונה `select` (native, `compactSelectClass`) של מספרי `voximplant` פעילים; action `assignCallerIdAction(persona, numberId)` (`manage_voice`; Zod enum על 4 הפרסונות; בודק שהמספר `provider='voximplant'` ו-`is_active`); `logActivity` + Slack `security` info.
- [ ] **Step 4:** בדיקת שיחה אחת לכל פרסונה שהשתנתה (הבעלים) — ה-`from` בשיחה = המספר שנבחר.
- [ ] **Step 5 (ניקוי, מיגרציה נפרדת, ≥2 שבועות אחרי):** `voximplant_caller_id` → מסומן deprecated ב-comment; מחיקה רק אחרי שהבעלים מאשר שאין fallback בשימוש (`activity_log` לא הראה fallback).

---

### Phase 5 — בריאות וריאנטים, כיסוי webhooks, מדיניות שליחה, drift · **M**

#### Task 5.1: בריאות וריאנטים
- [ ] **בניית רשימת הווריאנטים יורשת את הסינון הקיים** של `runTemplateHealthSync`: `.eq('channel','whatsapp').neq('name','')` (`src/lib/data/template-health-sync.ts:29-33` — הנתיב הוא `src/lib/data/`, **לא** `src/lib/whatsapp/`). מדוד 10.9: מתוך תשע השורות ב-`message_templates` אחת היא `channel='call'` (`call_1`, `name=''`); בלי הסינון היא נכנסת ל-`message_template_variant_health` עם `variant_name=''`, לא נמצאת אצל מטא, ומייצרת התראת `NOT_FOUND` **בכל סנכרון, לנצח**.
- [ ] מיגרציה §4.3. `template-health-sync.ts`: אחרי `fetchTemplateHealth` — לכל שורה לבנות רשימת `{variant_name, language, kind, event_type}` מ-`name` + `components.variants[*]` + `media_variants[*]` + `media_variant`; להתאים מול `metaTemplates` (name+language); `upsert` ל-`message_template_variant_health`; התראה `send_health` על **מעבר** ל-`category !== requested_category`/`RED`/`REJECTED|DISABLED` לפי הערך הקודם בטבלה (אותו כלל של המצביע, `template-health-sync.ts:86-101`). וריאנט שלא נמצא ב-Meta → `meta_status='NOT_FOUND'` + התראה (זה בדיוק המקרה שנשלח לתבנית שלא קיימת → `132001`).
- [ ] `templates-client.tsx`: מתחת ל-`TemplateHealth` טבלה קטנה של הוריאנטים (`listVariantHealth(templateId)`).
- [ ] בדיקות: `template-health-sync.test.ts` (קיים) — מקרה עם 2 וריאנטים, אחד חסר.

#### Task 5.2: תור הסנכרון ב-ops
- [ ] `queue-schedule.ts` — `'whatsapp-template-health-sync': 3 * 24 * 60`; `integrations.ts` WhatsApp → `lastCheckedAt: lastCompletedFor(jobHealth, 'whatsapp-template-health-sync'), healthCheckAvailable: true`. בדיקה ב-`summary.test.ts`.

#### Task 5.3: מדיניות שליחה (`whatsapp_send_policy`)
- [ ] DAL `getSendPolicyForAdmin/updateSendPolicy` (`manage_settings`); action עם `sendPolicySchema` ואז `parseSendPolicy` (זורק על חריגה מהתקרות → `fieldErrors._root`). UI: 7 שורות (א׳–ש׳) עם `start/end` (`type="time"`), `hardCap`, `motzashPlusMin`, `preferredTimeByDaysBefore` (3 שורות), `spreadSpanMs` בדקות. שבת נעולה `null`.

#### Task 5.4: כיסוי webhooks + topic זר
- [ ] `getWebhookSubscriptions()` — `GET /{whatsapp_app_id}/subscriptions` עם app token (`appId|appSecret`); טבלה: שדה · מנוי? · מטופל (`HANDLED_WHATSAPP_KINDS` = הרשימה מ-`webhook-processing.ts` + מיפוי `field→kind` מ-`route.ts:61-66`) · "נשמר גנרית". topic שאינו `whatsapp_business_account` → Badge "מנוי זר" + כפתור "הסר מנוי" (Owner) — **לפני קידוד ה-DELETE: אימות ctx7** של `DELETE /{app-id}/subscriptions?object=…`.

#### Task 5.5: אישור drift קטגוריה (D4)
- [ ] action `acknowledgeCategoryAction(templateId)` (`manage_settings`): `requested_category = category` + `logActivity('admin.templates.category_acknowledged', { message_key, from, to })`. כפתור מופיע רק כאשר `downgraded`.

#### Task 5.6: ניטור מפתח ExtrA
- [ ] תור `extra-key-check` (`QUEUES.extraKeyCheck = 'extra-key-check'`, יומי `10 3 * * *` Asia/Jerusalem) → `getAuthKey`; Slack `send_health` כאשר `valid=false` או `expireAt - now < 30d`; `queue-schedule.ts` `'extra-key-check': 3 * 24 * 60`; `integrations.ts` ExtrA → `healthCheckAvailable: true, lastCheckedAt: lastCompletedFor(jobHealth,'extra-key-check')`. בדיקה: expire בעוד 20 יום → התראה; 200 יום → שקט.

**Gate Phase 5:** `npm test` מלא · build · הרצה ידנית של `runTemplateHealthSync` דרך כפתור "הרץ סנכרון עכשיו" (action חדש, `manage_settings`) ובדיקה ש-**36** שורות נכנסו ל-`message_template_variant_health` (מדוד 10.9: 8 מצביעי whatsapp — מתוך 9 שורות, `call_1` מסונן — ועוד 24 מפתחות `variants`, 3 `media_variants` ו-1 `media_variant`. הערך 28 שהופיע כאן קודם ספר את הווריאנטים בלבד, בלי המצביעים); כרטיס ExtrA מציג "פוקע 2027-10-27".

---

### Phase 6 (אופציונלי, דורש החלטה D9) — שיחות שלא נענו בקו העסק → פנייה/בקשת חזרה · **M**

**מוטיבציה (MEASURED, team-lead):** 7 שיחות `incoming_missed` לקו `03-3301505` לא מגיעות ל-KALFA בשום צורה; 39 נכנסות עונות במכשיר של הבעלים בלי רישום במערכת.

**שתי דרכים לקלט (DOCS-ONLY):** (א) **polling** — `getCallsHistory` עם `call_types: ['incoming_missed']`, `time.from = last_seen`, תור pg-boss כל 10 דק' (`extra-missed-calls-sweep`, ב-`QUEUE_EXPECTED_MAX_MINUTES` 30); (ב) **automations webhook** — המפרט מציין ש-`Call` הוא "the same shape as the automations webhook POST payload" ו-`AI` מגיע ב-`AI-DONE` webhook, אבל **אינו מתעד** את הגדרת ה-webhook (URL, חתימה, retry) → הגדרה בפורטל, ואימות המקור חייב להיות טוקן סודי ב-path (דפוס `/api/voximplant/account-callback/[token]` הקיים). **מומלץ להתחיל ב-(א)** — אין תלות בפורטל, ואין משטח ציבורי חדש.

- [ ] Task 6.1: `provider:'extra_sms'` snapshot כבר סופר `missed_30d` (Phase 1.3); כרטיס ExtrA מציג "שיחות שלא נענו (30 יום)" + קישור לפאנל השיחות.
- [ ] Task 6.2 (D9): sweep → לכל `incoming_missed` חדשה: `numbers.caller.e164` (PII — לא בלוגים; `ANONYMOUS` נדחה), יצירת `callback_requests` בערוץ חדש `source:'extra_missed_call'` דרך ה-DAL הקיים של הפניות (`callback-scheduling.ts` — לאמת חתימה במשימה), dedupe לפי `call.id` (עמודה `external_ref`), `contact_messages` לא נוצר. Slack `customer_inquiry` (כבר קיים לבקשות חזרה).
- [ ] Task 6.3 (D9): לשיחות שנענו במכשיר עם `AI !== false`: `getCallAi(id)` → `summary.gist/body/next_steps` לשרשור הפנייה; קישור הקלטה דרך `getRecordingUrls` עם `ttl: 10` (signed) **בזמן צפייה בלבד**, לעולם לא `ttl: 0`, לעולם לא נשמר URL.
- [ ] גבולות: ספאם/פרטיות — שיחה נכנסת של לקוח אינה הסכמה לשיווק; הפנייה שנוצרת היא "בקשת חזרה" (עסקית, לא דבר פרסומת) — לאישור israeli-compliance-advisor לפני D9.

---

## 7. אימות

| פאזה | בדיקות יחידה | בדיקה חיה (בעלים/דפדפן) | נקודות ביקורת אבטחה |
|---|---|---|---|
| 0 | כל `actions.test.ts` שהועברו + 8 בדיקות רינדור עמודים + `settings.test.ts` מצומצם + `admin-data-layer-coverage.test.ts` | 8 עמודים ב-RTL/2 נושאים; redirects; שמירה בכל טופס משנה רק את השדות שלו (לבדוק ב-DB שאין איפוס של מתגים אחרים — הסיכון של `keepMounted`) | אין סוד חדש ב-props; `outreach_enabled` עדיין כותב יחיד (grep `outreach_enabled:` ב-`src/lib/data/admin` = קובץ אחד); **כל DAL חדש נרשם ב-`EXPECTED_PERMISSION`** — בלעדיו השער אינו סורק אותו כלל; **האינדקס אינו מושך סודות** כדי לגזור בוליאני |
| 1 | DAL + resolver + `graph-version` + `phone-numbers` (fetch ממוקק) + `webhook-inbox` unknown-number | סנכרון Meta/Voximplant; `/admin/webhooks` על שורה של המספר השני | **מחיקת מספר שמחזיק תפקיד מוחזרת כשגיאה ידידותית, לא כהודעת foreign key**; `provider-numbers-resolve.ts` request-free (dependency-cruiser); RLS: `select` כ-`authenticated` שאינו admin מחזיר 0 שורות (`npx supabase db query` עם `set role authenticated; set request.jwt.claims…` — לפי skill `querying-live-supabase`) |
| 2 | 7 פונקציות Graph (URL/גוף/מיפוי שגיאות) + Zod + actions (Owner gate נבדק: מוקק `requirePlatformOwner` זורק → action מחזיר error) | `debugToken` על הטוקן החי; ניסיון "הוסף" של מספר קיים נכשל בחן | PIN/טוקן לא בלוגים/הודעות; `register` מוגבל Owner; מגבלת 10/72h מוצגת |
| 3 | `cli-guard` + `mutations` + `core` + quote/purchase actions (mock) | Task 3.1 capabilities; quote אמיתי; bind על DID קיים; Task 3.4 שיחה נכנסת | `attachPhoneNumber` ללא מצב קטלוג; Owner gate; `logActivity` + Slack על רכישה |
| 4 | `voximplant-config.test.ts` fallback | שיחה אחת לכל פרסונה | fail-closed נשמר (null כששניהם ריקים); **`npm run worker:deps`** (רץ אוטומטית ב-`pretest`) — Phase 4 מכניסה את `resolveNumberForRole` ל-`voximplant-config.ts`, מודול שה-worker מגיע אליו |
| 6 | sweep dedupe לפי `call.id`; מיפוי `incoming_missed` → `callback_requests` | שיחה שלא נענתה אחת מקצה לקצה | `numbers.caller.e164` לא בלוגים ולא ב-snapshot; `getRecordingUrls` לעולם לא `ttl: 0` |
| 5 | `template-health-sync` וריאנטים; `summary.test.ts`; `send-policy` action (חריגה מהתקרה נדחית); subscriptions parse | סנכרון ידני; עריכת חלון שליחה → `parseSendPolicy` דוחה 21:30 | app token = `appId|appSecret` נשאר בשרת; אין שינוי בנתיבי הטוקן הציבוריים (`/r`, `/g`, `/ty`, ctx/cb) — **לא נוגעים בהם בכלל** |

**כללי:** לפני כל פאזה `git status` נקי; אחרי — `npx tsc --noEmit && npm run lint && npm test && npm run build`; deploy ע"י הבעלים בלבד; אימות חי ב-beta.

---

## 8. סיכונים ומגבלות

1. **כסף:** `AttachPhoneNumber` שומר מראש דמי חודש הבא + מסים (DOCS-ONLY); מגודר Owner + הקלדה + מחיר. אין undo — `DeactivatePhoneNumber` הוא Owner-only ואולי לא זמין ל-service account.
2. **נעילת מספר ב-Meta:** `register`/`deregister` — 10 בקשות/72 שעות (`133016`); PIN שגוי חוזר נועל. לכן Owner-only, הקלדת `REGISTER`, ואין בדיקה חיה של register.
3. **פיצול הטופס היחיד של settings:** `keepMounted` היה load-bearing — checkbox לא-מוצג נקרא כ-false. הפיצול ל-4 טפסים נפרדים מבטל את הסיכון הזה **בתוך** כל טופס, אבל כל schema חדש חייב לכלול את **כל** השדות של הטופס שלו (בדיקה 0.2 מצמידה).
4. **תפקיד ה-service account ב-Voximplant לא ידוע** (Attach = Owner/Admin/Accountant; Deactivate = Owner). Task 3.1 מודד לפני שה-UI מבטיח.
5. **אותו E.164 בכמה ספקים** — המודל מאפשר (unique על `(provider, provider_ref)`); UI חייב להבהיר שזה מכוון (INFERRED: `+972 3-721-9347` = Voximplant DID/caller id = WhatsApp RSVP).
6. **תיעוד Meta סותר** על גוף `POST /{waba}/phone_numbers` — Task 2.1 חובה. `DELETE subscriptions` — UNVERIFIED.
7. ⚠️ **טוקן אישי ולא System-User — אומת, וחוסם את Task 1.3 ואילך, לא את Phase 0.** Phase 0 היא הזזת רכיבים ופיצול סכמות ואינה פונה ל-Meta ולו פעם אחת; הקריאה הראשונה היא `syncMetaNumbers` ב-Task 1.3. הניסוח הקודם ("חוסם Phase 0", וגם ב-§0.0) הוביל לאחת משתי טעויות: המתנה לשווא, או פסילת התוכנית כולה. מדוד ב-`debug_token`: הטוקן הוא USER ולא System User, `expires_at: 0`, `data_access_expires_at = 2026-12-07` (לא 2.12) — **88 יום מ-10.9**. ההרשאות רחבות מדי (`ads_management`, `ads_read`, `pages_*`).
8. ✅ **נסגר — רגולציה IL:** כתובת מאומתת קיימת (id 1418, VERIFIED). ההערה המקורית: `is_need_regulation_address` לא נמדד ל-IL; יצירת כתובת רגולציה — אין מתודה ידועה → Control Panel.
9. **היגיינת grants:** `message_templates` מעניקה ל-`anon` ALL (RLS חוסם; אין policy ל-anon) — לא בהיקף, להעביר ל-rls-schema-engineer.
10. ✅ **נסגר — `relocation/*` כבר על `GRAPH_API_VERSION`.** מדוד 10.9: `preflight.ts:722` ו-`external.ts:203` מייבאים את הקבוע (v25.0) מאז G5. אין חוב לרשום ב-`docs/product-debt.md`.
11. **Redirect 307 ולא 308** — כדי לא לקבע בדפדפנים לפני שהבעלים מאשר את ה-IA הסופית.
12. **Nav visibility ≠ gate — ומ-10.9 הניווט גם מסונן.** ההצהרה הקודמת ("כל admin רואה אינטגרציות") אינה נכונה עוד: כל פריט ב-`NAV_GROUPS` נושא `permission`, `getAdminNavGrants()` פותר בשרת והלקוח מסנן (§0.3). **הכלל עצמו לא השתנה** — קישור מוסתר עדיין ניתן להקלדה והעמוד הוא שמסרב. מה שהשתנה: מי שאין לו הרשאה כבר לא רואה קישור שרק יעיף אותו מהפאנל אל `/app`.
13. **מפתח ExtrA:** `getAuthKey` מחזיר את המפתח בגוף התגובה — הקליינט חייב להשליכו (בדיקה מצמידה). המפתח החי הוא legacy ללא scopes ("may do everything the account may") ופוקע 2027-10-27 — ניטור ב-Task 5.6.
14. **הקלטות ExtrA:** `getRecordingUrls` עם `ttl: 0` יוצר URL ציבורי לצמיתות — אסור; רק signed (≤10 דק') בזמן צפייה.
15. **`Call.numbers.caller.e164` הוא PII של לקוח** (Phase 6) — לא בלוגים, לא ב-snapshot; רק `forwards_to_last4` של מכשיר הבעלים נשמר.

---

## 9. שאלות פתוחות לבעלים

1. D1–D8 לעיל (ברירות המחדל מסומנות).
2. האם המספר `+972 3-330-1505` אמור להיות **גם** מספר הייבוא ב-WhatsApp **וגם** שולח ה-SMS **וגם** טלפון החברה בהסכם — או שזה מקרי? (משפיע על תוויות ב-`provider_numbers` ועל D2.)
3. ✅ **נענה 9.9 — כן.** `GetPhoneNumbers` מחזיר מספר יחיד: `97237219347`, `phone_id` 2303422, TEL AVIV, ACTIVE, אפליקציה 11107202, ללא `rule_id`. חידוש 14.9.2026, 5$/חודש.
4. ✅ **נענה 9.9 — Owner** (`GetKeyRoles` → role_id 1). רכישה, קישור וביטול אפשריים מהפאנל. אושר בפועל: `GetRegulationsAddress` (Owner/Accountant) הצליח.
5. **עדיין פתוח — וזה חוסם שלוש משימות, לא שתיים.** מדוד שוב 10.9: `whatsapp_app_id` אינה קיימת ב-`app_settings`; `META_APP_ID_WA` יושב ב-`.env.local` בלי אף קורא. תלויות: Task 2.2 (`debugToken`), **Task 2.5 (כרטיס סטטוס Meta — נשען כולו על `debugToken` ועל `GET /{app-id}`)**, ו-Task 5.4 (מנויי webhook). **מומלץ:** עמודה ב-`app_settings` + שדה בטופס Meta — עקבי עם `whatsapp_waba_id` שגם הוא מזהה ולא סוד, וניתן להחלפה בלי פריסה. החלופה: קריאה מ-env.
6. תוכנית 3.9 (פיצול ניתוב ייבוא): לבצע **אחרי** Phase 1 עם תפקיד `whatsapp_import_sender` (מומלץ), או במקביל עם העמודות שהוצעו שם?
7. הצד המשפטי: caller id שונה לפרסונת המכירות — האם צריך להופיע בהסכם/מדיניות (israeli-compliance-advisor)?
8. **הסכמת וואטסאפ — מה המדיניות מכאן?** מדוד 9.9: ל-38 אנשי קשר יש `whatsapp_consent_at`, **כולם עם חותמת זמן זהה** (2026-07-07 11:19:15) — כלומר כתיבה אחת בכמות לפני קמפיין הברית, לא 38 אירועי הסכמה. `recordWhatsAppConsent` קיימת ואין לה אף קורא. מאז 9.9 יש מתג `whatsapp_consent_required` (כבוי כרגע), אבל השאלה נשארת: לחווט הסכמה אמיתית לנקודה בזרימה, להמשיך ברישום ידני לפני כל קמפיין, או לקבוע שההזמנה עצמה מהווה הסכמה. **שאלה עסקית-משפטית — לא טכנית.**
9. ✅ **נענה 10.9 — התוכן נשאר, הבריאות עוברת.** ההנמקה והמדידות בסוף §3.3. נותרה החלטת נתונים אחת: האם למחוק את שורת `call_1` הריקה והכבויה (מומלץ) — **שינוי בייצור, דורש אישור.**
10. ✅ **נענה 10.9 — ואז השתנה באותו יום: שני הצירים מוזגו.** התשובה הראשונה (למטה) הייתה נכונה למדידה שלה ושגויה בהמשכה — "השאלה נותרת רלוונטית רק כשיתווסף חבר צוות שאינו owner" **קרה כמה שעות אחר כך**. הבעלים הקצה `חיוב וגבייה` ל-`yaakov7676@gmail.com`, וזה חשף ש-`assignStaffRole` כותב רק ל-`platform_staff` בעוד `setPlatformAdmin` כתב רק ל-`user_roles` ואיש לא סנכרן — כלומר **ארבעת התפקידים הלא-owner היו בלתי שמישים כפי שנשלחו**. המסקנה: `user_roles` פרשה כרצפה, `platform_staff` היא הרצפה היחידה, ו-21 מדיניות ה-RLS הועברו. הפירוט ב-§0.3. **הרישום המקורי, לתיעוד:** `requireAdmin()` בודק `has_role(uid,'admin')` על `user_roles`; `requirePlatformPermission` בודק `has_platform_permission` דרך `platform_staff → platform_roles → platform_role_permissions → platform_permission_definitions`. ההערה ב-`dal.ts:61-63` אומרת זאת מפורשות: *"A SECOND platform role layer, **orthogonal** to the coarse has_role('admin') flag"*. מדוד 10.9: 3 משתמשים עם `admin`, 3 חברי `platform_staff` (כולם `owner`), 3 מחזיקי `manage_settings` — **0 שיאבדו גישה, 0 שיקבלו**. השאלה נותרת רלוונטית רק כשיתווסף חבר צוות שאינו `owner`.
11. **האם להשוות בכלל מול "Meta latest"?** `META_LATEST_GRAPH_VERSION` **אינו קיים בקוד** (מדוד 10.9), ו-Task 2.5 עצמו פוסל רשימות סטטיות בנימוק "אין placeholder שמזדקן" — ואז מקבע מחרוזת שמטא תיישן. חלופות: לגזור מהפרוב של `meta:types` (v26.0 = 500 בשישה ממשקים), או להסיר את ההשוואה ולהציג קישור ל-changelog.
12. **האם להוציא את רשימת הספקים לרישום נתוני?** הוספת ספק שמיני נוגעת **בחמישה** מקומות: `IntegrationKey` (union סגור), המערך ב-`getIntegrationsOverview`, תיקיית route, `redirects()`, ו-`NAV_GROUPS` — בזמן שטבלת `channels` כבר קיימת עם RLS ועורך UI. **מומלץ:** `src/lib/integrations/registry.ts` — מערך descriptors אחד (`{ key, title, permission, href }`) שממנו נגזרים האינדקס, פריט התפריט ובדיקת הרינדור. **לא** route דינמי `[provider]` — over-engineering לשבעה ספקים ידועים שכל אחד מרכיב רכיבים שונים.
13. **האם לקבע גם את גרסת ה-Graph של הפרסום החברתי?** `src/lib/fleet/publish-social.ts` מקבע `v26.0` בשתי מחרוזות נפרדות — אותו מבנה שהוליד את G5. הוא מוחרג במפורש מ-`graph-version.test.ts` כי זה משטח מוצר אחר (Facebook Page / Instagram) עם אימות גרסה נפרד. קבוע `FACEBOOK_GRAPH_API_VERSION` משלו ייתן לו את אותה הגנה בלי לערבב.
