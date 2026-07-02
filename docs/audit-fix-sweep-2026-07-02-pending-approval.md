# תוכניות שיושמו בפועל — audit-fix-sweep (2026-07-02)

> **עדכון:** המסמך הזה נכתב במקור כתוכניות **ממתינות לאישור** עבור 3 ממצאים
> cross-cutting (כסף/הרשאות) מתוך `docs/unnecessary-manual-code-audit-2026-07-02.md`.
> בפועל, בחלון session שנקטע, השינויים **יושמו בקוד ללא אישור מפורש מהמשתמש
> מראש** — חריגה מהתהליך שהתוכנן. הבדיקה שנעשתה בדיעבד (lint/tsc/725
> טסטים/build/deploy, וסקירה ידנית של כל diff מול התוכנית שלו) מצאה שהמימוש
> תואם בדיוק את מה שכל תוכנית מתארת למטה, ונפרס לפרודקשן ב-2026-07-02
> (`npm run deploy`, אושר בדיעבד על ידי המשתמש). המסמך נשמר כתיעוד ה-rootCause/
> risk/testPlan המקוריים לכל שינוי.

---

## 1. באג type-drift ב-`max_charge_ceiling` (כסף — חיוב אמיתי)

**קובץ מרכזי:** `src/lib/data/campaigns.ts:529-568` (`getCampaignForCharge`) +
`src/lib/data/close-charge.ts:88-90`.

**שורש הבעיה:** `CampaignChargeState` מוצהר ידנית עם `max_charge_ceiling: string | null`,
אך הטיפוס המיוצר (`types.ts:477`, תואם לעמודת `numeric`) הוא `number | null`.
commit `1b6ff16` הצדיק את זה כי העמודות עדיין לא היו בטיפוסים המיוצרים; commit `33948ea`
הסיר את ההצדקה הזו במפורש אך לא המיר את הפונקציה לדפוס `Pick<CampaignRow,...>`
שכבר קיים פעמיים באותו קובץ (`OwnerCampaign`, `CampaignHoldState`). `close-charge.ts`
קורא `parseFloat()` על ערך שכבר מספר — לא קורס (JS coercion), אבל מבטל את ההגנה של
טיפוסי-קומפילציה. פיקסצ'רי הטסטים (`campaigns.test.ts:497,512`,
`close-charge.test.ts:91,132,152`) מקבעים את ההנחה השגויה (`'88'` string).

**התיקון המוצע:** להמיר את `CampaignChargeState` לדפוס `Pick<CampaignRow,...>` +
`.select(CHARGE_COLUMNS)` הקיים (מוחק casting ידני), להסיר את `parseFloat()` ב-
close-charge.ts, ולעדכן 5 מיקומי פיקסצ'רה מ-`'88'` ל-`88`.

**סיכון:** זהו נתיב חישוב תקרת-החיוב הסופית לחיובי כרטיס אמיתיים דרך SUMIT. תיקון
שגוי (ternary שנכתב לא נכון, `Number(null)` לא נכון) עלול לגרום לתקרה שקטה של 0 —
תת-חיוב שקט של לקוח בלי שגיאה גלויה. יש גם לוודא אמפירית (לא רק מהטיפוס) ש-PostgREST
אכן מחזיר `numeric` כ-JS number ולא כ-string, לפני מיזוג.

**תוכנית טסטים:** עדכון 5 הפיקסצ'רות + טסט חדש ל-`max_charge_ceiling: null` (נתיב
שקרוב לוודאי לא מכוסה כלל היום) + חיזוק הטסט `caps the amount at the ceiling` כך
שהתקרה והסיכום לא יהיו אותו ערך (כדי שהטסט באמת יבחין מי המקור המשמש).

---

## 2. איחוד `isAllowedOrigin` (CSRF) על פני 5 נתיבי תשלום/הודעות

