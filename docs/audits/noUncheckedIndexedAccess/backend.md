# ניתוח backend, שכבת נתונים וכלי שרת — noUncheckedIndexedAccess

תאריך ניתוח: 2026-10-28. מקור: `noUncheckedIndexedAccess.md`, שהמשתמש צירף כפלט של `npx --no-install tsc --noEmit -p tsconfig.typecheck.json --noUncheckedIndexedAccess`.

## כיסוי ושיטת עבודה

נבדקו **226 מופעי אבחון, 226 אבחנות ייחודיות, 65 קבצים**. ייחודיות כאן היא `(file, line, column, code, message)`; אין כפילויות בחלק זה. נבדקו כל מיקומי המקור המדווחים עם הקשר מקומי, והורחבה הקריאה בנתיבי הרשאות, חיוג, RSVP, billing, import, worker ו-relocation. הטבלה בסוף כוללת כל קובץ וכל מספר שורת מקור מדווח. פירוט עמודות והודעות מלא נמצא במיפוי הכולל של צוות הניתוח.

החלוקה היא לפי נתיב: קבצים שאינם test/spec תחת `src/lib`, `src/app/api`, וכן `worker`. היא **אינה סיווג של סביבת ריצה**: `staff-table-rls.ts` מחולל בדיקות RLS, `local-integration.ts` הוא harness של בדיקות, וכלי relocation/CLI מופעלים בנפרד. אין להסיק שכל 226 האבחנות הן תקלות ביישום החי.

בסוכן זה לא הורצו compiler, בדיקות, שאילתות DB, קריאות ספקים או scripts תפעוליים. הסוכן הראשי אימת בנפרד baseline ללא הדגל (exit 0) ושחזור עם הדגל (exit 2), ודיווח שהפלט זהה בתים לפלט המצורף; גרסאותיו המאומתות: TypeScript 6.0.3, Next.js 16.4.3, Vitest 5.0.4. לא בוצע תיקון קוד. אבחנת TypeScript אינה לבדה הוכחה לתקלה שניתנת להגעה בזמן ריצה. תנאי length, regex ומקורות קבועים מספקים לעיתים invariant תקין שאינו מיוצג בטיפוס. לא בוצעה הוכחה פורמלית של כל callers או של סכימת ה-DB החיה.

## ספירות לפי קוד

| קוד | מופעים |
|---|---:|
| TS18048 | 88 |
| TS2322 | 65 |
| TS2532 | 39 |
| TS2345 | 25 |
| TS2538 | 6 |
| TS2769 | 3 |
| **סה״כ** | **226** |

## ממצאים מרכזיים

### 1. הרבה אבחנות מצביעות על invariant קיים, ולא על בחירה לא מוגנת

`src/app/api/events/[eventId]/outreach-call/route.ts:90–101` דוחה אפס וריבוי קמפיינים לפני `campaigns[0]`; `whatsapp-es.ts:211–242` עושה זאת עבור WABA ומספר טלפון; `headcount.ts:103–104`, `webhook-processing.ts:444–445`, `outreach-calls.ts:297` ו-`whatsapp-import.ts:473–496` מגבילים שיוך לאורח/אירוע יחיד. `callback-scheduling.ts` ו-`event-exchange-sync.ts` מגבילים חיבור עסקי ליחיד. אין בסיס מהאבחנות האלה לטענה שקיימת עקיפת הרשאה או בחירה בין מספר בעלי נתונים.

תיקון עתידי צריך ללכוד את האיבר ולבדוק אותו, תוך שימור הסיבה העסקית לדחייה. הוספת fallback לרשומה אחרת, סינון גורף של undefined, או המרת ambiguity לראש הרשימה עלולים לשנות את הגבול העסקי שהקוד כבר אוכף.

### 2. הרחבת מפות ל-Record<string, T> מייצרת חוזה חלש מדי

`platform-ability.ts:82–85` ו-`staff-table-permissions.ts:155–156` מרחיבים מפות CASL ידועות ואז מאבדים ודאות על תוצאת lookup. אלה מוקדי עדיפות בשל תפקידם בשערי הרשאות, לא משום שהפלט מוכיח bypass. יש לשמר קשר subject/action ולדחות invariant חסר; אסור לפתור את `operationKeys` באמצעות `?? []` ללא הבנת המשמעות של אפס דרישות.

