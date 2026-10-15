# איחוד בדיקת הסוד של הקונסולה — תוכנית (15.10.2026)

**סטטוס: תוכנית בלבד. שום קוד לא שונה. כל שלב דורש אישור בעלים לפני ביצוע** (שינוי בשער אימות — לפי CLAUDE.md "אימות והרשאות": תוכנית, סיכונים, אימות, ואישור).
כל טענה מסומנת **[נמדד]** (נקרא בקוד, או הורץ בדיקה לקריאה בלבד) או **[מוסק]**. נבנתה מקריאה עצמאית של שני מומחים (אבטחה/הרשאות, ו-Voximplant), נסקרה על ידי סוקר הנדסי שלישי, וכל הנקודות המכריעות אומתו מחדש. הסקירה ההנדסית: **אישור עם שינויים, ללא חוסמים** — כל השינויים שלה נכנסו לכאן.

## 1. הבעיה

שישה נתיבים תחת `src/app/api/voximplant/console/` מחזיקים אותו בלוק ארבע שורות [נמדד]:

```ts
const expected = process.env.KALFA_CONSOLE_SECRET;
if (!expected) return json(<BODY>, 503);
if (!safeTokenEqual(<secret מהגוף>, sha256Hex(expected))) return json(<BODY>, 401);
```

הנתיבים: `authorize`, `call-me-now-authorize`, `widget-authorize`, `event`, `route-inbound`, `route-inbound-retry`.

**זו כפילות קוד ולא חולשה** — כל השישה משווים בזמן קבוע ונכשלים סגור. הסיכון בכפילות: נתיב שביעי שיועתק עם טעות, או תיקון שיגיע לחמישה מתוך שישה. הערך הוא תחזוקה ועקביות, **לא** הקשחת אבטחה — ולכן השינוי חייב להיות בלתי נראה למערכת החיה.

## 2. מה אסור לשנות (חוזה בלתי נראה) [נמדד]

הלקוחות הם שלושה תרחישי VoxEngine: `ConsoleDial`, `ConsoleInbound`, `ConsoleCallMeNow`. אין צורך בשינוי תרחישים או בפריסת `voxengine-ci`, **בתנאי** שנשמרים בדיוק:

| נשמר | למה |
|---|---|
| סדר הבדיקות: rate-limit ← תקרת גודל לפי header (413) ← תקרת גודל לפי בייטים (413) ← `JSON.parse` (400) ← Zod (400) ← `!expected` (503) ← השוואה (401) ← לוגיקה | הסוד בגוף, לכן אי אפשר לבדוק מוקדם. גוף פגום + סוד שגוי = 400, לא 401. אומת לפי מספרי שורות בכל שישה: זהה |
| ארבעה גופי כשל: `{ok:false}` (authorize ×3), `{ok:true}` גם ב-401/503/429 (event), `{accept:false}` (route-inbound), `{ring_order:[]}` ב-200 גם בחריגת rate-limit (route-inbound-retry) | התרחישים מפענחים אותם. ב-`event` התרחיש רק רושם את הקוד |
| `!expected` (falsy) — מחרוזת ריקה = 503 | שינוי ל-`=== undefined` הופך 503 ל-401 |
| קריאת ה-env **בכל בקשה**, לא בטעינת המודול | הטסטים מציבים את ה-env אחרי ה-import; אשף ההעברה מסובב את הסוד |
| גבולות ה-Zod: `secret: min(1).max(256)`, `strictObject` | רגישים לסדר פריסה (הערה ב-`validation/console-calls.ts` ~103) |
| מפתחות ומספרי ה-rate-limit (event: 300/דקה, השאר 120) ו-`Cache-Control: no-store` | Voximplant מגיעה מטווח IP קטן — המונים לפי IP פועלים כמונים גלובליים לנתיב |
| ה-helper סינכרוני וללא I/O | הבדיקה רצה על לגים שנענו, מוקלטים ומחויבים (`route-inbound` רץ לפני ענייה) |

הלקוחות מתייחסים ל-401, ל-503 ול-timeout **באותו אופן, ללא retry** [נמדד: נקראו קטעי הקריאה בשלושת התרחישים בעותק הריפו]: `ConsoleDial` ← `refuseOutbound(…, 'refused')`; `ConsoleInbound` ← `reject(603)`; `ConsoleCallMeNow` ← `declareNoAgent`, כלומר ללקוח האתר נשמע "אין נציג זמין" ולא ניתוק שקט; `route-inbound-retry` — כל תשובה שאינה מערך נקראת כ-ring ריק ← `declareNoAgent`. **timeout ושגיאת רשת מגיעים ל-`.then` כ-`code` ≤ 0 ולא ל-`.catch`**: לפי התיעוד החי `httpRequestAsync` מחזיר Promise ש"נפתר עם `HttpRequestResult`" (`platform/voxengine/api-requests`), וב-`HttpRequestResult.code` מוגדרים קודים שליליים לכשלי רשת, בהם `-7` = timeout (`api-reference/voxengine/net`) [שני העמודים נקראו במלואם]. התיעוד **לא** אומר במפורש שה-Promise לעולם לא נדחה, וכשל לא נוסה בפועל; לכן ענפי ה-`.catch` (`authorize_unreachable`, `gate_unreachable`) כנראה אינם הנתיב לכשל רשת, וכל כישלון — 401, 503 או timeout — נוחת, ככל הנראה, באותו ענף "refused" [מוסק מהתיעוד]. ה-timeout בשלושת התרחישים הוא 10 שניות (`GATE_HTTP_TIMEOUT_S`) [נמדד] — מה שיכול לשבור הוא דחיית סוד תקין, השהיה, או שינוי נתיב. **לא נבדק:** טקסט התרחיש **המפורס** (דורש `GetScenarios` עם `with_script`), האם הסוד בפלטפורמה שווה בייט-בייט ל-`.env.local`.