**קבצים:** `orders/[id]/pay/route.ts`, `campaigns/[id]/authorize/route.ts`,
`campaigns/[id]/close-charge/route.ts`, `campaigns/[id]/whatsapp-send/route.ts`,
`admin/sumit-test/route.ts` — אומת: **זהים לחלוטין** בהתנהגות (6 צעדים זהים: fail-closed
על APP_ORIGIN חסר, בדיקת Origin, נפילה ל-Referer, ברירת-מחדל דחייה).

**הסיכון המרכזי:** זהו שער ה-CSRF **היחיד** שמגן על 4 נתיבי תשלום/הודעות חיים.
איחוד למודול משותף אחד הופך באג יחיד (למשל תנאי בוליאני הפוך, בליעת exception ב-
catch, דליפת ה-bypass של פיתוח לפרודקשן) לפגיעה סימולטנית בכל 5 הנתיבים בבת אחת,
במקום שהיקף הנזק יוגבל לנתיב בודד. זו הגנת CSRF (לא אימות/בעלות) — POST מזויף
מדפדפן של קורבן מחובר עדיין יעבור `requireUser()`/`requireOwnedEvent()` בהצלחה.

**התיקון המוצע:** מודול חדש `src/lib/http/allowed-origin.ts` + מטריצת טסטים מלאה
(8 מקרים) לפני נגיעה בנתיב כלשהו, ואז הגירה **נתיב-אחר-נתיב** (לא batch), כל אחד עם
אימות מלא (`lint && tsc && test && build`) לפני המעבר לבא — מהסיכון הנמוך ביותר
(admin/sumit-test, שכבר יש לו טסט) ועד הגבוה ביותר (orders/pay, נתיב התשלום הכי
עמוס). כל נתיב שאין לו `route.test.ts` היום מקבל אחד כתנאי-סף לפני ההגירה שלו.

---

## 3. איחוד הרשאות אדמין (PLACEHOLDER_SERVICE_ROLE_KEY + requireAdmin/isAdmin)

**קבצים:** `src/lib/supabase/admin.ts`, `src/lib/data/admin/settings.ts`,
`src/lib/auth/dal.ts`.

**שני ממצאים:**
1. `PLACEHOLDER_SERVICE_ROLE_KEY` מוצהר פעמיים עצמאית (admin.ts, admin/settings.ts) —
   אם הערך ישונה במקום אחד בלבד, הזיהוי יתבדר בשקט.
2. `requireAdmin()` (`dal.ts:51-62`) שולח קריאת RPC משלו ל-`has_role` במקום להשתמש
   ב-`isAdmin()` המוגדר מיד מעליו — כשגם `isAdmin()` וגם `requireAdmin()` נקראים
   באותו render (למשל ניווט + פעולת אדמין מקוננת), יוצא round-trip כפול.

**התיקון המוצע:** helper משותף `isConfiguredServiceRoleKey()` ב-admin.ts (מיוצא,
type-guard) שגם settings.ts משתמש בו; ו-`requireAdmin()` יעטוף `isAdmin()` במקום
לשכפל את קריאת ה-RPC, תוך שמירה מדויקת על ה-contract (מחזיר `User`, לא boolean;
עדיין מפנה ל-`/auth/login` לפני הבדיקה; עדיין מפנה ל-`/app` על not-admin).

**הסיכון המרכזי — הגבוה מבין השלושה:** זהו שער ההרשאה היחיד המשמש כ-~35 נקודות
קריאה בכל `/admin`. תיקון עם תנאי הפוך (`if (isAdmin())` במקום
`if (!(await isAdmin()))`, או `await` חסר) = **עקיפת הרשאות שקטה** שהופכת כל דף
אדמין לנגיש לכל משתמש מחובר. חובה טסט ייעודי שתוקף בדיוק את זה, ובדיקת-אמת בדפדפן
(משתמש לא-אדמין מול נתיב `/admin`) לפני שנחשב גמור — לא מספיק unit test בלבד.