`exchange-connections.ts:354–360` מגדיר `provider_error` מפורש אבל כל המפה מוקלדת כ-Record רחב. לכן גם fallback קיים מקבל `string | undefined`, וגורם לעשר אבחנות. הכרזה עם מפתחות קונקרטיים ו-lookup שנבדק תטפל בשורש בלי לשנות מסרים עסקיים. דפוס דומה נמצא ב-RANK, עמודות CSV, צבעים, avatars ומפת מספרי Cardcom. `Object.hasOwn` לבדו אינו מצמצם כאן את טיפוס הערך המדווח.

### 3. 26 אבחנות WhatsApp delivery מקורן באובדן מבנה של תוצאות קבועות

ב-`owner-agent/cores/whatsapp-delivery.ts:83–109` נשלחות שבע שאילתות status ב-Promise.all, ואז `.map(countOf)` מחזיר מערך רגיל. Destructuring של שבעה איברים אינו משמר tuple. בנוסף `codeCounts[indexOf(code)]` אינו מבטא בטיפוס שכל קוד מופיע בקטלוג ובאותו סדר תוצאות.

המלצה: שימור tuple של התוצאות/ספירות ומיפוי קוד לספירה עם בדיקה בגבול בניית המפה. אין להחליף תוצאה חסרה ב-0: זו יכולה לייצר נתוני דיווח שגויים ולכסות כשל של count. גם `billing.ts:77–83`, `rsvp.ts:66–68` ו-`tax-ceiling.ts:34–35` כבר דורשים שורת RPC יחידה; יש לשמר את בדיקות הסכומים ולטפל בשורת התוצאה עצמה.

### 4. cursor של תור הוא גבול שדורש בדיקה מקומית

`outreach-engine.ts:795–805` ו-`worker/main.ts:481–490` בודקים `cursor >= schedule.length`, אך אינם בודקים לפני planRev ש-`schedule[cursor]` קיים. cursor שלילי עובר את בדיקת הגבול העליון. במיגרציית יצירת `outreach_state` שבמאגר (`202606290032_outreach_state.sql:18`) העמודה היא integer עם default 0; לא נמצאה בבדיקת טקסט ממוקדת במיגרציות הגבלת non-negative. לא נבדקה הסכימה החיה ולכן אין קביעה שאין constraint נוסף בשרת.

זהו מסלול קלט פגום אפשרי, לא תקלה שנצפתה. תיקון צריך להבחין בין סוף schedule תקין לבין cursor פגום, לשמור את מנגנוני CAS/idempotency/planRev, ולהימנע משליחה או מעבר אוטומטי לצעד 0. שינוי schema, אם יידרש, הוא עבודה נפרדת עם בדיקת הנתונים והצרכנים.

### 5. בדיקת env בשלב check אינה חוזה עבור apply/verify

`relocation/steps.ts` קורא שוב `.env.local` בכל שלב. ב-F3 וב-F7 `check` מאמת שמפתחות קיימים, אך `apply` קורא אובייקט חדש ומעביר `META_APP_ID`, `GA4_PROPERTY_ID` ו-`GA4_STREAM_ID` ללא אימות מקומי. F1 apply בודק project URL, בעוד verify בשורה 618 לא עושה זאת; G1 כולל תבנית דומה ב-apply/verify/rollback.

יש לאמת ערכי חובה בכל גבול צריכה ולשמר latch. אין להסתפק ב-`as string`: הקובץ יכול להשתנות בין שלבים. `projectRefFromSupabaseUrl` בונה URL וזורק על host לא מתאים; אין בסיס להניח כאן שינוי לפרויקט אחר. ההשפעה הצפויה מנתון חסר היא כשל תפעולי/בקשה פגומה, לא הצלחה שקטה מוכחת. לא הורצו שלבים אלה.

### 6. parsing, bytes ולולאות הם משפחות נפרדות

