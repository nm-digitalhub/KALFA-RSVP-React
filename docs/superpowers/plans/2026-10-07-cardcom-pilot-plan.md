# חיבור CardCom — פיילוט לבחינת מעבר מ-SUMIT

> **סטטוס (7.10.2026, 20:45): נבנה בקוד — לא נפרס, לא נעשה commit, ולא נבדק מול CardCom (לא נשלחה אף קריאה אליהם). המיגרציה הופעלה על ידי הבעלים ב-7.10 והטיפוסים נוצרו. מה נבנה, מה אומת ומה עדיין פתוח: סעיף 11.**
> מקור הדרישה: מסמך ההנחיות של CardCom (`cardcom-integratoin.md`, הועלה בשיחה) — "לצורך בחינה של מעבר של שירותי הסליקה הקיימים שלנו". היקף שנבחר על ידי הבעלים: **פיילוט — רכישת חבילה + החזר, מאחורי מתג; SUMIT נשאר הסליקה הפעילה.**
> דרישת קבלה של הבעלים: **בדיקה אמיתית. בדיקות עם mock או מסוף הבדיקות `1000` אינן מספיקות לאישור** (ראו "אימות").

סימון מקורות במסמך: **[נמדד]** נקרא בקוד או במסד הנוכחי · **[הנחיות]** כתוב במסמך ההנחיות · **[ספק]** כתוב ב-OpenAPI של CardCom (`secure.cardcom.solutions/swagger/v11/swagger.json`, הורד 7.10, 403KB) · **[לא ידוע]** לא נבדק, ייבדק לפני שמסתמכים עליו.

## 1. מה ההנחיות מניחות ומה יש בפועל

| ההנחיות | המערכת [נמדד] |
|---|---|
| קיימת טבלת `orders`; אם לא, "לעצור" | הוסרה (`20260709120000_remove_orders.sql`). היחידה היא **קמפיין**, והרשומה הכספית היא שורה ב-`payment_operations` (יומן append-only, סוגים `package_purchase` / `refund`, מצב נגזר מהשורות). |
| עמודות `CardCom_*` על ההזמנה | השורה ב-`payment_operations` נעולה: הטריגר `payment_operations_guard_update` אוסר `pending → pending`, כלומר אי אפשר לצרף לשורה פתוחה את ה-`LowProfileId` אחרי יצירת העמוד. |
| הלקוח עובר לעמוד של CardCom, התשלום מגיע ב-webhook | היום: טוקן חד-פעמי נוצר בדפדפן (`payments.js`) והחיוב מתבצע באותה בקשה (`package-purchase.ts`). זרימה סינכרונית. |
| הגדרות בעמוד ניהול | הסודות של SUMIT יושבים ב-`app_settings` (טבלה יחידה, RLS למנהלים). **הבעלים התנגד להגדיל אותה** (7.10). |
| החזר: `CancelDoc`, החזר מלא בלבד | ביטול חבילה מחזיר סכום **חלקי** (בניכוי דמי ביטול, `package-refund.ts` + `event-cancellation.ts`). |
| `DocumentTypeToCreate: "Auto"` | הבעלים עוסק פטור: מותרת קבלה בלבד. סוג המסמך ש-`Auto` מפיק תלוי בהגדרות חשבון CardCom — **[לא ידוע]**. |
| ברירות מחדל `CardTest1994` / `1000` | מסוף הבדיקות של CardCom. אסור שייראה בממשק כחשבון אמיתי. |

## 1א. ממצאי התיעוד הרשמי של CardCom (נקרא במלואו, 7.10)
מקור: שני מאמרים רשמיים שהבעלים הדביק (`docs/cardcom/response (2).md` = Step 1+2, `docs/cardcom/response.md` = Step 3; הקובץ `response (1).md` זהה ל-`response.md` בייט-לבייט) + ה-OpenAPI. **[תיעוד]** = כתוב במאמרים האלה.
1. **חיוב ישיר עם מספר כרטיס גולמי אסור לאתרים.** **[תיעוד]** "The direct interface model is **not** intended for websites (WEB). For such systems, the 'low profile' module should be used"; באתר חובה תקן PCI, אישור PCI "must be obtained directly from the credit company", אין לשמור פרטי כרטיס ואסור לשמור CVV. **לכן אפשרות "הטופס שלנו ומספר הכרטיס דרך השרת שלנו" נפסלת על ידי CardCom עצמה.** נשארות: עמוד/iframe של `LowProfile`, או Open Fields (לא נקרא עדיין).
2. **ה-webhook:** **[תיעוד]** אם השרת לא מחזיר HTTP 200, CardCom שולחת שוב **עד 7 פעמים**, במרווחים (בדקות) 1, 2, 2, 16, 60, 12 שעות, 12 שעות. **לדחיות** נשלח webhook רק אם מסומן בממשק CardCom "Always report transaction" (הגדרות ← 4. עיבוד Low Profile ← 2. הגדרות כלליות). הגדרה כזו חייבת להיבדק במסוף האמיתי; בלעדיה כשל לא יגיע ל-webhook, ו-sweeper (D6) הוא שיסגור אותו.
3. **"אל תסתמכו על דף ההצלחה"** **[תיעוד]**: הלקוח יכול לסגור את הדף. מאשש את התכנון: ה-webhook וה-sweeper סוגרים תשלום גם כשהלקוח לא חזר.
4. **סימון שהנתונים נמשכו** **[תיעוד]**: "mark in your system that the data was retrieved" כדי למנוע משיכה כפולה (רענון, crawlers). מאשש את `settleCardcomSession` האידמפוטנטית.
5. **`DocumentInfo.DocumentUrl` ו-`TranzactionInfo.DocumentUrl` "currently not working"** **[תיעוד]** (בדוגמה: `null`). **לא נסמוך עליהם**; מספר מסמך וסוג כן מוחזרים. **[נמדד 7.10 23:36: `TranzactionInfo.DocumentUrl` הוחזר וקישור עובד (PDF); `DocumentInfo.DocumentUrl` הוחזר `null`. לכן נשמר רק אם הוא https בכתובת `secure.cardcom.solutions`.]**
6. **`DocumentTypeToCreate: "Auto"` נקבע לפי הגדרות החשבון** **[תיעוד]** ("based on settings 3→4"), ולכן סוג המסמך לעוסק פטור נקבע אצל CardCom ולא בקוד שלנו. עדיין לאמת מול החשבון (U2).
7. **`IsAllowEditDocument`** **[תיעוד]**: מאפשר ללקוח/לעסק לערוך **פרטי מסמך** בעמוד (שם, עיר, כתובת). לא נאמר שהסכום ניתן לעריכה.
8. **`ExternalUniqTranId`** ב-`Transactions/Transaction` **[תיעוד]**: מזהה ייחודי למניעת חיוב כפול (שגיאה 608 בשליחה חוזרת; `ExternalUniqTranIdResponse:true` מחזיר את התשובה המקורית). רלוונטי רק אם נשתמש בחיוב טוקן/ישיר, שאינו בפיילוט.
9. **סתירה בין התיעוד ל-OpenAPI:** המאמר כותב שבקשת `GetLpResult` היא GET; ה-OpenAPI וההנחיות כותבים POST. מימוש לפי OpenAPI וההנחיות, ויאומת בריצה (U10). ובתשובה השם הוא `TranzactionId` (וגם `TransactionId` בטבלאות המאמר): הקוד יקבל את שניהם.
10. **חסר, ולא נקרא:** (א) מאמר ההחזר לפי מזהה עסקה (חלקי/מלא); (ב) "מידע לביצוע טסטים (למתכנת)" (כרטיסי בדיקה). קישורים: `cardcomapi.zendesk.com/hc/he/articles/28988986351762-Partial-Full-Transaction-Refund-by-Transaction-ID-Refund-By-Transaction-ID`; `cardcomapi.zendesk.com/hc/he/articles/27008196694546`.