## 3. התכן המוצע

### 3.1 פרימיטיב חדש ב-`src/lib/security/token-compare.ts`

```ts
export function sharedSecretMatches(presented: unknown, expected: string | null | undefined): boolean
```

חייב להחזיר `false` בלי לזרוק ב: `presented` שאינו מחרוזת או ריק, ו-`expected` ריק/חסר. רק אחרי זה `safeTokenEqual(presented, sha256Hex(expected))`.
**למה השומרים חובה [נמדד, הורץ]:** `safeTokenEqual('', sha256Hex(''))` מחזיר `true` (כשל-פתוח), ו-`createHash().update(undefined)` זורק `ERR_INVALID_ARG_TYPE` (500 במקום 401). ל-`sharedSecretMatches` יהיה בשלב 1 קורא יחיד (העטיפה למטה) — זה מכוון: הוא הפרימיטיב הנבדק והבטוח, ושני הקוראים הפוטנציאליים האחרים (CardCom ו-RDP) הם הצעות נפרדות (§7).

### 3.2 עטיפת הקונסולה — קובץ חדש `src/lib/security/console-secret.ts`

```ts
export function consoleSecretStatus(presented: string): 503 | 401 | null
```

קורא `process.env.KALFA_CONSOLE_SECRET` **בכל קריאה**; חסר/ריק → `503`; אי-התאמה → `401`; אחרת `null`. החתימה `string` מונעת רק העברת ערך שאינו מחרוזת; היא **לא** מונעת להעביר `token` במקום `secret`, כי שניהם `string` אחרי Zod [נמדד: `validation/console-calls.ts`]. את זה תופס רק מבחן התנהגות (שלב 0, תרחיש 2): `secret` שגוי ו-`token` השווה לסוד האמיתי ← 401. ה-`unknown` נשאר בפרימיטיב הכללי. בראש הקובץ כותרת חוזה: קריאת env בכל בקשה, `!expected` falsy, והסדר שבו הנתיבים קוראים לו (אחרי Zod).

### 3.3 מה נשאר בכל נתיב

```ts
const denied = consoleSecretStatus(parsed.data.secret);
if (denied) return json(<BODY>, denied);
```

גופי הקבועים, `NO_STORE` והמיקום נשארים בנתיב — כך הסדר והחוזה נשמרים **מעצם הבנייה**.

### 3.4 מלכודות שנמדדו (אל תפיל אותן)

- ה-helper **לא** נכנס ל-`src/lib/data/console-calls.ts`: ארבעה טסטים של נתיבים (`authorize`, `call-me-now-authorize`, `event`, `route-inbound-retry`) עושים `vi.mock('@/lib/data/console-calls', factory)` [נמדד], ו-factory שמשמיט ייצוא זורק בגישה אליו [נמדד, הורץ ב-vitest 5.0.4: `[vitest] No "b" export is defined on the "./mod" mock`]. (תיקון: הנוסח הקודם של התוכנית ייחס זאת בטעות ל-`validation/console-calls.ts`.) הקובץ החדש תחת `security/` לא נמצא ברשימת המוקים.
- בלי `import 'server-only'` — ל-vitest אין alias לו, ו-`token-compare.ts` לא מייבא אותו היום.
- ה-helper לא מקבל `Request` ולא מחזיר `Response` (היה משנה את סדר 400/401).
- אין trim ואין אורך מינימום: env עם רווחים בלבד עובר היום את `!expected`; שינוי עלול להפיל קריאות נכנסות חיות. (`src/lib/relocation/env-validation.ts:89` דורש `min(16)` — נתון להחלטה נפרדת, §7.)
- לא לרשום ערך מוצג/צפוי בשום לוג.
- הקובץ החדש מחוץ ל-`route.ts` (ייצוא נוסף מ-route שבר `next build` פעמיים; מוגן ב-`src/lib/next-route-exports.test.ts`).

### 3.5 פרישת מה שהשינוי מחליף

לפי הכלל "שינוי חייב לפרוש את מה שהוא מחליף": בשלב 2 מוסרים מכל נתיב את הבלוק הישן, את הייבוא של `safeTokenEqual`/`sha256Hex` (אם לא בשימוש אחר), ואת ההערות הסותרות. ידוע: `widget/sdk-auth/route.ts:23–25` מצטטת את הדפוס הישן (`if (!expected) return json(REJECT, 503)`); ההערה על כשל-סגור ב-`authorize/route.ts:65` ("Fail-closed if the shared secret is unset…") עוברת לכותרת ה-helper. נקרא [נמדד]: ב-`call-me-now-authorize`, `widget-authorize` וב-`event` הבלוק עומד ללא הערה, ובקובץ `validation/console-calls.ts` אין אזכור של `sha256`/`safeTokenEqual` — אין שם מה לפרוש מלבד הבלוק עצמו.

## 4. שלבים (כל אחד נבדק ונסגר לפני הבא)