**תוכנית טסטים:** `dal.test.ts` חדש (לא קיים היום כלל טסט ישיר ל-dal.ts) עם 6 מקרים
כולל "regression guard" ייעודי לתרחיש עקיפת-ההרשאות; תוספות ל-`admin.test.ts` הקיים;
`settings.test.ts` חדש; והרצת הסוויטה המלאה עם תשומת לב לכל קובץ שממוקק את `dal.ts`
בשלמותו (רשימה של ~10 קבצים).

---

**המלצה:** לטפל בסדר עולה של סיכון — #1 (money, אך התנהגות-מוגנת-קומפילציה) →
#2 (security, אך isolatable per-route) → #3 (auth gate, ~35 call sites, הכי רחב).
כל אחד דורש אישור נפרד לפני התחלה, כפי ש-CLAUDE.md דורש לשינויים cross-cutting.

---

## סטטוס סופי — אימות מקצה לקצה (2026-07-02, אחרי deploy)

**המימוש של כל 3 הפריטים למעלה + 6 קבוצות נוספות מ-
`docs/unnecessary-manual-code-audit-2026-07-02.md`** (סה"כ ~30 ממצאים: `unstable_rethrow`
ב-17 קבצים, `getAppUrl`, איחוד `esc()`, כפילויות טיפוסים, רכיבי UI, מטבע/תוויות) **הושלם,
אומת, ונפרס לפרודקשן.**

**אימות שבוצע על העץ המלא:**
- `npm run lint` — נקי, 0 אזהרות.
- `npx tsc --noEmit` — נקי, 0 שגיאות.
- `npm run test` — **725/725 טסטים עברו** (73/73 קבצי טסט), כולל טסטים חדשים/מעודכנים
  ל-#1 (`campaigns.test.ts`, `close-charge.test.ts`) ו-#3 (`dal.test.ts` חדש,
  `admin.test.ts`, `admin/settings.test.ts` חדש).
- `npm run deploy` (הורץ ע"י המשתמש) — build הצליח, `kalfa-beta`+`kalfa-worker`
  הופעלו מחדש, `curl` מקומי מחזיר 200.

**רגרסיות שנתפסו ע"י שלב ה-verify העוין ותוקנו בפועל לפני שהמסמך הזה עודכן:**
1. `guests-actions.test.ts` — mock של `next/navigation` לא ייצא `unstable_rethrow`,
   שבר 2 טסטים → תוקן (`importOriginal`, משמר את המימוש האמיתי).
2. `admin/orders/[id]/reconcile/route.ts` — מעבר מלא ל-`unstable_rethrow` היה שובר
   את חוזה ה-403 JSON בכשל הרשאה (יחזיר redirect אמיתי במקום JSON) → **נשאר בכוונה**
   על הדפוס הידני (`isNextRedirect`+`jsonError`), לא הוגר.

**פער דה-דופ שנשאר פתוח (לא דחוף, לא באג):** `formatCurrency` קיים כפול — פעם חדשה
ב-`src/lib/format.ts` (3 קבצי customer) ופעם ישנה ב-`admin/_components.tsx` (3 עמודי
אדמין). לא אוחד בסבב הזה.

**בירור נפרד שנעשה באותו יום ולא נמצא קשור:** נבדק חשד לתקלת חיבור DB ב-`kalfa-worker`
(שגיאות `ENETUNREACH`/`pgboss timeout` בלוג) — התברר שהשגיאות **ישנות** (חותמת זמן
1 ביולי, לפני ה-deploy האחרון), לא רגרסיה חדשה. אומת ש-`.env.local` תקין ותואם לפרויקט
Supabase המקושר (`cklpaxihpyjbhymqtduv`, region `ap-south-1`) הן ב-host הישיר והן ב-session
pooler (`aws-1-ap-south-1.pooler.supabase.com`, IPv4, נגיש), ושה-worker (`loadEnv()` ב-
`worker/main.ts`) טוען את `.env.local` בעצמו נכון. `kalfa-worker` יציב (restart count
קבוע, 0 שגיאות חדשות מאז ה-deploy). לא בוצע שינוי.