## 1ב. Open Fields — הטמעת שדות הכרטיס בתוך העמוד שלנו (נקרא 7.10)
מקור: מאמר Open Fields הרשמי (`docs/cardcom/response (3).md`) + קוד הדוגמה הרשמי של CardCom, ציבורי ב-GitHub (`CardCom/OpenFields-FrontEnd`, `CardCom/OpenFields-Backend-Node`; נקרא כולו, נשמר מחוץ לפרויקט). **[תיעוד]** = המאמר; **[דוגמה]** = קוד הדוגמה הרשמי.
1. **מה זה:** שדות מספר הכרטיס וה-CVV של CardCom מוטמעים כ-iframe בתוך הטופס שלנו, עם עיצוב CSS שלנו; שאר השדות (שם, אימייל, טלפון, חודש/שנת תוקף, תשלומים) הם של הטופס שלנו. תקן PCI מטופל אצל CardCom: מספר הכרטיס וה-CVV אינם ב-DOM שלנו ואינם עוברים בשרתים שלנו. **זה מה שהבעלים ביקש: בלי עמוד תשלום נפרד.**
2. **צד השרת הוא בדיוק `LowProfile/Create` של ההנחיות** [דוגמה]: LowProfile **חדש לכל ניסיון שליחה** [תיעוד]; ה-`LowProfileId` מוחזר לדפדפן; webhook ו-`GetLpResult` ללא שינוי.
3. **ה-iframe-ים** [דוגמה]: `https://secure.cardcom.solutions/api/openfields/master` (מוסתר, בגודל 0), `/cardNumber`, `/CVV`; אופציונליים: `/GooglePay?terminalNumber=…`, `/credits?language=he&type=long`. מזהים חובה [תיעוד]: `CardComMasterFrame`, `CardComCardNumber`, `CardComCvv`, `CardComCaptchaIframe`. בנוסף נטען סקריפט `https://secure.cardcom.solutions/External/OpenFields/3DS.js` לעמוד שלנו (עם `?v=<זמן>`).
4. **פרוטוקול `postMessage`** [תיעוד, דוגמה]: אנחנו ל-master: `init` (`lowProfileCode`, `cardFieldCSS`, `cvvFieldCSS`, `reCaptchaFieldCSS`, placeholders), `doTransaction` (`cardOwnerId`, `cardOwnerName`, `cardOwnerEmail`, `cardOwnerPhone`, `expirationMonth`, `expirationYear`, `numberOfPayments`, `document`), `validateCvv`/`validateCardNumber`. CardCom אלינו: `HandleSubmit` (`data.IsSuccess`, `data.Description`), `HandleEror` (כך כתוב), `handleValidations`. הודעה בלי `action` היא חלק מ-3DS ומתעלמים ממנה. הדוגמה עצמה שולחת עם `targetOrigin '*'` ומעירה "add validations that the message came from secure.cardcom.solutions" — **אצלנו: שולחים רק ל-origin המדויק, ומקבלים רק הודעות מ-`https://secure.cardcom.solutions` (בדיקת `event.origin` וגם `event.source`).**
5. **3DS** [תיעוד, דוגמה]: כשמשתמשים בו, חובה `cardOwnerPhone` או `cardOwnerEmail`.
6. **`HandleSubmit` אינו מקור אמת.** התוצאה נקבעת רק ב-`GetLpResult` (webhook או settle), כמו בכל הזרימה.
7. **אין CSP גלובלי באתר** [נמדד: ב-`next.config.ts` יש CSP רק ל-`/sw.js`], ולכן אין חסימה של ה-iframe והסקריפט. אם יוגדר CSP בעתיד: `frame-src` ו-`script-src` ל-`https://secure.cardcom.solutions`. טעינת סקריפט של ספק לעמוד התשלום קיימת גם היום (`payments.js` של SUMIT, `hold-form.tsx`).
8. **(מיושן, ראו U11)** הדוגמה שולחת `cardOwnerId: '000000000'` "כדי לעבור Luhn; אם המסוף דורש ת"ז תקפה — יש לספק" [דוגמה]. SUMIT דורש אצלנו ת"ז היום; האם מסוף CardCom דורש — לא ידוע (U11).
9. **הדוגמה מגדירה ב-`Create` את `IsAllowEditDocument:false` ו-`IsShowOnlyDocument:true`**, בניגוד ל-`IsAllowEditDocument:true` שההנחיות כופות. ב-Open Fields אין עמוד של CardCom שבו הקונה יערוך מסמך, ולכן הערך כמעט חסר משמעות; **נשארים עם ההנחיות (`true`)** ובודקים בריצה (U13).

## 2. החלטות שדורשות אישור

**D1 — טבלת הגדרות ייעודית, בלי לגעת ב-`app_settings`.** טבלה חדשה `cardcom_config` (שורה אחת): `terminal_number`, `api_name`, `enabled`, `api_password_secret` (מזהה סוד ב-Vault, לא הסיסמה), `updated_at`. סגורה לכל role של לקוח (RLS פעיל + `revoke` מ-anon ומ-authenticated), כמו `console_agent_secrets` ו-`integration_provider_configs`. `enabled=true` הוא המתג: רכישות חבילה עוברות ל-CardCom; שורה חסרה או `false` = SUMIT, כמו היום. לא משתמשים ב-`integration_provider_configs` הקיימת כי היא בנויה ל-OAuth (`client_id` חובה, נקראת דרך רישום ProviderDefinition).