**שלב −1 — החלטת `widget-authorize`.** לפי הכותרת שלו הוא קוד מת (התרחיש `ConsoleWidgetIn` לא נכתב מעולם; אין קורא ב-`voxfiles/` או `rules.config.json`) [נמדד]. אם הבעלים מחליט למחוק אותו (שינוי נפרד) — נשארים חמישה נתיבים ושישית העבודה נחסכת. עד החלטה — נכלל בהיקף.
מחיקת ה-route לבדו **משאירה יתומים** [נמדד]: `widgetAuthorizeBodySchema` (`validation/console-calls.ts:128`, ‏`widget-authorize` הוא היחיד שמייבא אותו); `widget/call-intent/route.ts` שמנפיק טוקנים בקידומת `'wt'` (שורה 125) ומייבא את `consoleWidgetEnabled` ו-`evaluateWidgetCallCaps`; ‏`'wt'` ב-`DIAL_TOKEN_PREFIXES` (`data/console-calls.ts:1043`); ו-`'widget'` ב-`LIVE_CUSTOMER_CALL_KINDS` (שורה 136), שבו משתמשים גם נתיבי `console-calls/[id]/…` [לפי חיפוש; הנתיבים עצמם לא נקראו] (מחיקה משם דורשת בדיקה נפרדת). קליינט הדפדפן של ה-widget (`call-widget.tsx`) כבר לא קיים ב-`src` [נמדד: רשימת קבצים], ושני קומפוננטי האתר שנשארו (`call-me-now-widget*.tsx`) קוראים רק ל-`/api/call-me-now/*` [נמדד: נקראו במלואם]; לכן ל-`/api/widget/call-intent` ול-`/api/widget/sdk-auth` אין קורא בריפו, אך שניהם **נתיבים ציבוריים בלי אימות** שנחסמים רק על ידי הדגל `console_widget_enabled` והיעדר `WIDGET_VOX_PASSWORD`. אשכול ה-widget כולל גם: `widget/sdk-auth/route.ts`, ‏`data/widget-sdk-auth.ts`, קבועי ופונקציות ה-`WIDGET_*` ב-`data/console-calls.ts` (~2396–2504) ו-`consoleWidgetEnabled` (:294), והערות שמתארות את הזרימה: `validation/console-calls.ts` (84–86, 124–127, 143–144), ‏`sdk-auth/route.ts:19–21`, ‏`call-me-now-widget.tsx:12–17` (מצטטת את `call-widget.tsx` כ"נשאר כקוד מת" — כבר נמחק), ‏`call-me-now-widget-lazy.tsx:8`. בקשות בפועל: אפס ל-`/api/widget/*` ול-`widget-authorize` ביומני nginx, 22.6–15.10 [נמדד]. לכן שתי אפשרויות בלבד: למחוק את כל אשכול ה-widget כשינוי נפרד עם תוכנית משלו, או להשאיר את `widget-authorize` בהיקף האיחוד — ניקוי חלקי לא.

**שלב 0 — רשת ביטחון, לפני כל שינוי.** **דרישת ביצוע — עדיין לא נכתב:** טסט מונחה-טבלה לשישה הנתיבים שייכתב ויורץ **ירוק על הקוד הקיים**, ללא שינוי בקוד ייצור. מצב היום [נמדד]: אין טסט 503 באף נתיב, ואין קובץ טסט ל-`route-inbound` (השער החי שנכשל סגור) ול-`widget-authorize`; ארבעת קבצי הטסט הקיימים (35 טסטים) עוברים.

*דרישות מקדימות שנמדדו:*
- ‏`after()` זורק מחוץ להקשר בקשה (`next/dist/server/after/after.js:18`) והוא מושג ב-`route-inbound` (~306) וב-`event` (~194, מקרה `ended`). לכן מוק חלקי ל-`next/server` שפורס את המקור ומחליף רק את `after` — לא כמו המוק ב-`src/app/(admin)/admin/rdp-access/actions.test.ts:24` שמחליף את כל המודול ומאבד את `NextResponse`.
- ל-`route-inbound` ו-`widget-authorize` אין קובץ טסט; ל-`route-inbound` יש ייבוא של `console-queues`, `slack`, `balance-cache`, `phone` — כל אחד דורש factory (automock מריץ את הייבוא האמיתי).
- ‏`vi.mock` מורם (hoist) לכל קובץ, לכן טבלה משותפת לא מייתרת factory. **החלטה:** קבצי טסט צמודים לכל נתיב, ו-fixtures משותף (גופי בקשה, ציפיות גוף/סטטוס) שהם מייבאים.
- למחיקת env: `vi.stubEnv(name, undefined)` (מותר בטיפוסי vitest 5.0.4 המותקן), ותמיד עם `afterEach(() => vi.unstubAllEnvs())` — הכלל המתועד ב-`vitest.config.mts:56–57`, ובתצורה אין `unstubEnvs` אוטומטי [נמדד].
- ארבעת קבצי הטסט הקיימים (`authorize`, `call-me-now-authorize`, `event`, `route-inbound-retry`) מציבים היום `process.env.KALFA_CONSOLE_SECRET = SECRET` ישירות ב-`beforeEach` (שורות 35, 65, 34, 45) וללא `unstubAllEnvs` [נמדד]. בשלב 0 עוברים בהם ל-`vi.stubEnv('KALFA_CONSOLE_SECRET', SECRET)` + `afterEach(() => vi.unstubAllEnvs())`, כדי שמחיקה/שינוי בתרחישי 503 לא ידלפו בין טסטים.