Regex captures חובה (`console-agent`, `event-date`, `inquiry-mail-intake`, env parsers) דורשים guard של capture בלי לאפס שדה חובה. רכיבים אופציונליים ב-WALL_CLOCK צריכים להישאר אופציונליים. פירוק זמן ותאריך צריך לשמור בדיקות calendar/finite ולא להמיר חלק חסר ל-0. `sendPolicySchema` כבר מאמת HH:mm לצרכני המדיניות; helper exported עדיין מקבל `string` ולא מבטא זאת בחוזה.

Buffer/hash באורך קבוע (`deterministic-id`, `voice-agent-actions`) אינו דומה לנתון חיצוני חסר. API של byte קריא בטווח ידוע יכול לשמר את הבתים וה-UUID. ייצור סיסמה דורש גם שמירת CSPRNG, אלפבית לא ריק ודרישות החוזק. אין להפוך byte חסר ל-0 או char חסר למחרוזת ריקה כדי לרצות את compiler.

לולאות חסומות (`fleet/conversation`, `guests`, CLI) מייצרות אבחנות על אינדקסים אף שהאלגוריתם מגביל אותם. `entries`, איבר מקומי שנבדק, ו-tuples עוזרים לבטא את ההבטחה. ב-`guests.ts:912` יש בנוסף הנחת התאמה בין סדר `rows` לתוצאות insert; נטרול TS2532 אינו מוכיח את הנחת סדר הנתונים, ולכן יש לבדוק התאמה זו בנפרד אם משנים את הלולאה.

## סדר טיפול ואימות מומלץ

P1/P2/P3 בטבלה הם **סדר עבודה במעבר לטיפוס מחמיר**, ולא דירוג חומרת exploit מאומת. P1: הרשאות, שיוך בעלי נתונים, env לפני פעולות, cursor ותזמון. P2: חוזים חוזרים, דיווחים, parsers וכלי בדיקות. P3: תצוגה/עזר פשוטים בעלי invariant ברור.

1. להגדיר תיקונים לפי שורש: מפתחות סגורים, exact-one guards, tuple preservation, parsing, cursor ו-env. לא לטפל בכל אבחנה כאילו היא שורש עצמאי.
2. במבדקי הרשאות לבדוק זוג subject/action חסר/לא תואם וכישלון שממשיך לדחות; לבדוק שלא מתקבלת רשימת דרישות ריקה בטעות.
3. בזרימות בעלי נתונים לבדוק 0/1/2 תוצאות, שגיאת DB והעדר פעולת send/mutation במקרה שאין בחירה חד-משמעית. RPC סכומים חסר/מרובה/לא מספרי צריך לשמר כישלון.
4. ב-worker לבדוק cursor שלילי, סוף schedule, job ישן, planRev שונה והעדר dispatch במצב פגום. במפות דיווח לבדוק את כל שבעת הסטטוסים וכל קודי הכשל בלי להסתיר query error.
5. ב-relocation להשתמש ב-unit tests עם API/process mocks, ערכי env חסרים והחלפת הקלט בין check ל-apply; אין צורך בהרצת relocation אמיתי כדי לאמת narrowing.
6. להשוות compiler baseline מול הדגל באותו snapshot, להריץ בדיקות ממוקדות לאחר מימוש, ובהמשך בדיקות הפרויקט הרגילות. בדיקות type בלבד אינן מוכיחות התנהגות ספק חי, הרשאות DB חיות או פריסה.

## מלאי מלא לפי קובץ

מספרי השורות הם מיקומי הפלט המקורי; כמה עמודות באותה שורה נספרות כמספר אבחנות, אך השורה מוצגת פעם אחת. כל הנתיבים יחסיים לשורש המאגר.