**D2 — בלי שדה `Operation` בהגדרות.** בפיילוט הוא תמיד `ChargeOnly` (במודל החבילה אין תפיסת מסגרת ואין חיוב נדחה — החלטת הבעלים 4.10). שדה שהקוד מתעלם ממנו היה הצגת נתון מזויף. **סטייה מכוונת מההנחיות** (Task 1 שורה 4, ו-Tasks 5 ו-7 — חיוב נדחה — לא נבנים).

**D3 — החזר אוטומטי לגמרי, כולל חלקי (החלטת הבעלים, 7.10: "הכל בתהליך הזרימה ללא טיפול ידני").** החזר מלא: `Documents/CancelDoc` (כפי שבהנחיות). החזר חלקי (ביטול עם דמי ביטול): `Transactions/RefundByTransactionId` עם `PartialSum` [ספק], שמחזיר רק `NewTranzactionId` ולא מסמך — **איזה מסמך זיכוי נוצר, ואם צריך ליצור אותו בנפרד (`ReceiptRefund` וכד' ב-`Documents/CreateDocument`), אינו ידוע (U9) ותלוי במאמר ההחזר שעוד לא נקרא ובבדיקה האמיתית.** עד שיוכרע, המימוש מתחיל מהחזר מלא, והחזר חלקי נבנה רק אחרי U9. נשארת טיפול אדם במקרה אחד בלבד: תשובה לא ברורה מהספק (נפילת חיבור באמצע החזר), כי ניסיון חוזר אוטומטי עלול להחזיר פעמיים (אותו כלל כמו ב-`package-refund.ts` היום). **סטייה מההנחיות** (Task 6: "Full Refund only").

**D4 — מסוף `1000` לא פתוח ללקוחות.** כל עוד `terminal_number = 1000`, רכישה דרך CardCom מותרת רק למנהל פלטפורמה (אחרת "תשלום" בבדיקות מפעיל קמפיין אמיתי בלי כסף). הכלל נבדק בשרת, fail-closed.

**D5 — ההפעלה אחרי תשלום נעשית בנתיב ה-settle של הלקוח, לא ב-webhook.** `activateCampaign` רץ היום עם session הבעלים (`actor: owner`); ב-webhook אין session ואין actor מערכתי. אחרי `HandleSubmit` הדף קורא ל-`POST …/purchase/settle` (עם ה-cookie ובדיקת בעלות), שסוגר את התשלום מול `GetLpResult` ואז מפעיל. לקוח שסגר את הדף: ה-webhook וה-sweeper סוגרים את התשלום, הקמפיין נשאר "שולם, לא הופעל", והממשק הקיים מציג כפתור הפעלה (`activate-now-form.tsx`, מצב `paid=1&activate=…`).

**D6 — ה-sweeper לא מעביר שורת CardCom ל-`review` אחרי 10 דקות.** שורה כזו מחכה ללקוח בעמוד של CardCom, לא לתהליך שמת. לשורות עם `meta.provider='cardcom'` ה-sweeper קורא ל-`settleCardcomSession` (ראו 4.4); רק אם CardCom מאשר שאין עסקה והעמוד ישן מסף הנטישה — השורה נסגרת `failed` (כדי שהלקוח יוכל לנסות שוב). סף הנטישה: קבוע בקוד, מתחיל ב-60 דקות, ויעודכן אחרי שנמדד תוקף העמוד **[לא ידוע]**.

**D7 — `DocumentTypeToCreate: "Auto"` ו-`IsAllowEditDocument: true` נשלחים כפי שההנחיות דורשות** ("Do NOT modify"). לפני מסוף אמיתי חובה לאמת מול יועץ המס (סוכן `israeli-tax-advisor`) ומול הגדרות החשבון איזה מסמך מופק לעוסק פטור.

**D8 — לקיחת פרטי הכרטיס: Open Fields (החלטת הבעלים 7.10: "אני לא רוצה לעבוד עם עמוד תשלום").** שדות הכרטיס של CardCom בתוך העמוד שלנו (1ב). נפסלו: (א) הפניה לעמוד של CardCom; (ב) חיוב ישיר עם מספר כרטיס גולמי — CardCom עצמה כותבת שהוא לא מיועד לאתרים ומחייב PCI מלא (1א.1). **ממתין לאישור הבעלים.**

## 3. מה לא משתנה

מסלולי SUMIT (`package-purchase.ts`, `package-refund.ts`, מסלול ההחזקה והחיוב הסופי הישן `close-charge.ts`), צמתי ה-workflow של SUMIT, `app_settings`, ה-ledger והטריגרים שלו, `payment_operation_kinds`. הפיילוט **תוספת מבוקרת**; כלל "שינוי מסלק את מה שהוא מחליף" נענה בסעיף 8 (גורל הפיילוט).

## 4. תכנון

### 4.1 הגדרות ועמוד ניהול
- מיגרציה: `cardcom_config` (D1). כתיבת הסיסמה ל-Vault דרך RPC חדש בדמות `integrations_upsert_provider_config` (SECURITY DEFINER, `search_path` ריק, הרשאה `integrations.manage`) — פרטי ה-RPC יוגדרו עם סוכן `rls-schema-engineer` לפני הכתיבה.
- `getCardcomServerConfig()` ב-`src/lib/data/payments.ts` או בקובץ סמוך: fail-closed (שגיאה/שורה חסרה/`enabled=false`/סיסמה חסרה → "לא מוגדר"). הסיסמה נקראת רק בשרת ורק בהחזר.
- עמוד `/admin/integrations/cardcom` בדמות `integrations/sumit`: טופס עם שדה סודי מוסתר עם כפתור חשיפה (החלטת הבעלים 24.8), הרשאה `integrations.manage`. מסוף `1000` מוצג "מסוף בדיקות", לא "מחובר". Zod בגבול השרת; מספר מסוף מספר שלם חיובי.

### 4.2 נתונים
- `cardcom_payment_sessions`: `low_profile_id text primary key` (אינדקס ייחודי = אינדקס ההנחיות), `operation_id uuid not null references payment_operations(id) on delete restrict`, `created_at`. סגורה ללקוחות, כתיבה/קריאה דרך service-role בלבד. `LowProfileId` נבדק כמחרוזת לא ריקה עד 64 תווים — **לא מניחים UUID** (פורמט CardCom לא מתועד בהנחיות).
- ה-ledger **ללא שינוי**. בשורת `package_purchase` נרשם `meta.provider='cardcom'` ביצירתה. אחרי הצלחה: `provider_payment_id = TranzactionId`, `provider_document_number = DocumentNumber`, `provider_document_url` = `TranzactionInfo.DocumentUrl` כשהוא תקין (ראו 1א.5, נמדד), ו-`card_last4` / `card_exp_month` / `card_exp_year` / `card_brand` / `card_issuer` מ-`TranzactionInfo` (`cardcom-card-facts.ts`; אף ערך שגוי לא מכשיל רישום תשלום מאושר; הטוקן ו-6 הספרות הראשונות לא נשמרים), `provider_auth_ref = TranzactionInfo.ApprovalNumber`, ו-`meta.cardcom_document_type` (נדרש ל-`CancelDoc`; הטיפוס בבקשה הוא מספר שלם [ספק], ובתשובה — enum, ולכן נשמר כפי שהוחזר ומומר רק ברגע הבקשה).
- אין כרטיס שמור ואין טוקן: `ChargeOnly` לא מחזיר `TokenInfo` [ספק]. ב-UI הקיים, הצגת הכרטיס נשארת ריקה ל-CardCom (נתון לא ידוע מוצג כלא ידוע; ה-last4 מגיע ב-`TranzactionInfo` [ספק] ויוצג רק אם יידרש בנפרד).

### 4.3 לחיצה על "שלם" (`POST /api/campaigns/[id]/purchase`, ענף CardCom)
הנתיב הקיים מקבל כיום `og-token` חובה. ענף CardCom נבחר **לפני** קריאת הטוקן (לפי `cardcom_config.enabled`) ומחזיר **JSON** (לא הפניה). אותן בדיקות כמו היום: origin, session, בעלות על האירוע, אירוע פעיל ולא עבר, מחיר מ-`package_price` בשרת (הדפדפן לא שולח כלום חוץ מהבקשה).
1. שערים: תשלומים פועלים, מודל החבילה פועל, תצורת CardCom קיימת, D4.
2. מצב ה-ledger הקיים (`getPackagePaymentState`): `collected` → "כבר שולם", `review` → "בבדיקה". **`pending` של CardCom** (ניסיון קודם שלא הסתיים): קודם `settleCardcomSession` עליו; אם התשלום לא בוצע — השורה נסגרת `failed` ("הוחלף בניסיון חדש") ורק אז מתחיל ניסיון חדש (LowProfile חדש לכל ניסיון, 1ב.2; ה-DB מרשה שורה פתוחה אחת בלבד). **אם CardCom לא מאשרת שאין עסקה — לא פותחים ניסיון חדש** (חשש לחיוב כפול), והלקוח רואה "בתהליך".
3. שורת `pending` ב-ledger **לפני** הקריאה לספק (`beginOperation`, שורה אחת בנוסח הקבלה הקיים).
4. `LowProfile/Create` [הנחיות Task 4]: `Operation=ChargeOnly`, `Amount` = המחיר, `ReturnValue` = מזהה הפעולה (עזר בלבד), `SuccessRedirectUrl`/`FailedRedirectUrl` = דף התשלום (נדרשים בבקשה; ב-Open Fields לא נעשה בהם שימוש — U13), `WebHookUrl` = `getAppUrl('/api/cardcom/webhook')` (HTTPS ציבורי), `Language='he'`, `ISOCoinId=1`, `UIDefinition` מהפרופיל, `Document` מ**שורות ה-ledger** (סכום `UnitCost×Quantity` שווה ל-`Amount` מעצם הבנייה), `Name` חובה. timeout 10 שניות.
5. `ResponseCode ≠ 0`, או קריאה שלא הושלמה (timeout, רשת): השורה נסגרת `failed`, התראת Slack בחומרה גבוהה, ללקוח הודעה כללית. זה בטוח ב-CardCom בניגוד לחיוב: בלי `LowProfileId` ביד הלקוח אי אפשר לשלם, ולכן אי אפשר שחויב. ה-`Description` נשמר ב-ledger לאדמין בלבד.
6. `ResponseCode = 0`: רושמים `cardcom_payment_sessions` (`LowProfileId` → הפעולה). אם הרישום נכשל — השורה נסגרת `failed` והלקוח לא מקבל את ה-`LowProfileId`. אחרת מחזירים לדפדפן `{ lowProfileId }` **בלבד** (בלי `Url`, בלי סודות).
7. בדפדפן: רכיב לקוח מאתחל את ה-iframe-ים (`init` עם ה-`lowProfileId`), ובשליחת הטופס שולח `doTransaction` עם שם, אימייל, טלפון, חודש/שנת תוקף, `numberOfPayments: "1"` (וה-`document` רק אם U13 מחייב). בקבלת `HandleSubmit` או `HandleEror` הוא קורא ל-4.6.

### 4.4 `settleCardcomSession(lowProfileId)` — הפונקציה היחידה שסוגרת תשלום
אידמפוטנטית. נקראת מה-webhook, מנתיב ה-settle (4.6) ומה-sweeper.
1. מוצאת את הסשן לפי `LowProfileId`; לא נמצא → מחזירה "לא נמצא" (הקורא מתריע; ראו 4.5).
2. שורת ה-ledger כבר לא `pending` → מחזירה את המצב הקיים בלי לפנות ל-CardCom (טיפול כפול ב-webhook, סעיף 7 בהנחיות).
3. `LowProfile/GetLpResult` [הנחיות Task 3] עם `TerminalNumber`, `ApiName`, `LowProfileId`; timeout 5 שניות; כשל HTTP → ניסיון חוזר אחד; כשל נוסף → שגיאה לקורא.
4. `ResponseCode=0` ו-`Operation=ChargeOnly` → `completeOperation(from: 'pending', outcome: 'succeeded', …)` (compare-and-set: מרוץ בין webhook לנתיב החזרה מסתיים בנצחון אחד, והשני מקבל `OperationStateError` ומתייחס אליו כ"כבר טופל"). `ResponseCode≠0` → `failed`. **לא מוסיפים אימות מעבר ל-`GetLpResult`** (הנחיה מפורשת).
5. אחרי הצלחה, כל אחד בנפרד ו-best-effort כמו `package-purchase.ts`: `logActivity`, `checkOsekPaturCeilingAfterCharge`, התראה. כשל ברישום אחרי תשלום מאושר: השורה עוברת `review` עם הפניות הספק + התראה (בדיוק כמו הענף הקיים של `UNRECORDED_NOTE`).

### 4.5 `POST /api/cardcom/webhook`
ציבורי, ללא session וללא CSRF (שרת-לשרת), כמו `api/webhooks/*`. Zod על `{ ResponseCode, Description, TerminalNumber, LowProfileId, Operation }` עם התעלמות משאר השדות. `rate-limit` לפי IP (`src/lib/security/rate-limit.ts`; בזיכרון, לכל תהליך — מספיק כקו ראשון). `LowProfileId` לא ידוע → 200 עם התראה חמורה (מזהה בלבד, בלי גוף הבקשה) — תשובה אחידה שאינה מדליפה קיום. שגיאה מול CardCom אחרי הניסיון החוזר → 500 כדי ש-CardCom ינסה שוב. **לא נרשמים ללוג**: גוף הבקשה, טוקנים, פרטים אישיים, `ApiName`, סיסמה.

### 4.6 `POST /api/campaigns/[id]/purchase/settle`
נקרא מהדף אחרי `HandleSubmit`/`HandleEror`. **לא סומכים על תוכן ההודעה מה-iframe ולא על שום גוף בקשה:** הנתיב דורש session ובעלות, מוצא את הסשן הפתוח של הקמפיין בשרת, קורא ל-`settleCardcomSession` (כך אין מירוץ בין הדפדפן ל-webhook), ואם התשלום הצליח — מפעיל את הקמפיין כמו הענף הקיים של נתיב הרכישה. מחזיר לדף מצב אחד מתוך: שולם והופעל / שולם, ההפעלה נדחתה (עם הסיבה הקיימת) / נדחה / בתהליך / בבדיקה.

### 4.7 ה-sweeper
`runPaymentOrphanSweep` (`payment-orphans.ts`, נקרא מ-`worker/main.ts`) מקבל ענף: שורות עם `meta.provider='cardcom'` ← `settleCardcomSession`; סף הנטישה לפי D6. שאר השורות — ללא שינוי. הערת הקוד "SUMIT charge carries a 60-second timeout…" מתעדכנת לציין את החריג.

### 4.8 החזר
מודול חדש `cardcom-refund.ts` בדמות `package-refund.ts` (אותה הוכחת בטיחות: שערים → סכום מול ה-ledger → שורת `pending` לפני הספק → בדיקת תקרה חוזרת → אי-ודאות עוברת ל-`review` ולא נשלחת שוב). `Documents/CancelDoc` עם `ApiName`, `ApiPassword`, `DocumentNumber`, `DocumentType` (מהשורה המקורית). `ResponseCode=0` → `succeeded` עם `NewDocumentNumber`/`NewDocumentType`; אחרת `failed`, וה-`Description` מוצג **לאדמין בלבד**. סכום שונה מהמלא → "החזר ידני נדרש" (D3).
- נקודת הפיצול: `refundPackagePayment` / `checkPackageRefund` / `packageRefundSummary` ב-`package-refund.ts` נבחרים לפי `meta.provider` של שורת הרכישה (`hasCard` הוא מושג של SUMIT; ל-CardCom המקביל הוא "יש מספר ומיקום מסמך").
- מסך `/admin/cancellations/[id]` מקבל מצב נוסף ל-`moneyOutcome` ("החזר חלקי לא נתמך ב-CardCom").
- ה-`ApiPassword` נקרא מה-Vault רק בהחזר.

### 4.9 דף התשלום
ענף החבילה ב-`payment/page.tsx` מחליט לפי `cardcom_config.enabled` (+D4): במקום טופס `payments.js` מוצג רכיב לקוח חדש (`"use client"`, כי הוא משתמש ב-`postMessage` ובאירועי דפדפן) עם שדות Open Fields. עיצוב: אותם רכיבי טופס ו-tokens של האתר, RTL, תוויות נגישות, מצב פוקוס גלוי, מקלדת; מצבי טעינה/שגיאה/בתהליך מוגדרים; הודעות שגיאה כלליות. אין שם ספק בטקסט הלקוח (החלטת הבעלים 4.10). ה-`origin` של כל הודעה נבדק (1ב.4). ללא Google Pay בפיילוט.

## 5. אבטחה ופרטיות (לפי CLAUDE.md)
- `ApiName`, `ApiPassword`, `TerminalNumber` רק בשרת; לא ב-`NEXT_PUBLIC_*`, לא בקליינט, לא בלוגים, לא ב-commit.
- סכום ומחיר תמיד מהשרת. ה-webhook וההודעות מה-iframe לא מסמנים הצלחה: רק `GetLpResult` מחליט. הודעות `postMessage` מתקבלות רק מ-`https://secure.cardcom.solutions` ונשלחות רק אליו (בדיקת `origin` ו-`source`).
- בעלות נבדקת בשרת בכל נתיב לקוח; ה-webhook ציבורי ולכן לא ניגש לשום נתון אורח.
- ביקורת: `logActivity` על רכישה והחזר; ה-ledger נשאר append-only.
- שגיאות ללקוח כלליות; `Description` של CardCom לא מוצג ללקוח.
- אין שמירה של פרטי כרטיס. `CardOwnerIdentityNumber` (ת"ז) מגיע בתשובת הספק רק ב-`TokenInfo`/`TranzactionInfo` — **לא נשמר** בפיילוט.

## 6. אי-ודאויות (חובה לסגור לפני שמסתמכים)

| # | שאלה | איך נסגרת |
|---|---|---|
| U1 | האם `CancelDoc` מחזיר את **הכסף** לכרטיס (הספק: "Cancel document and refund credit card") | החזר אמיתי של ₪1 ובדיקה בכרטיס/בדוח הספק |
| U2 | איזה מסמך `Auto` מפיק לעוסק פטור (נקבע לפי הגדרות החשבון אצל CardCom, 1א.6) | אימות מול יועץ המס והגדרות החשבון, ואז בדיקה אמיתית |
| U3 | תוקף עמוד התשלום, ומה `GetLpResult` מחזיר לפני תשלום או אחרי נטישה | מדידה בריצה אמיתית |
| U4 | webhook על דחייה: לפי התיעוד רק עם "Always report transaction" מסומן בחשבון; נטישה — לא מתועד. (הניסיונות החוזרים **נענו**: עד 7, 1/2/2/16/60 דקות ו-12 שעות ×2) | בדיקת ההגדרה במסוף האמיתי, ומדידה |
| U5 | פורמט `LowProfileId`, ואם `DocumentType` בתשובה הוא מספר או שם | מדידה; הקוד לא מניח |
| U6 | ש-`WebHookUrl` שלנו נגיש לשרתי CardCom (nginx, חומת אש) | בדיקה ממקור חיצוני |
| U7 | `IsAllowEditDocument` מאפשר עריכת פרטי מסמך (שם/עיר/כתובת) בעמוד [תיעוד]; האם עריכה משנה את הקבלה שמופקת, ושהסכום לא ניתן לשינוי | מדידה |
| U8 | סיסמת ה-API של מסוף הבדיקות (ההנחיות: ריקה) — ייתכן ש-`CancelDoc` לא נבדק שם בכלל | בתחילת בדיקה |
| U9 | איזה מסמך נוצר בהחזר חלקי (`RefundByTransactionId` מחזיר רק מזהה עסקה) | קריאת מאמר ההחזר + החזר חלקי אמיתי של אגורות |
| U10 | `GetLpResult`: GET (תיעוד) או POST (OpenAPI, הנחיות) | מדידה |
| U11 | ~~האם מסוף CardCom דורש ת"ז~~ — **נסגר בקוד (7.10, 22:13):** הטופס דורש ת"ז תקפה (9 ספרות, ספרת ביקורת), ושולח אותה ל-CardCom בלבד, בלי לשמור ובלי לשלוח לשרת שלנו. נשאר לבדוק בריצה אם CardCom מאמתת אותה מול הכרטיס (שגיאה `026` ב-SUMIT) | ריצה אמיתית |
| U12 | האם `CardComCaptchaIframe` חובה, ואיך reCAPTCHA מתנהג | קריאת קוד ההטמעה ובדיקה |
| U13 | האם `document` ב-`doTransaction` חובה או דורס את ה-`Document` של `Create`; האם `SuccessRedirectUrl`/`FailedRedirectUrl` נדרשים ב-Open Fields | מדידה |
| U14 | האם ה-iframe `/credits` (לוגואים) חובה מבחינת CardCom | עיון בתנאי השימוש/שאלה לתמיכה |

## 7. אימות

**אוטומטי (רשת ביטחון בלבד, לא הוכחה):** בדיקות יחידה ל-`settleCardcomSession` (אידמפוטנציה, מרוץ webhook/החזרה, ניסיון חוזר ו-timeout, כשל רישום אחרי הצלחה), ל-webhook (Zod, rate-limit, מזהה לא ידוע, 500 על כשל ספק), לבניית `Create` (סכום המוצרים שווה ל-`Amount`, אין שדה סודי בבקשה לקליינט, התשובה לדפדפן מכילה `lowProfileId` בלבד), לבדיקת `origin` של `postMessage` (הודעה מ-origin אחר נדחית), להחזר (מלא בלבד, חלקי חסום, אי-ודאות → review), ל-sweeper (CardCom לא עובר ל-review לפי הגיל הישן), ולכלל D4. אחריהן: `npm run lint`, `npx tsc --noEmit`, `npm run build` (עם `--webpack` כפי שמוגדר), והרצת הסוויטה המלאה. כל בדיקה שנכשלת מתוקנת, גם אם אינה קשורה.

**קבלה אמיתית (תנאי לאישור הפיילוט):**
1. הבעלים מזין בטופס הניהול מסוף אמיתי (מספר מסוף, `ApiName`, סיסמה). **הפרטים לא עוברים בצ'אט.**
2. רכישה אמיתית של ₪1 בכרטיס אמיתי דרך הקוד האמיתי: Create → עמוד CardCom → webhook → `GetLpResult` → ledger → הפעלה.
3. החזר אמיתי דרך `CancelDoc`; בדיקה שהכסף הגיע, ושהמסמך (קבלה/זיכוי) מהסוג הנכון.
4. סגירת U1–U8 לפי התוצאות, ועדכון המסמך הזה.
5. **כל הרצה כזו רק באישור מפורש של הבעלים באותו רגע** (כמו ניסוי ה-₪1 ב-SUMIT, 6.10).

## 8. גורל הפיילוט (הסרת מה שהוחלף)
- **הפיילוט נכשל או נדחה:** `cardcom_config.enabled=false` מחזיר מיד ל-SUMIT; מוחקים את הקוד החדש, את שתי הטבלאות ואת ה-RPC (SQL rollback מצורף למיגרציה). לא נשאר זנב.
- **הפיילוט מצליח והבעלים מחליט לעבור:** תכנית נפרדת (באישור נפרד) שמסלקת את מסלולי SUMIT, את `sumit_*` מ-`app_settings`, את צמתי ה-workflow ואת דפי הניהול של SUMIT, וקובעת מה קורה לקמפיינים שכבר שולמו ב-SUMIT (החזרים עליהם עדיין עוברים ב-SUMIT). מה שנבנה כאן אינו מחייב את ההחלטה הזו.

## 9. סדר עבודה (כל שלב באישור נפרד)
- **S0** — אישור התכנית הזו (D1–D8).
- **S1 (הבעלים אישר ריצת למידה, 7.10; טרם בוצעה)** — סקריפט חד-פעמי מחוץ לפרויקט מול מסוף הבדיקות של CardCom, לאחר קריאת מאמר כרטיסי הבדיקה. לא משנה את הפרויקט. ימדוד: פורמט תשובות `Create`/`GetLpResult`, `GetLpResult` לפני תשלום ואחרי נטישה (U3, U10), התנהגות ה-webhook (U4) ופרוטוקול Open Fields ב-iframe בדפדפן (U11–U14). הרצה בדפדפן דורשת Chrome של הבעלים.
- **S2** — מיגרציה (טבלאות + RPC), עם dry-run על המסד החי ובדיקה שה-ledger והטריגרים לא נפגעו. **אני לא מפעיל אותה; הבעלים מריץ `db push`**, ואז `gen:types`.
- **S3** — הגדרות ועמוד ניהול.
- **S4** — `settleCardcomSession`, ענף הרכישה (JSON), webhook.
- **S5** — נתיב ה-settle, ה-sweeper, רכיב Open Fields בדף התשלום.
- **S6** — החזר (מלא קודם; חלקי אחרי U9).
- **S7** — בדיקות ושערים סטטיים.
- **S8** — קבלה אמיתית (סעיף 7).

## 10. שאלות פתוחות לבעלים
1. אישור D1–D8 (במיוחד D2, D3, D5, D8).
2. מסוף CardCom אמיתי: **יש** (הבעלים, 7.10) — הוא מזין את הפרטים בטופס הניהול.
3. שני מאמרי תיעוד שעוד לא נקראו (סעיף 1א.10): החזר לפי מזהה עסקה, וכרטיסי בדיקה.

## 11. מצב המימוש (7.10.2026, 20:45) — קבצים בלבד, לא נפרס, לא נעשה commit

**אימות שרץ על העץ הסופי:** `npx tsc --noEmit` נקי · `npm run lint` נקי · `npm run worker:deps` נקי · הסוויטה המלאה (683 קבצים, כ-11,750 בדיקות) ירוקה · `npm run build` (webpack, ל-`.next-verify`, בלי לגעת ב-`.next` החי) עבר וכולל את הנתיבים החדשים. מוטציות על `cardcom-settle` נהרגו בבדיקות (4 מתוך 4). **לא בוצע:** בדיקת דפדפן בסביבה חיה (לא נפרס), שום קריאה ל-CardCom, בדיקת התנהגות של פונקציות ה-Vault במסד (dry-run עם rollback — ממתין לאישורך; הוכחו רק ההרשאות והסכמה בשאילתות קריאה).

**מה נבנה (לפי השלבים):**
- **S2 מסד:** `supabase/migrations/20261007215705_cardcom_pilot_config_and_sessions.sql` — `cardcom_config`, `cardcom_payment_sessions`, `cardcom_config_save`, `cardcom_api_password`. הופעלה על ידי הבעלים; אומת בקריאה בלבד: ההרשאות, RLS ללא מדיניות, 0 שורות, ה-ledger ללא שינוי (6 שורות).
- **לקוח CardCom:** `openapi/cardcom.openapi.json` (הקובץ של הספק, ללא שינוי), `src/lib/cardcom/{mutator,create-request,open-fields,document-types}.ts`, `generated/` (הלקוח המלא של הספק, מחולק לפי תחום; נוצר ללא טרנספורמר — הטרנספורמר שחתך לארבע פעולות נמחק 8.10 באישור הבעלים), פרויקט `cardcom` ב-`orval.config.ts`.
- **S3 הגדרות:** `src/lib/data/cardcom-config.ts` (קריאה בשרת, fail-closed), `src/lib/data/admin/integrations/cardcom-config.ts`, עמוד `/admin/integrations/cardcom` (טופס, כרטיס מצב), כרטיס באינדקס האינטגרציות, הרשאות `integrations.read/manage`, רישום בבדיקת כיסוי שכבת הנתונים.
- **S4 רכישה וסגירה:** `provider.ts` (`resolvePurchaseProvider`), `cardcom-purchase.ts`, `cardcom-settle.ts`, `cardcom-routes.ts`, `activate-after-payment.ts` (חולץ מנתיב SUMIT, שמשתמש בו כעת), `POST /api/cardcom/webhook`, `POST …/purchase/cardcom`, `POST …/purchase/settle`.
- **S5:** ענף ב-`payment-orphans.ts` (שורת CardCom לא עוברת ל-`review` בגלל גיל), `cardcom-pending.ts`, `package-payment-screen.ts` (`pendingIsResumable`), `payment/page.tsx` + `package-payment-view.tsx`, רכיב לקוח `cardcom-open-fields-form.tsx`.
- **S6 החזר:** `cardcom-refund.ts` (`CancelDoc`, החזר מלא), `package-refund-types.ts`, `purchase-provider.ts`, dispatch לפי הספק ששולם ב-`package-refund.ts`, ניסוח ניטרלי-ספק של סיבות הסירוב ב-`package-cancellation.ts`.

**חריגות מהתכנית כפי שנבנתה (הכל נבדק, ומחייב את אישורך):**
1. **סשן צעיר שלא שולם מתחדש (resume):** לחיצה כפולה, רענון או לשונית שנייה מקבלים בחזרה את אותו `LowProfileId` ולא שורה חדשה. נוסף כי לקוח שרענן באמצע הקלדה היה נתקע 60 דקות.
2. **`Create` עם timeout של 10 שניות** (התכנית אמרה 5; ההנחיות דורשות 5 רק ל-`GetLpResult`).
3. **שורה שנסגרה `failed` ובכל זאת נכנס אליה תשלום** (webhook מזויף מוקדם, בנק איטי): ה-ledger לא נכתב מחדש (הוא append-only), אבל נשלחת התראה חמורה. כי "לא שולם" מול "עוד לא שולם" לא ניתן להבדלה עד שנמדוד (U3).
4. **החזר חלקי נשאר חסום (`partial_unsupported`)** — בניגוד לבקשתך "בלי טיפול ידני". הסיבה: `RefundByTransactionId` לא מחזיר מסמך, ולא ידוע איזה מסמך זיכוי ייווצר לעוסק פטור (U9). בנייה שלו בלי לדעת הייתה מחזירה כסף בלי מסמך מס. **ביטול עם דמי ביטול על תשלום CardCom ידרוש כרגע טיפול ידני**, עד שנקרא את מאמר ההחזר ונבדוק.
5. **טבלת מספרי סוגי מסמך ל-`CancelDoc` היא הסקה, לא מדידה** (U15) — ראו למטה.

**אי-ודאויות חדשות** (נוספות ל-U1–U14 שבסעיף 6):

| # | שאלה | איך נסגרת |
|---|---|---|
| U15 | `CancelDoc` דורש `DocumentType` כמספר; ה-OpenAPI ו-`GetLpResult` נותנים רק שם. הטבלה (`Receipt`=3, `TaxInvoiceAndReceipt`=1, והמסמכים החוזרים 4 ו-2) היא מיקום השם ברשימת CardCom. מספר שגוי עלול לבטל מסמך אחר שחולק את אותו מספר | ההחזר האמיתי הראשון; הקוד מאמת שהמסמך החדש הוא ההחזר התואם, אחרת `review`. הפיילוט סגור ללקוחות עד אז |
| U16 | האם CardCom שולחת ללקוח את מסמך הזיכוי מעצמה (`IsCancelEmailSend` נשלח בברירת מחדל) | החזר אמיתי ובדיקת תיבת הדואר |
| U17 | `Mobile` מול `Phone`: ה-OpenAPI אומר Mobile=נייד, Phone=קווי; מאמרי Do Transaction ו-Create אומרים להפך (Phone=נייד, אליו נשלח SMS). **נשלח בשניהם** | מה שמופיע בקבלה בריצה הראשונה |
| U18 | המאמר "Do Transaction" כותב ש**בלי `Products` במסמך לא יופק מסמך**. אנחנו שולחים ב-`doTransaction` רק פרטי לקוח (בלי מוצרים, כדי שהדפדפן לא יקבע מחירים). אם CardCom קוראת את ה-`document` הזה במקום זה של `Create`, לא יופק מסמך | האם `DocumentNumber` חוזר מ-`GetLpResult` בריצה הראשונה |
| U19 | ~~מאמר ה-Webhook~~ — **נקרא (7.10, 22:42) ואין בו דרישות חדשות:** זה מדריך לפיתוח מקומי עם Dev Tunnels (כתובת HTTPS ציבורית שמנתבת ל-localhost). הוא לא מגדיר חתימה, כתובות מקור או פורמט. מה שכן מאשש: הכתובת ב-`WebHookUrl` חייבת להיות HTTPS מלאה עם הנתיב ולא `localhost` (כך אצלנו), וה-webhook אינו GET רגיל של דפדפן (אצלנו POST בלבד) | נסגר |
| U12 (עדכון) | ~~`CardComCaptchaIframe` חובה וטרם נבנה~~ — **נבנה (7.10, 23:02), על פי מקורות ראשוניים של CardCom:** (1) ה-Readme של הדוגמה: "Use Google reCaptcha (V2)" ו-4 מזהי iframe חובה; (2) הכתובת נקראה מהשרת החי: `GET /api/openfields/reCaptcha` מחזיר 200 עם ווידג'ט reCAPTCHA v2 (`captcha` ללא אותיות גדולות — 404; נתיב שאינו קיים — 404); (3) `reCaptcha.js` שלהם מעביר את הטוקן ל-`window.parent.frames["CardComMasterFrame"]` **לפי שם**, ו-`OpenFields.js` (master) מוצא את `window.parent.frames.CardComCaptchaIframe` לפי שם כדי לתת לו את `reCaptchaFieldCSS`, שומר את הטוקן ב-state שנשלח כולו ל-`ChargeLowProfileDeal`, ומדווח לדף `handleValidations` עם `field:'reCaptcha'`. לכן כל ה-iframe-ים אצלנו נושאים גם `name`, והטופס לא ינסה לשלם לפני שהקונה פתר את הקפצ'ה (ההכרעה אם הטוקן נדרש היא של שרת CardCom, לפי הגדרת הקפצ'ה בחשבון — מאמר "הפעלה/הסרת קאפצ'ה"). **נשאר למדוד בריצה:** שהווידג'ט מוצג ועובד בתוך הטופס, ושהטוקן אכן מקובל (או לא נדרש) במסוף הבדיקות | ריצה בדפדפן אמיתי מול מסוף 1000 |
| U13/U17/U18/U20 (נמדד, ריצה ראשונה במסוף 1000, 7.10 23:36) | **GetLpResult** החזיר: `ResponseCode 0`, `Operation ChargeOnly`, `TranzactionId`, ו-`DocumentInfo.DocumentNumber` (15935) — **מסמך הופק**; `TranzactionInfo` כולל `Last4CardDigitsString`, `CardMonth/Year`, `Brand`, `Issuer`, `CardName`, `ApprovalNumber`, `Token` (טוקן כרטיס גם ב-ChargeOnly — לא נשמר ולא נרשם) ו-`DocumentUrl` (קישור עם קוד גישה; `DocumentInfo.DocumentUrl` ריק). **המסמך עצמו** (נקרא מהקישור): סוג `SiteCustomerOrder` = "אישור הזמנה לדוגמה" — לא קבלה; מע"מ 18% מפורט (עסק הבדיקה מורשה); בשורת הלקוח רק שם ואימייל — **כתובת, עיר וטלפון שנשלחו ב-`doTransaction.document` לא מופיעים במסמך ולא ב-`UIValues`**. **פער שנסגר (7.10 23:58, באישור הבעלים):** הקוד שומר עכשיו ארבע ספרות, תוקף, סוג, מנפיק וקישור מסמך — מהריצה הבאה (שורת 23:35 עצמה לא תתמלא: הפנקס append-only). **8.10 (הוראת הבעלים: "לשמור את כולם ללא יוצא דופן", ואחר כך "למה עוד טבלה? יש לנו את הספר"):** כל שדה של `GetLpResult` ממופה לשורת התשלום עצמה, לא להעתק בטבלה נפרדת (הטבלה `cardcom_transaction_results` שנוצרה בטעות נמחקת במיגרציה `20261007225130`, ריקה). ממופה לעמודות קיימות: טוקן ← `card_token_ref` (נקרא רק במסלול SUMIT, שמחליט לפי החברה ששילמה — `purchaseProviderOf`), ת"ז ← Vault (`payment_citizen_id_write`) ו-`citizen_id_secret`, `CreateDate` ← `occurred_at` (שעון ישראל, דרך `wallClockToDate`). 17 עמודות חדשות במיגרציה: פרטי בעל הכרטיס (שם, אימייל, טלפון), שם/סוג כרטיס, 6 ספרות ראשונות, כרטיס חו"ל, מספר תשלומים, מספר שובר, `Uid`, `Rrn`, סולקת, סוג אשראי, ערוץ הקלדה, סוג עסקה, מזהה כרטיס לקוח, הערת מנפיק. **המיגרציה הוחלה 8.10 והמיפוי חובר לקוד** (`cardcom-card-facts.ts`, `cardcom-payment-facts.ts`, `ledger.ts`, `cardcom-settle.ts`; כל שדה נבדק לבד ושדה לא תקין נשאר ריק בלי לעצור תשלום). לא נשמרו (כפילויות או קבועים): `SapakMutav`, `ConcentrationNumber`, `JParameter`, `ExternalPaymentVector`, `Country`, `IsRefund`. ייעוץ Supabase (8.10): להשאיר את `cardcom_payment_sessions` (אפשרות A) — מזהה סשן הוא מצב תפעולי של הספק ולא עובדה כספית; הקוד כבר עוקב אחרי התבנית הבטוחה (שורה ממתינה ← פנייה לספק ← שמירת המזהה ← רק אז מוסר ללקוח; נכשלה השמירה — המזהה לא נמסר, ולכן אי אפשר לשלם עליו). עמודת `payment_operations.provider` נשארת `sumit` וסימון CardCom רק ב-`meta.provider`. | במסוף האמיתי: איזה סוג מסמך `Document Auto` מפיק לעוסק פטור (נדרשת קבלה, חשבונית מס אסורה), והאם יש מע"מ במסמך; האם כתובת/טלפון צריכים להישלח ב-`Create` כדי להופיע |

**בדיקות שנכתבו ללא התנהגות אמיתית מאחוריהן:** הרכיב `cardcom-open-fields-form` נבדק מול `postMessage` מדומה, לא מול ה-iframe של CardCom. מה שה-iframe באמת עושה (U11–U14) ייבדק רק בדפדפן אמיתי מול מסוף.

**מה נשאר (בסדר):**
1. **פריסה** (`npm run deploy`, הפקודה שלך).
2. **הזנת פרטי המסוף האמיתי** ב-`/admin/integrations/cardcom` (סיסמת ה-API שם, לא בצ'אט). המתג נשאר כבוי עד שתדליק.
3. **קבלה אמיתית (סעיף 7):** רכישת ₪1 והחזר, כל הרצה באישורך, כולל בדיקה שהמסמך שבוטל הוא הנכון (U15) ושהכסף חזר (U1).
4. אופציונלי: ריצת למידה על מסוף הבדיקות (S1) לפני כן, וקריאת מאמר ההחזר החלקי וכרטיסי הבדיקה.
5. אחרי הקבלה: החלטה על מעבר מלא (תכנית נפרדת) או הסרת הפיילוט (סעיף 8).