*התרחישים (לכל נתיב):*
1. env מחוק ← 503; env `''` ← 503. בשניהם: גוף מדויק, DAL לא נקרא.
2. סוד שגוי (גוף תקין) ← 401; ה-DAL ו-`verifyDialToken` לא נקראו. גם כש-`token` (או כל שדה אחר בגוף) שווה לסוד האמיתי ו-`secret` שגוי ← 401.
3. גוף פגום + סוד שגוי ← 400. env חסר + גוף פגום ← 400.
4. סוד נכון ← הקריאה **הראשונה ל-DAL אחרי השער** נקראה (לא מספיק לבדוק סטטוס — סירובים שלאחר השער גם הם 200).
5. השוואת גוף **כטקסט** מול המחרוזת המילולית (`await res.text()`), לא JSON מפוענח, וגם `content-type` ו-`Cache-Control: no-store` — ב-401 וב-503.
6. גוף גדול + סוד שגוי ← 413; גוף גדול + env חסר ← 413 (דרך `content-length` המוצהר וגם דרך ספירת הבייטים בפועל).
7. סוד באורך 256 עובר; 257 ← 400; מפתח נוסף (`strictObject`) + סוד שגוי ← 400.
8. הנעת ה-rate-limit בבקשות עם סוד שגוי: בקשה 121 (301 ב-`event`) ← 429 — וזה גם מקבע שה-rate-limit רץ **לפני** בדיקת הסוד. `route-inbound-retry` ← 200 `{ring_order:[]}`; `event` ← 429 `{ok:true}`; השאר ← 429 עם גופם. איפוס עם `__resetRateLimitStateForTests` בין טסטים.
9. אין ערך סוד בפלט `console`.

*fixture של `event` — חובה `call_kind: 'outbound'` (או `'inbound'`), לא `'internal'`* [נמדד, `event/route.ts:87–90`]: ענף `internal` מחזיר 202 מיד אחרי השער, בלי לקרוא לאף פונקציית DAL (`findConsoleCallForEvent` נקראת רק משורה 94). עם fixture `internal` תרחיש 4 נכשל (אין "קריאה ראשונה ל-DAL"), ותרחיש 2 ("ה-DAL לא נקרא") עובר **גם כשהשער שבור** — ובדיקת המוטציה בשלב 2 לא תתפוס את `event`. בקרת ה-`internal` ב-§5.2 היא לאימות חי בלבד (אין בה תופעות לוואי), לא fixture של הטבלה.

**שלב 1 — הפרימיטיבים + טסטי יחידה.** ‏`sharedSecretMatches` ו-`consoleSecretStatus`. טסטים: `('', '')`, `('x', '')`, `('', 'x')`, `undefined`, `null`, מספר, אובייקט ← `false`; התאמה נכונה ← `true`; חסר/ריק ← 503. **קריאה בכל בקשה, באותו מודול וללא import מחדש:** env=A ← A מתקבל; החלפה ל-B ← A נדחה (401) ו-B מתקבל; מחיקה ← 503 (מונע שמירה במטמון גם אחרי הקריאה הראשונה, לא רק לפניה). **ללא trim — מקבע את ההתנהגות הנוכחית, כדי ש"שיפור" ייכשל:** env `'   '` (רווחים בלבד) ← לא 503, מתקבל רק `secret` זהה ברווחים; env `' abc '` מול `'abc'` ← 401, ומולו עצמו ← `null`. ללא נגיעה בנתיבים.

> **Commit 1 = שלבים 0–1** (רשת הביטחון והפרימיטיבים). **Commit 2 = שלבים 2–3.** אם הכול ב-commit אחד, `git revert` מוחק גם את רשת הביטחון. שום commit לא נעשה אלא כשהבעלים מבקש.

**שלב 2 — העברת הנתיבים** (שורה אחת בכל נתיב) ופרישת הישן (§3.5). שלב 0 חייב להישאר ירוק **בלי שינוי בציפיות**. אחריו **בדיקת מוטציה חד-פעמית**: ה-helper מוחזר זמנית כ-`null` ← הטבלה חייבת להיכשל בכל שישה הנתיבים (ב-`event` — רק בזכות ה-fixture `outbound`/`inbound` משלב 0); ורק אז מחזירים. (טסט שירוק על הקוד הקיים עוד לא הוכיח שהוא יכול להיכשל.)