| קובץ | אבחנות | שורות | עדיפות | סיווג לפי המקור | כיוון תיקון ואימות |
|---|---:|---|---|---|---|
| `src/app/api/events/[eventId]/outreach-call/route.ts` | 1 | 147 | P1 | exact-one אחרי בדיקת 0 וריבוי קמפיינים | לשלוף campaign ולבדוק את הערך תוך שימור 409; לא לבחור קמפיין כשיש עמימות. |
| `src/app/api/voximplant/ctx/[token]/route.ts` | 1 | 43 | P3 | split על מחרוזת | לתת ערך ריק מפורש או להשתמש בפירוק שהחוזה שלו כולל string; split של מחרוזת רגילה תמיד כולל איבר ראשון. |
| `src/app/api/webhooks/whatsapp/route.ts` | 1 | 106 | P2 | Set ומפת event_kind נפרדים | לאחד מקור מפתחות ולבדוק kind לפני יצירת inbox; המפות תואמות כעת אך הטיפוס רחב. |
| `src/lib/agreements/pdf-html.ts` | 7 | 177, 181, 206, 207, 208, 209, 399 | P2 | מפה פתוחה, captures ו-1–4 ערכי CSS | לשמר fail על CSS לא חוקי; לבדוק capture/איבר ראשון, ולשמר מפת צבעים סגורה. אין להחזיר צבע מומצא. |
| `src/lib/auth/console-agent.ts` | 1 | 36 | P1 | capture חובה ב-Bearer regex | לשלוף ולבדוק קבוצת token; לשמר null על Authorization לא תקין. |
| `src/lib/auth/platform-ability.ts` | 1 | 85 | P1 | אובדן הקשר subject/action עקב Record<string,...> | לשמר זוגות מותרים; guard על מפתח חסר צריך לדחות/לזרוק ולא להסיר אותו בשקט ממערך ההרשאות. |
| `src/lib/auth/staff-table-permissions.ts` | 1 | 156 | P1 | CASL action lookup רחב | מיפוי מדויק או בדיקת invariant; אין להחזיר [] בשל מפתח חסר משום שזו רשימת דרישות הרשאה. |
| `src/lib/auth/staff-table-rls.ts` | 18 | 287, 288, 289, 292, 293, 295, 296, 299, 300, 321, 322, 336, 337, 342 | P2 | fixtures נבדקים מראש בלולאה אחרת | guard מקומי לפני יצירת SQL; 18 אבחנות משורש אחד. זה מחולל בדיקות RLS, לא 18 חולשות בפרודקשן. |
| `src/lib/calendar/event-calendar.ts` | 3 | 130 | P2 | פירוק תאריך לשלושה מספרים | parser מחזיר tuple לאחר בדיקת רכיבים ותקפות; לשמר יום ישראלי/all-day. |
| `src/lib/callbacks/policy-config-admin.ts` | 1 | 45 | P3 | תו ראשון בשם יום קבוע | charAt או מיפוי מפורש של ימים; אין צורך בשינוי מדיניות השעות. |
| `src/lib/callbacks/schedule-policy.ts` | 2 | 103 | P2 | Intl HH:mm מפורק למערך | לאמת שני רכיבים או formatToParts עם guard; לבדוק גבולות יום ו-DST. |
| `src/lib/cardcom/document-types.ts` | 1 | 55 | P2 | Object.hasOwn אינו מצמצם indexed value | לשלוף לערך מקומי ולשמר null למספר דוח לא מוכר; מפת קודים סגורה. |
| `src/lib/data/admin/activity.ts` | 1 | 114 | P3 | split של action | פירוק עם ברירת מחדל המותאמת לחוזה; לא לשנות guest label. |
| `src/lib/data/admin/integrations/whatsapp-es.ts` | 5 | 228, 241, 242, 249, 265 | P1 | exact-one ל-WABA ולמספר טלפון | בדיקת האיברים עצמם לפני API/subscribe; לשמר סירוב ל-0 או לריבוי. |
| `src/lib/data/admin/owner-agent.ts` | 4 | 223, 497, 536, 563 | P1 | מערכים מקבילים ונתוני mutation שאינם ריקים | entries או pairing מפורש ל-id/read; guard לאיבר data לפני audit תוך שימור שגיאות not-found. |
| `src/lib/data/admin/whatsapp-templates.ts` | 1 | 281 | P1 | איבר ראשון אחרי delete+select לא ריק | guard מקומי; לשמר audit של התבנית שהוסרה ושגיאת מסלול חסר. |
| `src/lib/data/callback-scheduling.ts` | 3 | 116, 118, 123 | P1 | exact-one חיבור עסקי | בדיקת row לפני שימוש; לשמר הבחנה no_verified_connection/ambiguous_connection. |
| `src/lib/data/console-agent-provisioning.ts` | 5 | 59, 68, 69 | P1 | Buffer byte ואינדקסים ב-password shuffle | קריאת byte בטוחה ו-guard על alphabet/איברי swap; לשמר CSPRNG ודרישות חוזק, לא fallback שמקצר סיסמה. |
| `src/lib/data/console-calls.ts` | 3 | 167, 3403 | P2 | פירוק שעה וראש רשימה ממוינת לא ריקה | parser שעה; החזרת candidate עם null לפי החוזה. לשמר ranking שמשפיע גם על שיוך אירוע. |
| `src/lib/data/console-sdk-auth.ts` | 1 | 90 | P1 | שם SDK קצר מ-split | שליפה ובדיקת shortName לפני hash; לא לשנות את פרוטוקול החתימה. |
| `src/lib/data/coupon-benefits.ts` | 1 | 139 | P2 | active[0] אחרי length>0 | ראש רשימה שנבדק; לשמר בחירת מחיר ותאריך תפוגה. |
| `src/lib/data/event-date.ts` | 5 | 155, 156, 157, 158, 159 | P2 | קבוצות חובה/רשות ב-WALL_CLOCK | guard לרכיבי חובה בלבד; לשמר שניות/שבר אופציונליים ו-null על זמן לא תקין. |
| `src/lib/data/event-exchange-sync.ts` | 3 | 92, 94, 96 | P1 | exact-one חיבור business sync | guard row תוך שימור fail-closed של אין/ריבוי חיבורים. |
| `src/lib/data/event-lifecycle.ts` | 3 | 108, 115 | P2 | mode יחיד ו-map nodes של XState | בדיקת mode ונתיב open/service; לא להחליף mode חסר ב-setup שרירותי. |
| `src/lib/data/exchange-connections.ts` | 10 | 381, 392, 418, 436, 503, 553, 602, 636, 652, 727 | P2 | ERROR_MESSAGES כ-Record<string,string> | לשמר provider_error כמפתח קונקרטי ו-fallback ודאי; עשר אבחנות מאותה הכרזה רחבה. |
| `src/lib/data/guests.ts` | 2 | 918, 924 | P2 | data[i] בתוך לולאה חסומה | entries לשימור row וזהות בלוג; הקשר הסמנטי rows[i]↔data[i] דורש אימות נפרד מסדר תוצאות DB. |
| `src/lib/data/headcount.ts` | 5 | 110, 116, 124, 125, 140 | P1 | exact-one אורח לפני headcount mutation/send | guard guest עם אותו return false; לשמר no-guessing וקצב הניסיונות. |
| `src/lib/data/inquiry-mail-intake.ts` | 1 | 102 | P2 | capture חובה בקוד פנייה | guard capture ו-upper-case; לא להחליש בדיקת שולח/שיוך פנייה. |
| `src/lib/data/instagram-token-refresh.ts` | 4 | 87, 106, 107, 108 | P2 | captures של ENV_LINE_RE | בדיקת key/value לפני שימוש; לשמר ערך ריק חוקי וכתיבה של יתר השורות ללא שינוי. |
| `src/lib/data/outreach-calls.ts` | 1 | 297 | P1 | exact-one אורח בקישור שיחה | בדיקת guest עם null כשעמום; אין לבחור אורח ראשון במקרה ריבוי. |
| `src/lib/data/outreach-engine.ts` | 2 | 805, 822 | P1 | cursor מה-DB מול schedule | לבדוק integer/non-negative וקיום tp לפני planRev; לשמר exhausted בקצה ו-CAS/idempotency. |
| `src/lib/data/tax-ceiling.ts` | 1 | 35 | P2 | RPC billing יחיד אחרי length===1 | guard שורת סכום; לשמר return על שגיאה ולא להפוך נתון חסר ל-0. |
| `src/lib/data/webhook-processing.ts` | 3 | 446, 452, 458 | P1 | exact-one אורח לפני RSVP/headcount | guard guest; לשמר מניעת שיוך שרירותי, fresh ודדופליקציה. |
| `src/lib/data/whatsapp-import.ts` | 8 | 260, 271, 276, 278, 280, 544, 552, 569 | P1 | CSV header, מפת עמודות פתוחה ואירוע יחיד | מפת מפתחות סגורה ו-header נבדק; ownerEvent נבדק אחרי 0/ריבוי, בלי לשנות routing/authorization. |
| `src/lib/data/widget-sdk-auth.ts` | 1 | 61 | P1 | שם widget קצר מ-split | בדיקת shortName לפני hash; לא fallback לחשבון אחר/שם ריק. |
| `src/lib/date.ts` | 6 | 151, 188, 198 | P2 | טבלאות גימטריה ופירוק YMD | טווחים/tuples או guards; לאמת גם תאריך אמיתי, לא רק regex; לא לאפס רכיב חסר. |
| `src/lib/email/health.ts` | 1 | 163 | P2 | capture כתובת אימייל | guard capture; לשמר null לשולח לא תקין. |
| `src/lib/fleet/agent-avatars.ts` | 1 | 28 | P3 | Object.hasOwn על מפת avatars | ערך מקומי עם null למפתח חסר; לשמר תמונה קיימת. |
| `src/lib/fleet/business-facts.ts` | 5 | 83, 98, 99, 100 | P2 | מערכים שווי אורך ו-packages לא ריק | בדיקת first והאיבר המקביל; לשמר השוואת cadence ולא לייצר עובדות מחיר חסרות. |
| `src/lib/fleet/conversation.ts` | 17 | 118, 376, 380, 386, 388, 391, 398, 399, 405, 407, 408, 410, 411 | P2 | RANK רחב וגישה באינדקס ללולאת stream | מפת rank מלאה, guards מקומיים וראש run; לשמר קיבוץ ימים/מחבר/run ולא cast ל-MessageEvent[]. |
| `src/lib/fleet/housekeeping-pr.ts` | 1 | 176 | P2 | findIndex שבדק -1 | לכוד line אחרי guard; לשמר כישלון כאשר match נעלם. |
| `src/lib/fleet/publish-social.ts` | 2 | 166 | P2 | גבולות תווים במחרוזת | charAt/ברירת מחדל ריקה בגבולות; לשמר בדיקת מילים ושלילה בעברית. |
| `src/lib/microsoft/subscriptions.ts` | 4 | 149, 151, 153 | P2 | mine לא ריק לפני sort/destructure | guard keep לפני מחיקת כפילויות/renew; לשמר longest-lived. |
| `src/lib/ops/db-health.ts` | 6 | 77, 78, 79, 80, 81, 82 | P2 | RPC לא ריק | guard row ושמירת SoftResult false; לא להמציא מדדי בריאות 0. |
| `src/lib/outreach/send-policy.ts` | 2 | 47 | P1 | HH:mm אחרי schema אך helper מקבל string | parser תקין או חוזה פנימי מצומצם; קלט פגום צריך כישלון ולא דקות NaN/0. |
| `src/lib/outreach/send-window.ts` | 2 | 40 | P1 | Intl שעה לחלון שליחה | parser/formatToParts עם guards; לשמר DST, שבת וחלונות קיימים. |
| `src/lib/owner-agent/consumer/reply-text.ts` | 1 | 149 | P2 | parts.length===1 | לכוד first ולבדוק; אין לשנות סדר burst או להעלים חלק. |
| `src/lib/owner-agent/cores/billing.ts` | 4 | 80, 81, 82, 83 | P1 | RPC billing עם exact-one | guard row; amount כבר מאמת ערכים, לא להחליף חסר ב-0. |
| `src/lib/owner-agent/cores/rsvp.ts` | 2 | 68 | P1 | RPC RSVP עם exact-one | guard row; לשמר people validator ולא להציג ספירה מומצאת. |
| `src/lib/owner-agent/cores/whatsapp-delivery.ts` | 26 | 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 129, 130, 131, 132, 133, 134, 135, 137 | P2 | map מאבד tuple ו-indexOf על קטלוג קבוע | לשמר tuple של שבע הספירות ולבנות מיפוי קוד↔count נבדק; לא ??0 שמסתיר כשל שאילתה. |
| `src/lib/owner-agent/runner.ts` | 1 | 421 | P2 | capture assignment ב-env file | guard קבוצה; לשמר unquoting וערך ריק מכוון. |
| `src/lib/queue/deterministic-id.ts` | 2 | 23, 24 | P2 | אינדקס byte בתוך SHA1 digest | readUInt8/כתיבה בטווח מוכח; לשמר בתים ותוצאת UUID בדיוק. |
| `src/lib/relocation/engine.ts` | 1 | 406 | P3 | split ראשון לסניטיזציה | ברירת מחדל ריקה או חיתוך first newline; לשמר 200 תווים והסתרת נתיבים. |
| `src/lib/relocation/install-steps.ts` | 1 | 440 | P2 | פקודת startup מפלט PM2 | בדיקת cmd לאחר parsing; prefixed line מבטיחה כיום token אך החוזה string[] אינו מבטא זאת. |
| `src/lib/relocation/pm2.ts` | 4 | 56, 71, 84, 121 | P2 | argv קבוע כ-string[] ו-regex env | non-empty tuple ל-builders ו-guards ל-captures; לשמר latch ו-scrubbed env. |
| `src/lib/relocation/preflight.ts` | 1 | 108 | P2 | keys(env) ואז env[k] | Object.entries מסיר lookup שני; לשמר סריקת origins ללא הדפסת ערכי סודות. |
| `src/lib/relocation/steps.ts` | 9 | 618, 698, 882, 883, 996, 1067, 1094, 1118 | P1 | env שנקרא מחדש ו-urls[0] | לאמת ערכי חובה בתוך apply/verify/rollback; check קודם אינו narrowing. לאמת URL item לפני יצירה. |
| `src/lib/relocation/voximplant-relocate.ts` | 1 | 133 | P3 | ראש תוצאת readdir אחרי length>0 | candidate ?? null; בחירת application ראשון היא התנהגות קיימת ולא פתרון חדש לעמימות. |
| `src/lib/testing/local-integration.ts` | 1 | 552 | P2 | ROOTS[r.root] מטא-דאטה של FK | בדיקת root לפני ids lookup; invariant חסר צריך לעצור cleanup, לא להרחיב מחיקה. כלי בדיקות מקומיות. |
| `src/lib/text/substitute-tokens.ts` | 2 | 17, 25 | P2 | hasOwn על values ו-capture matchAll | ערך מקומי ובדיקת undefined; לשמר מחרוזת ריקה כערך חוקי ו-token לא מוכר כמות שהוא. |
| `src/lib/voximplant/cli-support.ts` | 7 | 88, 89, 105, 733, 762, 775 | P2 | argv/header בתנאי גבולות | entries/איבר מקומי; לשמר flags duplicates/value-less ועמודות CSV חסרות. |
| `src/lib/whatsapp/client.ts` | 1 | 236 | P1 | bodyParams[0] אחרי length>0 | destructure ראשון שנבדק; לשמר תוכן ותצורת הודעה ללא הוספת פרמטר ריק. |
| `src/lib/whatsapp/template-route.ts` | 1 | 219 | P2 | capture VARIABLE ב-matchAll | בדיקת קבוצת variable; לשמר reject של משתנים בשמות ו-slots מספריים. |
| `src/lib/workflow/voice-agent-actions.ts` | 2 | 27, 28 | P2 | 16 bytes של digest | API קריאת byte או guard; לשמר UUID/correlation ו-idempotency. |
| `worker/main.ts` | 1 | 490 | P1 | cursor מה-DB עם בדיקת גבול עליון בלבד | guard על tp ומדיניות cursor פגום לפני planRev; לשמר stale-job, planRev ודטרמיניזם. |

## גבולות המסקנות

המיפוי מלא ביחס ל-226 האבחנות שהוקצו לחלק זה; העמקה ב-callers וב-invariants התמקדה במוקדים המפורטים לעיל. לא בוצעה ביקורת מלאה של כל מודול מעבר למיקומי האבחנות, לא התקבלה ראיית כשל בזמן ריצה, עדכניות פלט ה-compiler אומתה על ידי הסוכן הראשי כפי שמפורט לעיל; התנהגות בזמן ריצה לא אומתה. הדוח אינו אישור להפעיל scripts תפעוליים, לבצע migration או לשנות הרשאות.