**שלב 3 — מגן נגד התפרקות.** טסט כיסוי בסגנון `src/lib/auth/admin-data-layer-coverage.test.ts`, אך חזק ממנו:
- גילוי **רקורסיבי** של כל `route.ts` תחת `src/app/api/voximplant/console/` (הליכה כמו `walkModules` ב-`admin-data-layer-coverage.test.ts`), לא `console/*/route.ts`: ה-`*` מתאים לרמה אחת בלבד, ולכן נתיב שיתווסף בעתיד ברמה אחרת לא היה נתפס והמספר 6 היה נשאר ירוק. הדגמה על מחרוזות היפותטיות (**אין נתיבים כאלה בריפו** — היום יש בדיוק שישה, כולם ברמה אחת): `console/route.ts` ו-`console/<x>/<y>/route.ts` לא מתאימים ל-`console/*/route.ts`, ו-`console/authorize/route.ts` מתאים [נמדד בהדגמה]. המספר מקובע (6) והתוצאה חייבת להיות שווה לרשימת הנתיבים בטבלה ההתנהגותית — נתיב נוסף נכשל עד שנוסף לשם. בנוסף, קבוצת ה-handlers המיוצאים בכל קובץ (`GET`/`POST`/…) חייבת להיות `{POST}`, כך שהוספת מתודה לקובץ קיים נכשלת עד שיש לה תרחיש. (מונע סריקה ריקה שקטה — כשל שמתועד בראש הקובץ שהוא מחקה.)
- הסרת הערות לפני ההתאמה. `stripComments` מקומי היום ל-`src/lib/auth/admin-data-layer-coverage.test.ts` (שורות 701–733, לקסר שמדלג על תוכן מחרוזות) — נחלץ ל-helper משותף של טסטים ולא מועתק; מיקום הקובץ החדש נקבע בשלב 3 והקובץ הקיים מייבא ממנו. קיים מופע שני, **שונה**: `src/app/(admin)/admin/workflows/[id]/integration-connection-control.test.ts:48` — regex בלבד, שהערתו מנמקת שהנושא שלו אינו מכיל `//` או `/*` במחרוזות [נמדד]. ההחלטה: לא לאחד אותו בשלב הזה (נושא אחר, ההנמקה מתועדת), אלא אם הבעלים מבקש.
- איסור על הטוקן `KALFA_CONSOLE_SECRET` בכל צורה (גישה בסוגריים, destructuring) ועל ייבוא `safeTokenEqual`/`sha256Hex`/`sharedSecretMatches` בנתיבי הקונסולה (הנתיבים צריכים לעבור רק דרך `consoleSecretStatus`). ‏`sha256Hex` משמש היום בכל שישה אך ורק להשוואת הסוד [נמדד], ולכן האיסור לא חוסם שימוש קיים; שימוש לגיטימי עתידי יירשם במפת החריגים. בדיקת "קורא ל-`consoleSecretStatus`" בלבד לא תופסת נתיב שמתעלם מהערך המוחזר — זה תפקיד הטבלה ההתנהגותית.
- מפת חריגים עם נימוק לכל חריג.

**שער סיום לכל שלב:** `npm run lint`, `npm run typecheck`, הטסטים הממוקדים, ובסוף כל הסוויטה. ‏`npm run build` נכלל באימות של כל שלב: סעיף 5 ב-Definition of Done דורש ש-`lint`, ‏`typecheck` ו-`build` יעברו לפני שהמשימה נחשבת גמורה, ו-`npm run build` בונה ל-`.next-verify` בלבד ואינו נוגע ב-`.next` החי (`package.json` — `build`) [נמדד]. **פריסה** (`npm run deploy`) נשארת שלב נפרד באישור הבעלים.

## 5. פריסה, אימות חי, ו-rollback

- שינוי בצד השרת בלבד; אין מיגרציה, אין שינוי תרחיש; **סדר פריסה לא משנה**. ‏`kalfa-beta` רץ כ-fork יחיד לפי `ecosystem.config.cjs` (אין מפתח `instances`) — ה-rate-limit בזיכרון הוא לכן לתהליך אחד [נמדד: מתצורה ומ-`pm2 jlist` החי ב-15.10 — `fork_mode`, תהליך יחיד, online].
- **אימות אחרי פריסה (אצל הבעלים):**
  1. *בקרה שלילית — דרך נתיב בלי תופעות לוואי:* בקשה אל `event` עם סוד שגוי, `call_kind:'internal'` וגוף שעובר את הסכמה ← 401 (אם השער שבור: 202 ו-`console.log` בלבד). **לא** דרך `route-inbound`: בשער שבור הבקשה ממשיכה לבדיקות הקיבולת, ואם הדגל `inbound_calls_enabled` דלוק ויש נציג זמין היא יוצרת שורת `console_calls` ושולחת push (`route-inbound/route.ts:275–316`) [נמדד בקריאה; הדגל החי **דלוק** — נמדד ב-DB ב-15.10 (`inbound_calls_enabled=true`), כך שהתנאי הראשון מתקיים היום; האם יש נציג זמין באותה שעה לא ידוע]. כיסוי `route-inbound` הוא אך ורק בטסט הבידוד של שלב 0, עם תלויות מדומות. הבקרה החיה מזהה רגרסיה ב-helper המשותף (שישה נתיבים בבת אחת), לא נתיב בודד שנשמט — זה תפקידם של שלבים 0 ו-3. גוף שאינו עובר Zod יחזיר 400 וייראה כפריסה שבורה. **בלי זיוף `X-Forwarded-For`.**
  2. *בקרה חיובית מצד הפלטפורמה* (הדרך היחידה להוכיח שהסוד של הפלטפורמה עדיין מתקבל; הורצה פעם אחת ב-15.10, ראו סעיף 8): `StartScenarios` על כלל `ConsoleCallMeNow` (1523124) עם יעד לא תקין, למשל `"0000"`, וטוקן סינתטי — שני `POST /event` ← 202 ביומן nginx ו-`event started -> 202` ביומן הסשן; בלי שיחה, בלי חיוב, בלי כתיבה ל-DB, כל עוד אין שיחה חיה באותם 30 שניות (הרמה השלישית של `findConsoleCallForEvent` משייכת לפי FIFO). דורשת הרשאה מפורשת להפעלת `start_call`.
  3. *בקרה חיובית מצד השרת* (בלעדיה אי אפשר לזהות את הרגרסיה האמיתית — דחיית סוד תקין): ‏`event` עם `call_kind:'internal'` והסוד האמיתי ← 202, ורק `console.log` נכתב [נמדד, `event/route.ts` ~87–90]. הסוד נקרא מקובץ/env, **לא** בשורת הפקודה. ‏**לעולם לא** לבצע smoke ל-`route-inbound` עם הסוד האמיתי — הוא יוצר שורת `console_calls` ומתזמן push לנציגים.
  4. *יומני התרחישים (Voximplant):* ‏`authorize refused: code=` ב-`ConsoleDial` (1584) וב-`ConsoleCallMeNow` (559), ו-`gate_refused_code_` ב-`ConsoleInbound` (1828) [נמדד: השורות האלה קיימות בעותק הריפו; התרחיש המפורס לא נבדק]. הנתיבים עצמם **לא כותבים לוג** ב-401/503 [נמדד: ששת הנתיבים נקראו במלואם], ולכן יומני pm2 לא יראו אותם — להשתמש ביומן הגישה של nginx לפי נתיב וסטטוס (`/var/www/vhosts/system/beta.kalfa.me/logs/proxy_access_ssl_log` ליום הנוכחי ו-`access_ssl_log.processed` להיסטוריה; נקראים רק עם `sudo`; פורמט combined — נתיב, סטטוס ו-User-Agent, בלי זמן תגובה) [נמדד].
- **תנאי rollback (טריגר):** כל 401/503 על נתיבי `console/` מכתובות Voximplant אחרי הפריסה, או ירידה בקריאות נכנסות שמתקבלות — **וגם כל כישלון של הבקרה השלילית (סוד שגוי שמתקבל) או של הבקרה החיובית (סוד תקין שנדחה)**. קבלה שגויה היא הכשל המסוכן יותר (כשל-פתוח, ראו "רדיוס פגיעה"), ולכן אינה מחכה לירידה בשיחות. **לפני הפריסה:** לרשום את ה-SHA של ה-commit הטוב האחרון. **פעולת rollback:** `git revert` של Commit 2 (Commit 1 נשאר ברשת הביטחון) ו-`npm run deploy` מחדש. זו **אינה חזרה מיידית** [נמדד: `package.json` — `deploy`]: הסקריפט בונה ל-`.next-stage`, מחליף ל-`.next`, מפעיל מחדש את `kalfa-beta` ומוחק את `.next.old` מיד אחרי ההפעלה — אין build קודם לחזור אליו, ו-`deploy` כולל גם בניית worker וסוכנים ו-`seo:audit`. אם ה-build נכשל לפני ההחלפה, `.next` החי לא משתנה (שרשרת `&&`): כשל בנייה אינו מפיל את האתר, אבל גם אינו מחזיר גרסה שנפרסה והתבררה כשבורה. אין מצב נתונים לשחזר.
- **רדיוס פגיעה:** באג ב-helper פוגע בשישה נתיבים בבת אחת. כשל-סגור דוחה כל שיחה נכנסת (603); כשל-פתוח פותח את שער השיחה המחויבת (היסטוריית הצפה 17.8). לכן שלבים 0–1 קודמים לכל נגיעה בנתיב.
- **פורמט העבודה בפרויקט:** ‏`.claude/aicode-instructions.md` קובע OpenSpec (`openspec/changes/<name>/`). עם אישור — להמיר תוכנית זו ל-change דרך `openspec new change` (לא ידנית).

## 6. מחוץ להיקף (במכוון)

- ‏`src/lib/relocation/setup-form.ts` (`tokenMatches`) — שקול ל-`safeTokenEqual`, אפס רווח אבטחתי, שרת bootstrap עצמאי. להשאיר.
- שני מפרקי ה-Bearer (`extractBearer` מקל ב-`src/lib/auth/console-agent.ts:31`, ו-`bearerOf` קפדני ב-`src/lib/rdp-access/internal-route.ts:26` [נמדד]) — **לא למזג**: מיזוג דורש דגל, ושימוש במקל ל-`bearerOf` מרפה את נתיב ה-PAM/gateway.
- נתיבי RDP בודקים את הסוד **לפני** ה-rate-limit (הפוך מהקונסולה) — לא להשוות.
- ‏`/api/widget/sdk-auth` — לא משתמש ב-`KALFA_CONSOLE_SECRET` בקוד, רק בהערות [נמדד].
- סכמות Zod, מפתחות ומספרי rate-limit, ‏`verifyDialToken`, ‏`account-callback`, השוואת ה-SDK של ElevenLabs (החלטת בעלים 11.10), ‏MAC של xrdp.
- ‏51 קבצי `route.ts` (מתוך 76 תחת `src/app/api`) מגדירים helper מקומי `json`/`bad`/`respond`/`reply` [נמדד בספירה חוזרת של הגדרות `function`/`const` ברמה העליונה; המספר 53 מהסריקה הקודמת לא שוחזר] — תוכנם לא הושווה; פרויקט נפרד.
- מפתח ה-rate-limit על בסיס `x-forwarded-for` (נשלט בידי הלקוח) — נושא נפרד ורחב (כל המגבילים הציבוריים).
- אין לשנות את אופן הסיבוב של הסוד (לא אטומי; סשנים פתוחים מחזיקים את הישן). קבלת סוד ישן וחדש ביחד משנה את קבוצת המתקבלים — לא "בלתי נראה".

## 7. החלטות שדורשות בעלים

1. **אישור לשלבים −1…3** (הליבה).
2. **`widget-authorize`** — למחוק (שינוי נפרד) או להשאיר; ההחלטה קודמת לשלב 0.
3. **תוכניות נפרדות, לא חלק מהאיחוד** (שינוי התנהגות, ולכן עם תוכנית ואישור משלהן):
   - **א. חיזוק `webhooks/microsoft-graph`:** ‏`typeof n.clientState === 'string'` + השוואה בזמן קבוע (hash של הצפוי פעם אחת מחוץ ללולאה — לכן `safeTokenEqual(n.clientState, expectedHash)` עם שומר `typeof === 'string'` וריק, ולא `sharedSecretMatches` שמחשבת `sha256Hex(expected)` בכל קריאה; היום `route.ts:69` הוא `n.clientState !== expected` בתוך הלולאה [נמדד]) + שומר `Array.isArray(body.value)` (היום גוף null או `value` שאינו מערך זורק 500 ו-Graph מנסה שוב עד 4 שעות [מתיעוד חי: learn.microsoft.com, "Receive change notifications through webhooks"]) + תקרת גוף (היום nginx מאפשר 25MB [נמדד: `/etc/nginx/conf.d/beta-proxy.conf:21` ברמת ה-server, ואין `location` שדורס] ו-`request.json()` רץ ללא אימות; גודל אמיתי לא נמדד — התיעוד של Graph לא מציין מגבלת מספר הודעות במשלוח, וה-route לא שומר את גוף המשלוח) + קובץ טסט חדש (אין היום). **לא** להוסיף rate-limit כאמצעי אבטחה: המפתח נשלט בידי הלקוח, ו-429 על בקשה לגיטימית של Graph גורר ניסיונות חוזרים.
   - **ב. `secretMatches` של CardCom** ← `sharedSecretMatches`: סיכון נמוך, רווח נמוך (בדיקת האורך מדליפה רק אורך של סוד קבוע). חובה לשמור את שומרי הריק/`typeof` ולהוסיף טסט ל-`secret=` ריק. סוד שמור חסר מחזיר היום 401 ולא 503 (`cardcom/document-webhook/route.ts:47`, מתועד בכותרת ה-route שורה 23, ‏`secretMatches` ב-`cardcom-document-intake.ts`) [נמדד] — נשמר כמות שהוא, ולכן לא עוברים ל-`consoleSecretStatus`.
   - **ג. נתיבי RDP** (`tunnel-check`, `xrdp-ticket`) ← `sharedSecretMatches`, בלי לשנות את סדרם. שתי פונקציות ה-config (`getRdpGatewayConfig`, ‏`getXrdpTicketConfig`) כבר עושות `trim()` ואוכפות `MIN_SECRET_LENGTH = 32` לפני `ok: true` (`rdp-access/config.ts` ~85–120, 183–189) [נמדד]. שני הנתיבים משווים היום `safeTokenEqual(presented, sha256Hex(config.checkSecret))` (`tunnel-check/route.ts:45`, ‏`xrdp-ticket/route.ts:42`), כש-`presented` מגיע מ-`bearerOf` (מחזיר `null` לטוקן ריק — `internal-route.ts:26–32`) והסוד מה-config (לא ריק, ≥32) — שומרי `sharedSecretMatches` כבר מתקיימים, והמעבר זהה בהתנהגות [נמדד: נקראו במלואם]. הסדר נשמר: config (503) ← Bearer (401) ← rate-limit.
4. **סוד מרחבי-רווח** — האם ה-env בפרודקשן יכול להיות רווחים בלבד? לא נבדק; ‏`src/lib/relocation/env-validation.ts:89` דורש `min(16)` אך רק בעת העברה. שינוי ל-trim הוא החלטה נפרדת.

## 8. מה לא אומת

*מעודכן 15.10, ~20:40, אחרי בדיקה של כל פריט שהיה רשום כאן.*

**אומת [נמדד] — היה ברשימת "לא אומת":**
- **התרחישים המפורסים מול עותק הריפו.** `GetScenarios` (קריאה בלבד): ה-sha256 של שלושת התרחישים המפורסים שווה ל-`hash` ב-`voxfiles/.voxengine-ci/…/scenarios/dist/*.metadata.config.json` — כלומר זה בדיוק מה ש-voxengine-ci העלה, ב-14.9.2026 ~15:22. מול `scenarios/src` ההבדלים הם הערות ועיצוב בלבד (`ConsoleCallMeNow` 4 שורות, `ConsoleInbound` 22, `ConsoleDial` 14: טקסט של הערת כותרת ושורת קריאה אחת שפוצלה); אין הבדל בהתנהגות מול ה-gates.
- **pm2 החי:** `kalfa-beta` ב-`fork_mode`, תהליך יחיד, online, הותחל 15.10 14:17Z.
- **דגלים חיים (DB, 15.10):** `inbound_calls_enabled=true`, `console_call_me_now_enabled=true`, `console_wake_enabled=true`, `console_manual_dial_enabled=true`, `console_widget_enabled=false`. ב-`console_calls` אין אף שורה מסוג `widget` אי פעם — נתיב ה-widget מעולם לא קיבל שיחה.
- **`Net.httpRequestAsync` — מה שהתיעוד אומר [נמדד: שני העמודים נקראו במלואם]:** ה-Promise "נפתר עם `HttpRequestResult`", ו-`code` יכול להיות קוד HTTP או קוד פנימי שלילי: `0` חריגת מגבלות, `-2` כתובת פגומה, `-3` מארח לא נמצא, `-4` שגיאת חיבור, `-6` שגיאת רשת, `-7` timeout, `-9` תשובה מעל 2MB. התיעוד אינו אומר במפורש שה-Promise לא נדחה לעולם (ראו "עדיין לא אומת").
- **Graph:** תשובת 2xx תוך 3 שניות, אחרת ניסיונות חוזרים עד 4 שעות (תיעוד חי של Microsoft).
- **nginx:** `client_max_body_size 25M` ברמת ה-server; בקובץ שלושה `location` בלבד (acme, rdp-gateway→404, `/`) ואף אחד לא דורס את הגבול לנתיב ה-webhook.
- **"53 helpers":** בספירה חוזרת — 51 מתוך 76 קבצי `route.ts` (ראו סעיף 6).
- **שער `route-inbound` בפועל:** ביומני 3 סשנים של 4.10 עברו 1.3–1.8 שניות מ-`CallAlerting` עד התשובה (timeout של 10 שניות); בשישה מתוך שישה סשנים שנבדקו התשובה הייתה HTTP 200 (סירוב קיבולת/הונאה, לא סוד).
- **קוראים בפועל לנתיבי `console/`** (יומני nginx, נקראו עם `sudo` לקריאה בלבד; `access_ssl_log.processed`, 22.6–15.10, 865,804 שורות): 8,244 בקשות — 8,235 מ-`VoxEngine/1.0` מ-7 כתובות של Voximplant, ו-9 מ-`curl/8.5.0` מכתובת השרת עצמו (12–13.8). אין ניטור או probe חיצוני. הראשונה ב-12.8 20:20, האחרונה ב-4.10 12:52 (+0300).
- **סטטוסים בנתיבי `console/`:** `event` 4,787×202; `route-inbound` 2,703×200; `route-inbound-retry` 738×200; `authorize` 7×200; `call-me-now-authorize` 1×200. החריגים (400/401/502) כולם ב-12–13.8; מאז 13.8 07:30 נרשמו רק שני 499 (14.9 ו-1.10, ניתוק צד הלקוח) ואפס 401/403/503.
- **שוויון הסוד החי בין הפלטפורמה לשרת הרץ — נבדק בפועל, 15.10 20:53 (+0300), באישור הבעלים.** `GetSecrets` לא חושף ערך, ולכן הבדיקה נעשתה דרך הפלטפורמה עצמה: `StartScenarios` על כלל `ConsoleCallMeNow` (1523124) עם `script_custom_data` שיעדו `"0000"` (מספר לא תקין) וטוקן סינתטי. התרחיש שולח `started` לפני החיוג ו-`ended` אחרי כישלונו, שניהם עם הסוד מהפלטפורמה. תוצאה: יומן nginx — שני `POST /api/voximplant/console/event` מ-`VoxEngine/1.0` ב-20:53:02, שניהם **202**; יומן הסשן — `event started -> 202`, `event ended -> 202`, והחיוג נכשל ב-`404 Invalid number` (לא נוצרה שיחה; בהיסטוריית השיחות של Voximplant `call_duration=0`, `call_cost=0` וללא שורות resource [נמדד]). 401 היה מעיד על אי-התאמה ו-503 על `KALFA_CONSOLE_SECRET` חסר בשרת. הסוד בפלטפורמה נוצר ולא שונה מאז 12.8.2026 16:51 [נמדד].
- **widget:** אפס בקשות ל-`/api/widget/*` ול-`widget-authorize` באותו חלון.
- **Graph webhook:** 37 בקשות POST (31 בתשובת 200, 6 בתשובת 202) ובקשת GET אחת (405).

**עדיין לא אומת:**
- **האם `Net.httpRequestAsync` נדחה אי פעם בפועל** (למשל על שגיאת רשת): התיעוד שותק בעניין, וכשל לא נוסה. ההשפעה על התוכנית נמוכה — האיחוד אינו נוגע בצד התרחיש — אבל סעיף 2 מנוסח בהתאם, כמוסק ולא כמנוסה.
- **אורך הסוד החי.** לא נמדד: `GetSecrets` מחזיר רק שם ותאריכים, ו-`.env.local` לא נקרא. השוויון הוכח (למעלה), ולכן האורך זהה בשני הצדדים; האיחוד אינו תלוי בו.
- **השהיות אמיתיות** של `authorize`, `event`, `call-me-now-authorize` ו-`route-inbound-retry`, ושל נתיב הקבלה של `route-inbound`; נמדד רק נתיב סירוב ב-3 סשנים. יומן nginx בפורמט combined, בלי `$request_time`, ולכן אי אפשר להפיק ממנו השהיות [נמדד].
- **גודל batch אמיתי של Graph:** התיעוד לא מציין מגבלה, וה-route לא שומר את גוף המשלוח, ולכן אין נתון ב-DB, ויומן nginx אינו רושם גוף.
- **נתיבי `console-calls/[id]/…`** שמשתמשים ב-`LIVE_CUSTOMER_CALL_KINDS` — לא נקראו.
- **בקשות ישירות לשרת החי:** אף אחד לא שלח; הבקשות היחידות שהגיעו אליו הן שתי ה-`/event` של בדיקת הפלטפורמה (15.10 20:53, למעלה). הטסטים היחידים שהורצו הם ארבעת הקבצים הקיימים (35 עוברים, 15.10) והניסוי החד-פעמי על מוק ללא ייצוא.
