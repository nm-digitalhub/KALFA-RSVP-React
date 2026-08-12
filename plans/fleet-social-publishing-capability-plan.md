# KALFA Fleet — יכולת פרסום סושיאל אמיתי (Social Publishing Capability)

> מסמך זה נכתב לאחר קריאה מלאה של `docs/fleet/00-index.md` עד `04-operational-status.md`,
> `.claude/fleet/roles/social-manager.md`, `.claude/fleet/roles/brand-director.md`, קטעים
> רלוונטיים מ-`scripts/fleet-agent-cli.ts` (התנהגות בפועל, לא רק תיעוד), `.claude/fleet/fleet.json`,
> `supabase/migrations/20260723094500_fleet_requests.sql`, ו-`docs/marketing/BRAND.md`
> (repo: `/var/www/vhosts/kalfa.me/beta`), נכון ל-2026-08-09.
> כל מזהה טכני (נתיבים, טבלאות, פקודות CLI, קוד) נשמר באנגלית.
>
> **זהו מסמך תכנון בלבד.** לא בוצע אף שינוי קוד, לא נערך שום קובץ תחת `.claude/fleet/**`,
> לא נוצרו ולא נטענו קרדנציאלים אמיתיים, ולא בוצעה שום פעולת רשת כלפי Meta. כל בלוק
> "copy-ready" במסמך הוא תוכן מוצע להעתקה-והחלה ידנית על-ידי הבעלים בשלב מאושר, לא שינוי
> שכבר קרה.

## 0. מתודולוגיית אימות ל-API החיצוני (Meta Graph API)

לפי מדיניות הפרויקט, לפני כתיבת §4 (הספק הטכני של `publish-social`) בוצע מחקר חי — לא
הסתמכות על ידע מאומן — משום ש-API-ים חיצוניים כמו Meta Graph API משתנים לעיתים קרובות.
המקורות והממצאים:

| נושא | מקור | ממצא |
|---|---|---|
| יצירת מדיה ל-Instagram | ctx7 `/websites/developers_facebook_graph-api` (Meta רשמי) | `POST /{ig-user-id}/media` יוצר container; מקבל `image_url`/`caption` |
| פרסום container ל-Instagram | WebSearch → `developers.facebook.com/docs/instagram-platform/content-publishing/` (Meta רשמי) | תהליך **תלת-שלבי**, לא דו-שלבי כפי שהונח בתחילה: (1) יצירת container, (2) `GET /{container-id}?fields=status_code` עד `FINISHED`, (3) `POST /{ig-user-id}/media_publish` עם `creation_id` |
| הרשאת פרסום Instagram | WebFetch → `developers.facebook.com/docs/instagram-platform/content-publishing/` (Meta רשמי, אומת חי 2026-08-09, שלוש קריאות עצמאיות) + WebSearch (מקורות מרובים) | **שני משטחים נפרדים, כל אחד עם טבלת-הרשאות משלו.** ב-**"Instagram API with Instagram Login"** (משטח שתוכנית זו **אינה** משתמשת בו) הוחלפו השמות הישנים ב-27.1.2025: `instagram_content_publish`→`instagram_business_content_publish`. אך ב-**"Instagram API with Facebook Login"** — **המשטח שבו תוכנית זו משתמשת בפועל** (טוקן-Page, IG מקושר לדף, ראו §4.2) — טבלת הדרישות הרשמית הנוכחית עדיין מפרטת `instagram_basic`+`instagram_content_publish`+`pages_read_engagement` ללא שינוי-שם; ה-27.1.2025 לא נגע במשטח הזה. בלבול בין שני המשטחים היה גורם להגשת App Review על הרשאה שגויה (§7 שלב 0) |
| App Review | WebSearch | כל הרשאה דורשת הגשת-ביקורת נפרדת + screencast; **2–4 שבועות** זמן ביקורת משוער |
| דרישת חשבון | WebSearch | חשבון האינסטגרם חייב להיות Professional (Business/Creator) ומקושר לדף פייסבוק — לא חשבון אישי |
| פרסום לדף פייסבוק | ctx7 `/websites/developers_facebook_graph-api` (Meta רשמי) | `POST /{page-id}/feed` עם `message`/`link`; הרשאות `pages_manage_posts` + `pages_read_engagement` + `pages_show_list` |
| מחיקת פוסט מדף פייסבוק | WebSearch | `DELETE /{post-id}` — מתועד ונתמך היטב |
| יצירת container-תמונה ל-Instagram (`POST /{ig-user-id}/media`) | WebFetch → `developers.facebook.com/docs/instagram-platform/content-publishing/` (Meta רשמי, אומת חי 2026-08-09) + ctx7 `/websites/developers_facebook_graph-api` | **`image_url` הוא הפרמטר היחיד הקיים** — "We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server." (נוסח מדויק-מהתיעוד, אומת חי; ניסוח קודם במסמך זה היה לא-מדויק). אין multipart/`source`/file-attachment ל-endpoint הזה בכלל (ctx7 מחזיר רק `image_url` בפרמטרי ה-`/media` edge). לשני ה-endpoints (`/media` וגם `/media_publish`) בזרימת Facebook Login — **טוקן: Facebook Page access token**, בדיוק כפי ש-§4.2 מספק (אומת חי בנפרד, לא הונח). **סוגר לחלוטין את השאלה שהייתה פתוחה** — bucket ציבורי (§4.6) הוא הכרחי ל-Instagram, לא המלצה-בלבד |
| העלאת תמונה לדף פייסבוק (`POST /{page-id}/photos`) | WebFetch → `developers.facebook.com/docs/graph-api/reference/page/photos/` (Meta רשמי, אומת חי 2026-08-09, v26.0) + ctx7 `/websites/developers_facebook_graph-api` | **שתי שיטות נתמכות במפורש**: `url` (תמונה מתארחת) **או** קובץ מצורף כ-`multipart/form-data` ("You must specify this or a file attachment"); `source` הוא שם-השדה המוסכם-היסטורית לצירוף הבינארי (הטבלה הפורמלית מתעדת רשמית רק `url`, אך תמיכת ה-file-attachment מאושרת בתיעוד). **מסקנה**: פייסבוק לא זקוק ל-bucket ציבורי כלל — העלאה מולטיפארט ישירה מ-bytes ש-`publish-social` כבר קורא מ-`.fleet-logs/` עוקפת את בעיית ה-image hosting לגמרי; שם-השדה המדויק עדיין ראוי לאימות-נקודתי בזמן המימוש, לא קיום-השיטה |
| מחיקת מדיה מ-Instagram | WebFetch → `developers.facebook.com/docs/instagram-platform/reference/instagram-media/` (Meta רשמי, אומת חי 2026-08-09) | `DELETE /{ig-media-id}` **מתועד ותקף במפורש רק על "Instagram API with Facebook Login"** — בדיוק המשטח שבו תוכנית זו משתמשת (הפעולה **אינה קיימת כלל** ב-"Instagram API with Instagram Login" — מאמת בדיעבד את בחירת-המשטח, ראו §6). תומך בפוסטים לא-ממומנים/Stories/Reels/carousel שלם (לא פריט בודד בתוכו). דורש הרשאה **נפרדת** `instagram_manage_contents` — `instagram_basic` עצמו **כן** ברשימת ההרשאות המתוכננת כאן (§7 שלב 0, אחרי תיקון §0 למעלה), אך `instagram_manage_contents` אינו — ו-**Facebook User access token** — לא Page token כפי ש-§4.2 מספק ל-publish (אומת בנפרד לעיל: publish עצמו כן Page-token). שני דיוני-קהילה בפורום המפתחים הרשמי (~2023) מדווחים כישלון/חוסר-ודאות על אותו מסלול, ואין אישור-הצלחה אמפירי עדכני (2025–2026) במחקר הזה מעבר לתיעוד עצמו — יתכן ששיקוף מצב-API/הרשאות ישן יותר מלפני עדכוני 2025, אך לא מאומת. **מסקנה: קיים בתיעוד, לא-מתוקצב בהרשאות, לא-מאומת אמפירית — נשאר non-goal ל-v1 (§6), כעת מנומק במלואו** |
| בחירת ספריית-לקוח Node.js | ctx7 `/facebook/facebook-nodejs-business-sdk` (ה-SDK הרשמי) + השוואה ל-`src/lib/sumit/charge.ts`, `src/lib/whatsapp/client.ts` | ראו §4.0 — **הוחלט לא לאמץ את ה-SDK הרשמי** |

כל שורה שאין לה מקור מפורש בטבלה זו, ובכל זאת מופיעה בספק הטכני (§4), מסומנת שם
במפורש כ**"לאמת בזמן מימוש"** ולא כעובדה מאושרת. **עדכון (סבב-מחקר שני, 2026-08-09,
לסגירת פערים שזוהו בסקירת-בעלים)**: שתי הנקודות שדווחו קודם כ"לא-מאומתות במלואן"
נסגרו במחקר-חי נוסף — אף אחת לא נותרה שאלת-עקרון פתוחה: (א) שיטת-ההעלאה
ל-`POST /{page-id}/photos` **מאומתת** — `url` **וגם** קובץ-מצורף מולטיפארט
תומכים במפורש (שורה למעלה); נותר רק אימות שם-השדה המדויק בזמן המימוש, לא
קיום-השיטה. (ב) מחיקת-מדיה ל-Instagram **מתועדת** במפורש עבור המשטח שבו תוכנית
זו משתמשת — אך שלוש חסימות מעשיות (הרשאה לא-מתוכננת, סוג-טוקן אחר מהמסופק,
היעדר-אימות-אמפירי עדכני) עדיין מצדיקות non-goal ל-v1 (§6). מה שנותר פתוח הוא
ברמת-פרט-מימוש בלבד (שם-שדה מדויק ב-photos; בדיקה אמפירית-אחת-מול-חשבון-חי
למחיקה) — לא ברמת שאלת-עקרון.

---

## 1. מטרה והיקף

היום ל-`social-manager` (Tier 0, זמנון שבועי ראשון 11:30) יש רק **טיוטה**: הוא כותב
כיתוב עברי + תיאור-ויזואל-כטקסט (אין גישת Canva headless) לתוך
`.fleet-logs/drafts/social/<YYYYMMDD>-batch/`, `brand-director` (Tier 0, יומי 16:30)
סוקר את החבילה מול `docs/marketing/BRAND.md` וכותב `REVIEW.md`, ואז נפתחת בקשת
`--kind approval` לבעלים. **אין שום נתיב קוד שמפרסם בפועל** — לא ל-DB, לא לרשת, לא
לקרדנציאל של חשבון סושיאל כלשהו (מאומת ב-`tier0.settings.json`: `WebFetch`/`WebSearch`/
`curl`/`wget` כולם חסומים, `.env*` חסום בקריאה).

**מטרת התוכנית**: להוסיף יכולת שמפרסמת בפועל ל-**Instagram ו-Facebook** העסקיים של
KALFA — **בונה על** צינור הטיוטות הקיים, לא מחליפה אותו. שני השלבים הקיימים
(social-manager כותב, brand-director שוער) נשארים **בדיוק כפי שהם**; מה שנוסף הוא
**שלב שני, נפרד**, שמתרחש רק *אחרי* ש-`REVIEW.md` כבר סימן `סטטוס: מוכנה-לאישור`.

**TikTok — לא ב-v1, במפורש.** ה-prompt של `social-manager` מזכיר TikTok כפלטפורמת-יעד
כללית, אך בפועל אין לו שום התאמת-תוכן ספציפית ל-TikTok (§ "התאמת-פלטפורמה מותרת בתוך
אותו קול" מדבר על אורך/פתיח/קצב, לא על פורמט-מדיה שונה). TikTok דורש **וידאו** כנכס —
לא תמונה סטטית — וזהו בדיוק אותו חסם ש-`creative-producer` כבר מתעד: אין צינור-הפקת-מדיה
headless בצי (רשת/מפתחות/`npx`/`python3` חסומים ב-Tier 0). לכן TikTok נשאר **מחוץ להיקף**
עד שתהיה החלטה נפרדת על צינור-הפקת-וידאו; מסמך זה לא עוסק בו כלל מעבר לציון זה.

**חסם אמיתי נוסף שהתגלה במחקר**: social-manager **אינו מייצר קובץ תמונה בפועל היום** —
רק תיאור-ויזואל-כטקסט. הבעלים (או סשן אינטראקטיבי) הוא זה שמפיק את הוויזואל בפועל, בדיוק
כמו התבנית המתועדת של `creative-producer` ("מייצר חומר שסשן אינטראקטיבי או הבעלים חייבים
לממש בפועל"). כלומר: **אין כרגע קובץ-תמונה סופי בשום batch** — פרסום אמיתי ל-Instagram
(שדורש מדיה, ראו §0) לא יכול לקרות בלי שלב-ביניים אנושי שמפיק את התמונה ומניח אותה
בתיקיית ה-batch. תוכנית זו מתייחסת לזה כאילוץ אמיתי בזרימה (§3), לא מתעלמת ממנו.

---

## 2. עקרון מנחה

`03-cli-and-request-lifecycle.md` מתעד תקדים קיים ומדויק: `analytics-summary` הוא verb
צר ב-`scripts/fleet-agent-cli.ts` שמבצע קריאת-רשת מוגבלת (GA4 Data API) **מתוך תפקיד
Tier 0** — למרות ש-Tier 0 חסום לחלוטין מ-`WebFetch`/`WebSearch`/`curl`/`wget` ברמת
ה-Bash permissions וה-guard hook. זה עובד כי ה-CLI **כולו** מותר כפעולת-Bash יחידה
(`npm run fleet:agent -- <verb>`), וכל verb בתוכו הוא שער צר משלו, שמריץ קוד TypeScript
עם קרדנציאלים שנטענים בצד-שרת (`.env.local`) **בתוך ה-handler עצמו** — לא ניתנים
ל-role, לא קריאים דרך Bash/Read שלו. ה-role לא "מקבל הרשאת רשת"; הוא מקבל **פעולה
ספציפית אחת** שמזמינה קוד-שרת מהימן שממילא לא יכול לעשות שום דבר אחר.

**זה בדיוק הדפוס ש-`publish-social` חייב לשכפל.** הדרך השגויה הייתה להוסיף
`Bash(curl:*)`/רשת ל-`tier0.settings.json` של `social-manager` — זה היה שובר את
העיקרון היסודי של כל הצי ("role יכול לבקש, לדווח ולמלא verb ספציפי — הוא לא יכול
לפעול ישירות מול הנתונים", `03` §1), והופך כל prompt-injection דרך תוכן-טיוטה (למשל
מ-BRAND.md, מקובץ REVIEW.md, או מכל טקסט אחר ש-role קורא) לנתיב-פוטנציאלי לרשת
פתוחה. verb צר עם קרדנציאל שרת-בלבד הוא **לא רק** נוח-יותר לתחזוקה — הוא ההבדל בין
"role יכול לבקש לפרסם" לבין "role יכול לפרסם", שהוא בדיוק ההבדל שכל שאר הארכיטקטורה
של הצי בנויה סביבו.

**מסקנה ישירה**: אין צורך בשום שינוי ל-`tier0.settings.json`/`guard.sh`/`fleet.json`
כדי ש-`social-manager` יוכל להזמין `publish-social` — בדיוק כפי ש-`content-seo-strategist`
מזמין `analytics-summary` היום בלי שום שינוי הרשאות. מאומת ישירות: `fleet.json:148-160`
כבר מגדיר את `social-manager` עם `"reactive": ["owner_direct_request", "goal_due"]` —
בדיוק הטריגרים הנחוצים ל-answer-watcher (ראו §3).

---

## 3. זרימת האישור המלאה

שני שערים **בלתי-תלויים** — עריכתי (brand-director) ואישור-פרסום (הבעלים) — בדיוק כפי
שדרישה 2 קובעת, לא שער אחד מוכפל. אישור הוא **per-post**, לא per-batch ולא toggle גורף:
כל פוסט בתוך batch מאושר-עריכתית מקבל בקשת-פרסום נפרדת משלו, כדי שהבעלים יוכל לאשר
פוסט A ולדחות פוסט B מאותה אצווה, ולקבל ledger שממופה 1:1 מול פרסום בפועל.

| # | שלב | מי מבצע | verb / mechanism | kind |
|---|---|---|---|---|
| 1 | כתיבת אצווה שבועית (**קיים, ללא שינוי**) | social-manager | כתיבת קבצים ל-`.fleet-logs/drafts/social/<batch>/` | — |
| 2 | ביקורת מותג (**קיים, ללא שינוי**) | brand-director | כתיבת `REVIEW.md` בתוך תיקיית ה-batch | — |
| 3 | **חדש**: הפקת תמונה סופית | הבעלים / סשן אינטראקטיבי | הנחת קובץ תמונה בתיקיית ה-batch (מוסכמת-שם, למשל `post-01.png`) | — |
| 4 | **חדש**: בקשת אישור-פרסום per-post | social-manager | `request --kind approval --tier 0 --title "🔴 פרסום בפועל: <platform> — <תקציר>" --attach <caption-file> --attach <image-file> --payload '{"action":"publish_social",...}'` | `approval` |
| 5 | הבעלים מאשר/דוחה (**קיים, ללא שינוי**) | הבעלים, דרך `/admin/fleet` | `fleet_answer_request` RPC (SECDEF, admin-only) | — |
| 6 | ה-scheduler קולט verdict (**קיים, ללא שינוי**) | `answerWatcherTick` | סריקת `verdicts` **ללא תלות** בטריגר reactive ספציפי | — |
| 7a | verdict = דחייה | social-manager (spawn מלא) | `ack --id <id>` (אין פעולה — כמו main עם denied) | — |
| 7b | verdict = אושר | social-manager (spawn מלא) | `publish-social --request-id <id> ...` (**חדש**) | — |
| 8a | פרסום הצליח | social-manager | `complete --id <id> --summary "<platform> פורסם: <permalink>"` (**קיים**) | — |
| 8b | פרסום נכשל | social-manager | `request --kind fyi --title "פרסום נכשל: ..." --body "<שגיאה>"` (**קיים**) — **לא** `complete` | `fyi` |
| 9 | ריצה הבאה (שבועית/תגובתית) | social-manager | `poll` את כל בקשות ה-`publish_social` שעדיין `approved`, ומריץ `publish-social` שוב על כל אחת (exit 2 = כבר פורסם, לא צריך גישת DB ישירה), עד תקרת-retry (§4) | — |

**נקודה קריטית שהמחקר חשף (§01 §6, "פער מבני שכדאי לחשוף")**: הסמן `verdict-<id>` נכתב
**לפני** ה-spawn והוא קבוע — "spawn אחד לכל verdict, לתמיד". אם ה-spawn הזה נכשל
(timeout, lock contention, כשל `publish-social` עצמו), **אין** מנגנון-חזרה אוטומטי דרך
ה-verdict המקורי — הוא כבר "נצרך" ברמת הסמן. הפתרון היחיד העקבי עם עיצוב הצי: הסתמכות
על הריצה **המתוזמנת** הבאה של `social-manager` (ראשון 11:30) ל-`poll` מחדש בקשות שכבר
`approved` ולהריץ `publish-social` עליהן שוב — בלי לקרוא ל-`fleet_social_posts` ישירות
(אין ל-role גישת `sql`); ה-verb עצמו הוא ה-lookup (exit 2 = כבר פורסם). בטוח לעשות זאת
בזכות ה-idempotency שב-§4 (UNIQUE constraint אמיתי ב-DB, לא רק בדיקת-קוד).

**payload.action='publish_social', לא kind חדש.** מיגרציית `fleet_requests`
(`20260723094500_fleet_requests.sql:57`) אוכפת `constraint fleet_requests_kind_check
check (kind in ('approval', 'question', 'fyi'))` — **CHECK constraint ברמת DB**, מאומת
ישירות בקוד המיגרציה. הוספת `kind` רביעי דורשת מיגרציה בלי שום תועלת מעשית: `kind='approval'`
כבר נותן בדיוק את מכונת-המצבים הדרושה (`pending → approved|denied`, `03` §3). ההבחנה
"זו לא בקשת-אישור-תוכן רגילה — זו בקשת-פרסום-אמיתי" חיה ב-`payload.action` (שדה JSON
חופשי, כבר נתמך על-ידי `--payload` הקיים ב-`cmdRequest`) ובכותרת שמתחילה ב-`🔴 פרסום
בפועל:` כדי שהבעלים לא יבלבל בין זה לאישור-תוכן-עריכתי רגיל כשהוא סורק את רשימת
הבקשות ב-`/admin/fleet` או בהתראת ה-push.

---

## 4. פירוט טכני של `publish-social`

### 4.0 החלטת ספרייה — fetch ישיר, לא ה-SDK הרשמי

נבדק `facebook-nodejs-business-sdk` (הספרייה הרשמית של Meta, ctx7
`/facebook/facebook-nodejs-business-sdk`, Source Reputation: High). **ההחלטה: לא
לאמץ אותו**, ולהשתמש ב-`fetch` ישיר מול ה-REST endpoints, מאותן שתי סיבות:

1. **חוסר-התאמה מבנית**: כל דוגמאות ה-SDK שנבדקו (`FacebookAdsApi.init`, `AdAccount`,
   `Campaign`, `AdVideo`/`VideoUploader`, `getInsights`) בנויות סביב ה-Marketing/Ads
   API — אובייקטי CRUD מופשטים לניהול קמפיינים ממומנים. אין לנו שום צורך בכך;
   הפעולה הנדרשת היא 3-4 קריאות REST פשוטות (`POST .../media`, `GET .../{id}`,
   `POST .../media_publish`, `POST .../feed`) עם אימות bearer/query-param רגיל —
   בלי gRPC/protobuf, בלי טעינת מודל-נתונים מורכב. אימוץ ה-SDK היה מוסיף תלות כבדה
   (עשרות מחלקות ads-domain) לתועלת אפסית.
2. **עקביות עם מוסכמת הפרויקט הקיימת**: `src/lib/sumit/charge.ts` קורא ל-API חיצוני
   (SUMIT) דרך `fetch` גולמי, בלי SDK — בדיוק כי SUMIT הוא REST פשוט ואין תועלת ב-SDK
   שכבתי. `analytics-summary` ב-`fleet-agent-cli.ts` כן טוען SDK רשמי
   (`@google-analytics/data`), אך **מהסיבה המפורשת** שה-gRPC/protobuf chain של GA4
   מורכב מדי לשחזור-ידני (מתועד בהערת הקוד עצמה, `fleet-agent-cli.ts:1367-1376`) — וגם
   אז דרך `createRequire` כדי לא לנפח את ה-bundle. Graph API של Meta הוא REST פשוט;
   אין כאן אותה הצדקה. `whatsapp-api-js` (המשמש ב-`src/lib/whatsapp/client.ts`) הוא
   דוגמה נגדית-לכאורה — אך הוא ספרייה **דקה וממוקדת** (עוטפת רק את ה-Cloud API
   Send endpoint), לא ה-Marketing SDK הכללי; אין מקבילה דקה-כזו רשמית ל-Content
   Publishing/Page-feed מ-Meta עצמה (הבדיקה מצאה רק ספריות צד-שלישי לא-רשמיות עם
   Source Reputation נמוך יותר — `instagram-graph-api`/`instagram-graph-api-lib` —
   שנפסלו מטעמי אמינות על משטח פרסום פומבי-אמיתי).

**מסקנה**: `publish-social` קורא ל-`fetch` ישירות מול `https://graph.facebook.com/v26.0/...`
(v26.0 הוא הגרסה החיה הנוכחית, אומת חי 2026-08-09 — שוחררה 2026-07-29; **עדיין** לאימות
מחדש מול Meta בזמן מימוש בפועל, כי API versions ממשיכות להתחלף), באותו דפוס-שגיאה
(network/HTTP-status/JSON-payload) שכבר קיים ב-`chargeSumit()`.

### 4.1 חתימת הפקודה

```
publish-social --request-id UUID --platform instagram|facebook
                --caption-file PATH [--image-path PATH]
```

- `--request-id`: UUID של שורת `fleet_requests` שאושרה (`kind='approval'`,
  `payload.action='publish_social'`).
- `--platform`: `instagram` מחייב `--image-path` (אין פוסט-טקסט-בלבד ל-IG feed —
  מאומת ב-§0); `facebook` תומך גם ב-caption-בלבד (`message`, ללא תמונה) — זה בדיוק
  מה שמאפשר את ה-rollout המדורג ב-§7.
- `--caption-file`/`--image-path`: **חייבים** להיפתר תחת `.fleet-logs/` — אותו
  containment boundary שכבר קיים ל-`--attach`/`--X-file` (`resolveFleetLogsPath()`,
  `fleet-agent-cli.ts:235-242`) ול-`--attach` עצמו (`fleet-agent-cli.ts:457-480`).
  אין קוד-containment חדש לכתוב — שימוש חוזר ישיר בפונקציה הקיימת.

### 4.2 קרדנציאלים (שמות בלבד — לא ערכים)

| משתנה סביבה | תיאור | איפה נטען |
|---|---|---|
| `META_PAGE_ACCESS_TOKEN` | טוקן Page Access ארוך-טווח של דף הפייסבוק העסקי של KALFA (משמש גם לפרסום ל-Instagram, כי ה-IG Business Account מקושר לדף) | בתוך `cmdPublishSocial()` בלבד |
| `META_FACEBOOK_PAGE_ID` | מזהה דף הפייסבוק המספרי | " |
| `META_INSTAGRAM_BUSINESS_ACCOUNT_ID` | מזהה חשבון האינסטגרם העסקי (`ig-user-id` ב-endpoints) | " |
| `META_APP_ID` / `META_APP_SECRET` | ל-`debug_token`/רענון טוקן בעת הצורך — לא חובה לקריאות פרסום עצמן, נחוץ ל-runbook רוטציה | " |

נטענים דרך `node --env-file=.env.local` **בדיוק** כמו `SUPABASE_SERVICE_ROLE_KEY` ו-קרדנציאלי
GA4 (`03` §5) — נקודת-הטעינה היחידה היא בתוך ה-handler של הפקודה עצמה. `social-manager`
(Tier 0) **לעולם לא** קורא את הערכים האלה — קריאת `.env*` חסומה בכל הדרגות
(`tier0.settings.json:53-54` + ה-guard hook).

**שוני מהותי מ-`analytics-summary` שחייב טיפול שונה**: כש-GA4 לא מוגדר,
`getGa4ConfigStatus()` מחזיר `{configured:false}` ו-**exit 0** — תוצאה שפירה, כי
"אין נתוני-תנועה" הוא מצב לגיטימי ש-role ממשיך לעבוד סביבו. **זה לא הדפוס הנכון
כאן.** אם הבעלים כבר אישר בקשת-פרסום קונקרטית וה-CLI מגלה שאין קרדנציאל Meta —
זו **לא** תוצאה שפירה; זו פעולה מאושרת שלא בוצעה. חוסר-קרדנציאל בפרסום חייב
`fail()` רגיל (exit 1, `{published:false, reason:'not_configured'}`), בדיוק כמו כל
כשל אחר — לא `console.log` שקט + exit 0. אחרת נבנה מחדש בדיוק את הבאג המתועד של
`digest` (`03` §6, ממצא 2: "`digest` תמיד מצהיר על הצלחה" כי `sendSlackAlert()`
מחזיר `null` על כשל וזה נזרק בלי בדיקה) — verb שמפרסם תוכן אמיתי-פומבי חייב
להיות **הפוך** קיצוני מהדפוס הזה.

### 4.3 מה נכתב — טבלת `fleet_social_posts` (מיגרציה מוצעת, לא מיושמת)

שום דבר היום לא עוקב "מה בעצם פורסם ומתי" — צריך ledger משלו, לא רק סטטוס
`fleet_requests`. הצעה (copy-ready ל-migration עתידית, `rls-schema-engineer`-domain):

```sql
create table public.fleet_social_posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fleet_requests(id),
  platform text not null check (platform in ('instagram', 'facebook')),
  -- 'dry_run' נכלל מראש כדי ששלב 2 (§7, publish-social --dry-run) לא יפגע ב-CHECK
  -- בדיעבד — הוא לא בשימוש עד ששלב 2 עצמו רץ.
  status text not null check (status in ('publishing', 'published', 'failed', 'dry_run')),
  external_post_id text,
  permalink text,
  -- מועתקים מ-fleet_requests.payload.attachments[].sha256 (מחושב שם על-ידי
  -- cmdRequest, ראו §4.5 סעיף 2) ברגע ש-publish-social אימת התאמה — לא קלט
  -- חדש, רק עותק-לצורך-audit עצמאי בטבלת ה-ledger.
  caption_sha256 text not null,
  image_sha256 text,
  attempt_count int not null default 1,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fleet_social_posts_request_platform_key unique (request_id, platform)
);

alter table public.fleet_social_posts enable row level security;
-- בכוונה ללא policies ל-anon/authenticated — הטבלה נגישה אך ורק ל-service_role,
-- מראה מדויקת של fleet_requests עצמה. אין צורך בגישת דפדפן לטבלה הזו ל-v1.
```

`unique (request_id, platform)`: **החלטה מפורשת** — בקשת-אישור אחת מתורגמת לכל היותר
לפוסט אחד בכל פלטפורמה. אם בעתיד ירצו שאותו פוסט יפורסם גם ל-Instagram וגם ל-Facebook
מאותה בקשה, זה **שתי שורות** (`platform='instagram'` ו-`platform='facebook'`), לא
שורה אחת עם שני מזהים — כך שהצלחה ב-FB וכישלון ב-IG מאותה בקשה נשארים ניתנים-להבחנה
ולא מתערבבים לסטטוס אחד מעורפל.

### 4.4 אידמפוטנטיות — מכונת-מצבים, לא רק בדיקת-קוד

מכונת מצבים תלת-ערכית ב-`status`, עם ה-UNIQUE constraint למעלה כשכבת-האכיפה
הסמכותית (לא רק קוד TypeScript — CAS אמיתי ב-DB, באותו רוח כמו `request_key` ו-
`triage_attempt_count`, `03` §4):

1. ניסיון ראשון: `INSERT ... ON CONFLICT (request_id, platform) DO NOTHING RETURNING *`.
   - 0 שורות הוחזרו (conflict) ⇒ שורה קיימת. `SELECT` אותה:
     - `status='published'` ⇒ **no-op שפיר** — הפוסט הזה כבר פורסם. exitCode 2.
     - `status='publishing'` ⇒ ניסיון-מקביל בעיצומו (race עם ריצה אחרת) — no-op,
       exitCode 2, לא מנסה לפרסם שוב במקביל.
     - `status='failed'` ⇒ **retry**: `UPDATE ... SET status='publishing',
       attempt_count=attempt_count+1 WHERE id=<row> AND status='failed' RETURNING *`
       (CAS על ה-status הנצפה, אותו דפוס בדיוק כמו `complete`/`goal-progress`). אם
       ה-`UPDATE` לא מחזיר שורה (מישהו כבר תפס), no-op, exitCode 2.
     - `status='dry_run'` (שריד משלב 2, §7) ⇒ אותו מעבר CAS כמו `failed` — `UPDATE ...
       SET status='publishing' WHERE id=<row> AND status='dry_run' RETURNING *` —
       מאפשר להריץ פרסום אמיתי על בקשה שנבדקה קודם רק כ-dry-run, בלי מיגרציה נוספת.
2. שורה חדשה/retry נתפס בהצלחה ⇒ ממשיכים לבדיקות הבטיחות (§4.5), ואז לקריאת Meta.
3. הצלחה ⇒ `UPDATE ... SET status='published', external_post_id=..., permalink=...,
   published_at=now()`. exitCode 0.
4. כשל (מכל סוג — HTTP לא-2xx, timeout, JSON לא-תקין) ⇒ `UPDATE ... SET status='failed',
   error=...`. exitCode 1. **הפלט תמיד `{published:false, reason:'<detail>'}` —
   לעולם לא `{published:true}` בלי `external_post_id`/`permalink` אמיתיים.**

**תקרת-retry**: אחרי **שני** ניסיונות כושלים (`attempt_count >= 2` בעת בדיקת retry),
`social-manager` לא מנסה שוב אוטומטית בריצה הבאה — הוא פותח `--kind question` לבעלים
("פרסום נכשל פעמיים — לנסות שוב / לוותר?") במקום ללולאה אינסופית. זה עקבי עם האתוס
של `qa-runner` ("אבחון הוא המוצר, לא תיקון") — retry אוטומטי חד-פעמי בטוח מבחינה
מכנית (בזכות ה-CAS), אבל retry-בלי-קץ נגד API פומבי-אמיתי הוא סיכון בפני עצמו
(חסימת-חשבון, spam על אותו תוכן שוב ושוב אם יש באג ב-detection של "כבר נכשל").

### 4.5 בדיקות בטיחות לפני כל קריאת רשת (בסדר הזה)

1. **אימות השורה**: `fleet_requests` עם ה-`request-id` הזה קיימת, `role='social-manager'`,
   `kind='approval'`, `status='approved'`, `payload.action='publish_social'`. כל
   סטייה ⇒ `fail()`, exit 1 — לא no-op, כי הזמנה כזו מעידה על טעות-קוד/מרוץ, לא על
   מצב-לגיטימי-חסר-פעולה.
2. **מנעול-תוכן (pinning) — מחושב בצד-שרת, לא על-ידי ה-role**: נבדק במפורש מול
   `tier0.settings.json` — `sha256sum` **אינו** ברשימת ה-Bash allowlist של Tier 0
   (`:32-48`: `df/free/uptime/date/ls/wc/rg/grep/cat/head/tail/sed/awk/find/du/ps/which`
   בלבד; `dontAsk` הוא fail-closed, כך שפקודה לא-רשומה נחסמת). **`social-manager`
   לא יכול לחשב hash בעצמו** — ולכן זה גם לא תפקידו. הפתרון: `cmdRequest`
   (`fleet-agent-cli.ts:425-494`) כבר מבצע `statSync` על כל `--attach` ומאחסן
   `{path, label, mime}` ב-`payload.attachments`; הרחבה קטנה (הוספת `sha256`
   מחושב-שם, דרך `createHash('sha256')` על תוכן הקובץ) מוסיפה שדה `sha256`
   לכל רשומת attachment — **מחושב על-ידי אותו קוד-שרת מהימן שכבר קורא את הקובץ**,
   לא מסופק על-ידי ה-role כערך-payload חופשי. `publish-social` מחשב `sha256`
   מחדש על `--caption-file`/`--image-path` בזמן-ריצה (attachment ראשון = כיתוב,
   שני = תמונה, לפי סדר ה-`--attach`) ומשווה מול `payload.attachments[i].sha256`.
   **חוסר-התאמה ⇒ `fail()`.** הסיבה שהבדיקה בכלל נחוצה: קבצי `.fleet-logs/`
   ניתנים לעריכה על-ידי כל role יצירתי ב-Tier 0 (`Edit` מוגבל ל-`.fleet-logs/**`,
   לא read-only), וההיגיון של brand-director ל-re-queue אחרי mtime-חדש (`02` —
   "חבילה שנדחתה וטיוטתה שונתה מאז... חוזרת לתור") מוכיח שקבצים **כן** משתנים
   אחרי-העובדה. בלי ה-hash הזה, "מה שהבעלים אישר" ו-"מה שמתפרסם בפועל" עלולים
   להיות שני מסמכים שונים. **זה גם שומר על §2**: אין תוספת-הרשאה ל-`social-manager`
   עצמו — התוספת היחידה היא כמה שורות קוד בתוך `cmdRequest`, אותו handler
   מהימן שכבר קיים.
3. **בדיקת grounding מכנית (constraint 6)**: סריקת `--caption-file` אחר תבניות
   טענת-מחיר/הבטחה (`₪`, ספרה+`%`, `חינם`/`בחינם`, וכן סופרלטיבים חשודים
   כמו "הכי"/"תמיד"/"בטוח") — אם נמצאה תבנית כזו, נדרש ש-`payload.facts_source`
   יהיה שדה לא-ריק (מקור-נתון קונקרטי, כפי ש-verb `business-facts` ב-`support-drafter`
   כבר עושה לתמחור). **חשוב להיות כנים לגבי המגבלה**: זהו net מכני, best-effort —
   הוא תופס תבניות ידועות, לא מחליף שיפוט אנושי. `brand-director` כבר בדק grounding
   באופן עריכתי לפני זה (§ צ'קליסט השער שלו); זו שכבת-הגנה **שנייה, מכנית**, לא
   תחליף לראשונה. **הכרעה משפטית/עובדתית סופית להאם מותר לפרסם משהו נשארת החלטה
   אנושית — v1 לא מנסה להפוך את זה לאוטומטי לגמרי** (ראו §6, המלצה).
4. **בדיקת REVIEW.md מכנית**: `publish-social` קורא את שורת-הפתיחה של
   `REVIEW.md` בתיקיית ה-batch המקורית (הנתיב נגזר מ-`payload`) ומוודא
   `סטטוס: מוכנה-לאישור`. זה הופך את שער-brand-director מ**התנהגותי-בלבד**
   (הבעלים סומך על כך ש-social-manager לא ביקש פרסום לפני ש-brand-director אישר)
   ל**מכני** — הגנת-עומק זולה שכבר יש לה כל התשתית (הקובץ כבר קיים, כבר במוסכמת-נתיב
   קבועה).

רק אחרי ש-**כל ארבע** הבדיקות עברו — קריאת Meta מתבצעת.

### 4.6 קריאות ה-Meta Graph API בפועל

**Facebook** (`--platform facebook`):
```
POST https://graph.facebook.com/v26.0/{META_FACEBOOK_PAGE_ID}/feed
body: { message: <caption>, access_token: META_PAGE_ACCESS_TOKEN }
→ { id: "<page-id>_<post-id>" }
```
(מאומת ctx7, Meta רשמי — `pages_manage_posts`+`pages_read_engagement`+`pages_show_list`
נדרשים. תמונה: `--image-path` נתון ⇒ `POST /{page-id}/photos`, **קובץ מצורף
כ-`multipart/form-data` (שם-שדה מוסכם-היסטורית `source`) — מאומת כשיטה נתמכת
בתיעוד הרשמי (§0, `developers.facebook.com/docs/graph-api/reference/page/photos/`,
אומת חי 2026-08-09, v26.0: "You must specify this or a file attachment"), לא
`url`.** ההחלטה המפורשת: מולטיפארט, לא `url` — `publish-social` כבר קורא את
בייטי-התמונה מ-`.fleet-logs/` (לצורך חישוב ה-hash, §4.5) לפני קריאת ה-API, כך
שהעלאה ישירה היא **פחות** עבודה מהעלאה ל-bucket ציבורי ואז הפניה ב-`url` —
ואין צורך בשום תשתית-ציבורית לפייסבוק בכלל (בניגוד ל-Instagram, ראו למטה).
שם-השדה המדויק (`source` מול חלופה) עדיין ראוי לאימות-נקודתי מול תיעוד חי
בזמן המימוש — לא עקרון-ההעלאה-הישירה עצמו, שכבר מאומת.)

**Instagram** (`--platform instagram`, **תמיד** דורש `--image-path` — אין IG feed
טקסט-בלבד):
```
1. POST https://graph.facebook.com/v26.0/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media
   body: { image_url: <public URL>, caption: <caption>, access_token: ... }
   → { id: "<container-id>" }
2. GET  https://graph.facebook.com/v26.0/{container-id}?fields=status_code&access_token=...
   (poll עד status_code=FINISHED — Meta מושך ומעבד את התמונה באופן א-סינכרוני;
   timeout סביר: כמה שניות עד ~מספר עשרות שניות, נדרש bounded retry loop, לא polling אינסופי)
3. POST https://graph.facebook.com/v26.0/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish
   body: { creation_id: <container-id>, access_token: ... }
   → { id: "<ig-media-id>" }
```
(תלת-שלבי — מאומת ב-§0 מול תיעוד Meta חי; **לא** דו-שלבי כפי שהיה ניתן להניח.
`permalink` דורש קריאה נוספת: `GET /{ig-media-id}?fields=permalink`.)

**נקודת-מפתח: בעיית ה-image hosting (Instagram בלבד — פייסבוק נפתר למעלה
במולטיפארט).** `image_url` הוא כתובת ש-**שרתי Meta עצמם מושכים** — ואומת (§0)
שזו **השיטה היחידה הקיימת** ל-`POST /{ig-user-id}/media`: אין multipart/`source`/
file-attachment ל-endpoint הזה בכלל. `.fleet-logs/drafts/` נגיש **רק** דרך
`/api/admin/fleet-file` (admin-gated), כך ש-Meta לא יכולה להגיע אליו. פרסום-IG
אמיתי דורש שהתמונה המאושרת-כבר תהיה זמינה בכתובת HTTPS ציבורית **ברגע קריאת ה-API** —
תשתית שלא קיימת היום, וזו **אינה שאלה פתוחה עוד**: אין דרך לעקוף אותה בלי bucket
ציבורי. Facebook, לעומת זאת, לא זקוק לתשתית הזו כלל (מולטיפארט, למעלה) —
לכן ה-bucket שלמטה משרת אך ורק את שלב 6 ב-§7 (Instagram), לא את שלב 5 (פייסבוק).

#### בעיית ה-image hosting ל-Instagram — ספק מלא

**Bucket** (copy-ready ל-migration עתידית, `rls-schema-engineer`-domain — אותו
דפוס-אחריות כמו §4.3):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-publish-assets',
  'social-publish-assets',
  true,  -- קריאה פומבית דרך /storage/v1/object/public/... — Meta מבצעת GET
         -- ללא כותרות-אימות (§0/§4.6 למעלה) — אין חלופה ל-URL ציבורי-לגמרי
  10485760,  -- 10MB — תקרה סבירה לתמונת-פוסט בודדת, לא ל-batch שלמה
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- קריאה פומבית מפורשת (בנוסף לדגל public=true עצמו) — אותו עיקרון
-- defense-in-depth כמו §4.5 (לא מסתמכים על flag יחיד):
create policy "social_publish_assets_public_read"
on storage.objects for select
to public
using (bucket_id = 'social-publish-assets');

-- בכוונה אין policy ל-insert/update/delete עבור anon/authenticated — אותו דפוס
-- בדיוק כמו fleet_social_posts (§4.3): רק service_role (המשמש בתוך
-- cmdPublishSocial בלבד, §4.2) יכול לכתוב/למחוק בבאקט הזה. אין לדפדפן/
-- למשתמש-מאומת שום נתיב-כתיבה.
```

`storage.objects` שייכת ל-`supabase_storage_admin`, לא ל-`postgres` —
**`rls-schema-engineer` חייב לאמת בזמן המימוש, מול הפרויקט החי (`querying-live-supabase`),
האם `create policy` על הטבלה הזו רץ כ-migration רגילה או דורש נתיב אחר**
(Dashboard / כלי-storage ייעודיים) — בדיוק אותו סוג-אימות-מול-חי שה-§0 קיים
בשבילו, לא הנחה. אין כאן הנחה ש-RLS עצמה צריכה הפעלה מפורשת: היא כבר מופעלת
כברירת-מחדל על `storage.objects` בפרויקטים מנוהלים.

**מחזור-חיים של האובייקט**:

1. **מתי נוצר**: אך ורק בתוך `cmdPublishSocial`, ואך ורק **אחרי** שכל ארבע
   בדיקות-הבטיחות ב-§4.5 עברו (כולל אימות-hash) — לעולם לא מראש/ספקולטיבית,
   ולעולם לא ב-dry-run (§7 שלב 2: dry-run כותב JSON, לא נוגע בבאקט כלל, כי
   אין קריאת-רשת בשלב הזה מטבעו).
2. **נתיב-האובייקט**: `${crypto.randomUUID()}.${ext}` (`ext` נגזר מ-
   `payload.attachments[i].mime` שכבר מחושב ב-§4.5 סעיף 2 — `image/jpeg`→`jpg`,
   `image/png`→`png`) — **לא** שם-הקובץ המקורי (`post-01.png`) ולא כל מידע
   שמזהה batch/אירוע/אורח. מי שמגלה את ה-URL (למשל דרך access-log של Meta)
   לא לומד ממנו כלום מעבר ל"קובץ אקראי אחד ב-bucket הזה".
3. **העלאה**: `supabase.storage.from('social-publish-assets').upload(path, buffer,
   {contentType: mime})` — אותו client עם `SUPABASE_SERVICE_ROLE_KEY` שכבר נטען
   בתוך ה-handler (§4.2), לא credential נוסף.
4. **מחיקה — המנגנון העיקרי**: `cmdPublishSocial` מוחק את האובייקט
   (`supabase.storage.from('social-publish-assets').remove([path])`) **ברגע
   שזרימת-הפרסום ל-Instagram מגיעה למצב-סופי בתוך אותה קריאה** — הצלחה
   (`media_publish` החזיר `id`) **או** כישלון (כל שלב נכשל/bounded-poll מוצה) —
   בלי קשר לקוד-היציאה. **חובה דרך Storage API, לא `DELETE FROM storage.objects`
   גולמי**: מאומת חי (2026-08-09, `supabase/supabase`, בלוג-שינויים 2026-03-05 —
   "Storage performance, security & reliability updates") ש-trigger ברמת-statement
   **חוסם** מחיקה ישירה ב-SQL על טבלאות ה-Storage schema אלא אם
   `storage.allow_delete_query` מוגדר `true` באותה session — **רק ה-Storage API
   קובע את הדגל הזה אוטומטית**. זהו ממצא-מחקר-חי קונקרטי בדיוק מהסוג שה-§0 קיים
   כדי לתפוס: מיגרציית-ניקוי גולמית-ב-SQL הייתה נכשלת בשקט או נדחית החל ממרץ 2026.
5. **רשת-ביטחון למקרה קריסה-באמצע-הזרימה** (לא ל-exit-code 2 — שם אין כלל
   upload, כי ה-row-claim ב-§4.4 קורה **לפני** ההעלאה): תוספת עתידית וצרה
   ל-worker ה-pg-boss הקיים באפליקציה (אותו דפוס כמו ה-sweep התקופתי של
   auto-thankyou) — סריקה שעתית של אובייקטים ב-`social-publish-assets` ישנים
   משעה, ומחיקתם דרך אותו Storage API. לא נדרש כדי שהספק הנוכחי יהיה שלם
   ועקבי — רק כהגנת-עומק למקרה-קצה של תהליך שנהרג בין ההעלאה למחיקה.

**למה מחיקה מיידית, לא "להשאיר לתמיד" כ-audit trail**: §6 כבר מנמק ש"תמונות
שכבר פורסמו... הן ממילא ציבוריות". זה נכון **רק** למקרה-ההצלחה. במקרה-הכישלון
(container לא הגיע ל-`FINISHED`, Meta דחתה, timeout) — התמונה **מעולם לא
פורסמה בשום מקום ציבורי אמיתי**, ובכל זאת הייתה יושבת ב-bucket ציבורי-לצמיתות
אם לא הייתה נמחקת: זו חשיפה **חדשה-בפועל**, לא רק חשיפת-נתיב לתוכן-שכבר-ציבורי —
זו הסיבה האמיתית למחוק, לא נוחות-תחזוקה. בנוסף, ה-bucket אינו צריך לשמש
כ-audit trail מלכתחילה: התמונה המקורית נשארת לצמיתות ב-`.fleet-logs/drafts/social/
<batch>/` (admin-gated, ללא שינוי), וטביעת-האצבע שלה (`image_sha256`) כבר נשמרת
ב-`fleet_social_posts` (§4.3) — הרישום הקנוני החי כבר קיים במקום אחר; עותק-הבאקט
הוא scaffolding-תעבורה זמני בלבד, לא ארכיון.

### 4.7 קודי exit (תואם למוסכמה הקיימת)

| exitCode | משמעות |
|---|---|
| 0 | פרסום חדש הצליח בפועל בקריאה הזו — `external_post_id`/`permalink` אמיתיים ב-JSON |
| 2 | no-op שפיר: כבר פורסם קודם (אותו `request_id`+`platform`), או race שהופסד |
| 1 | כל כשל אחר — לא נמצא/סטטוס-שגוי/hash לא-תואם/grounding נכשל/REVIEW.md לא מוכנה/קרדנציאל חסר/Meta דחה/timeout/רשת |

---

## 5. תיקוני prompt מוצעים ל-`social-manager`

תוספת copy-ready ל-`.claude/fleet/roles/social-manager.md` (לא מוחלת על-ידי מסמך זה —
להעתקה ידנית בשלב מאושר). מיקום מוצע: סעיף חדש אחרי "## פלט ואישור", לפני "## גבולות".

```markdown
## שלב שני: בקשת-פרסום בפועל (אחרי REVIEW.md)

בכל ריצה, **לפני** כתיבת אצווה חדשה, בדוק אצוות קיימות שכבר עברו את brand-director:

1. עבור על `.fleet-logs/drafts/social/*/REVIEW.md`. עניין אותך רק `סטטוס: מוכנה-לאישור`.
2. בתוך כל batch כזו, לכל פוסט שיש לו **גם** קובץ-תמונה סופי בתיקייה (לא רק תיאור-טקסט —
   קובץ בפועל, שהבעלים או סשן אינטראקטיבי הניחו שם) **וגם** אין לו עדיין בקשת-פרסום
   פתוחה/מטופלת: פתח בקשת אישור-פרסום. פוסט בלי תמונה עדיין — **דלג עליו בשקט הריצה
   הזו**, לא שגיאה; הוא יתפס בריצה הבאה כשהתמונה תופיע.
3. פתח, עם `--request-key` דטרמיניסטי (`publish-<batch>-<post-index>-<platform>`,
   **לא** נגזר מכותרת/גוף חופשיים) כדי שדדופ יעבוד גם אם הניסוח משתנה בין ריצות:
   ```
   npm run fleet:agent -- request --role social-manager --kind approval --tier 0 \
     --request-key "publish-<batch>-<post-index>-<platform>" \
     --title "🔴 פרסום בפועל: <instagram|facebook> — <תקציר-פוסט>" \
     --body "<קישור לתיקיית ה-batch + סיכום קצר>" \
     --attach <נתיב-כיתוב> --attach <נתיב-תמונה> \
     --payload '{"action":"publish_social","platform":"<instagram|facebook>","facts_source":"<אם רלוונטי>"}'
   ```
   **אל תחשב hash בעצמך** — אין לך את הכלי לכך (`sha256sum` לא ב-Tier-0 allowlist,
   ונכון שכך: זה תפקיד קוד-השרת ב-`--attach`, לא שלך; ראו §4.5). ה-`--attach`
   כבר מחשב ושומר את זה אוטומטית. הכותרת **חייבת** להתחיל ב-`🔴 פרסום בפועל:` —
   זה שונה מהותית מאישור-תוכן-עריכתי רגיל, והבעלים צריך להבחין בזה מיד
   ברשימה/בהתראה.

## טיפול ב-verdict של בקשת-פרסום

כשאתה מקבל spawn לצריכת verdict על בקשה עם `payload.action='publish_social'`:

- **נדחה** → `ack --id <id>` בלבד. אין פעולה נוספת.
- **אושר** → הרץ:
  ```
  npm run fleet:agent -- publish-social --request-id <id> --platform <platform> \
    --caption-file <נתיב> [--image-path <נתיב>]
  ```
  - הצליח (exit 0) → `complete --id <id> --summary "<platform> פורסם: <permalink>"`.
  - כבר פורסם קודם (exit 2) → אין צורך ב-`complete` נוסף אם הבקשה כבר נסגרה; אם
    היא עדיין `approved` (למשל spawn קודם נפל על lock אחרי שהפרסום כבר הצליח),
    זו העדות ש"כבר פורסם" — סגור עם `complete` עכשיו.
  - נכשל (exit 1) → `request --kind fyi --title "פרסום נכשל: <platform>" --body "<שגיאה, בלי PII>"`.
    **לעולם לא** `complete` על כישלון — זה בדיוק הבאג ש-`digest` נתפס בו (מדווח הצלחה
    שלא קרתה). אם זה הכישלון ה-**שני** לאותה בקשה, פתח `--kind question` במקום
    לנסות שוב אוטומטית.
- **retry בריצה הבאה**: אתה **לא** קורא ל-`fleet_social_posts` ישירות (אין לך
  גישת `sql` לטבלה הזו, ולא צריך) — פשוט הרץ שוב `publish-social` על כל בקשת-פרסום
  שעדיין `approved` (דרך `poll`). ה-verb עצמו הוא ה-lookup: exit 2 אומר "כבר פורסם,
  אין מה לעשות", exit 0 אומר "עכשיו פורסם", exit 1 אומר "עדיין נכשל". אתה אף פעם
  לא צריך לדעת את מצב ה-ledger מראש.

## גבולות נוספים — שלב הפרסום

- **לעולם לא** `publish-social` על בקשה שאתה לא זוכר שאישרת בעצמך כ-`social-manager`
  (`role` בשורה חייב להיות `social-manager`) — verb מסרב לכל שורה אחרת ממילא, אך
  אל תנסה לעקוף.
- **לעולם לא** לפרסם תוכן שהשתנה מאז שהבעלים אישר — `publish-social` בודק hash
  ומסרב בעצמו, אבל אל תסתמך על זה כתירוץ לא-לבדוק בעצמך שהקובץ שאתה מפנה אליו
  הוא אכן מה שאושר.
```

---

## 6. סיכונים ו-blast radius

| סיכון | תיאור | מיטיגציה בתוכנית זו |
|---|---|---|
| **מותג/מוניטין** | פוסט שגוי/לא-מדויק על העמוד הציבורי האמיתי של החברה | שני שערים בלתי-תלויים (brand-director + בעלים) + grounding מכני + REVIEW.md מכני (§4.5) — אך **אף אחד מהם אינו תחליף לשיפוט אנושי סופי** (ראו המלצה למטה) |
| **חשיפת קרדנציאל** | טוקן Meta ארוך-טווח נטען רק בתוך handler ה-CLI, אף פעם לא ל-role. סיכון השיורי: אם `.env.local` עצמו נחשף (מחוץ להיקף התוכנית — כבר מטופל כללית ע"י מדיניות הפרויקט) | ללא שינוי מהדפוס הקיים ל-GA4/Supabase; לא נוסף משטח-חשיפה חדש |
| **טוקן שפג/בוטל** | קריאת Meta נכשלת עם 401/190 (טוקן לא-תקף) | `fail()` רגיל, exit 1, `--kind fyi` לבעלים עם השגיאה — **לא** retry-אינסופי-שקט (ראה תקרת-retry §4.4) |
| **הגבלת-קצב (rate limit)** | Meta מחזירה 429/`(#4)` | אותו טיפול ככל כשל-רשת אחר — `failed`, exit 1, retry מדורג דרך הריצה השבועית הבאה, לא לולאה מיידית |
| **הפיכות (reversibility)** | פוסט שפורסם עם טעות-כתיב/תמונה שגויה/עובדה שגויה | ראה פירוט למטה — **לא-סימטרי בין הפלטפורמות, ומטופל כ-non-goal ל-v1** |
| **מקור-נתונים ל-image hosting** | bucket ציבורי-צר (§4.6, **Instagram בלבד** — פייסבוק עוקף לגמרי דרך מולטיפארט, §0/§4.6) חושף אובייקט-תמונה ספציפי לאינטרנט הפתוח בין רגע ההעלאה לרגע המחיקה | **מחיקה-בזמן-סופי מכל קריאת `publish-social` (הצלחה או כישלון), דרך Storage API בלבד — לא SQL גולמי** (מאומת: trigger חוסם מחיקה-SQL-ישירה על טבלאות ה-Storage schema החל 2026-03, §4.6) + רשת-ביטחון-שעתית עתידית ב-worker הקיים למקרה-קריסה. חלון-החשיפה בפועל: שניות עד עשרות-שניות (משך ה-poll, §4.6), לא ללא-הגבלת-זמן. במקרה-כישלון (התמונה מעולם לא פורסמה) המחיקה מונעת חשיפה חדשה-בפועל; במקרה-הצלחה התמונה כבר ציבורית דרך הפוסט עצמו ממילא. עדיין דורש אישור `rls-schema-engineer` על מדיניות ה-bucket (כולל אימות נתיב-יצירת-policy מול הפרויקט החי) לפני מימוש |

### הפיכות — פירוט

- **Facebook**: `DELETE /{post-id}` **מאומת** כתמיכה מלאה ומתועדת (§0). ניתן להוסיף
  `unpublish-social`/verb-דומה בשלב עתידי נפרד, לא ב-v1.
- **Instagram**: מאומת עכשיו בבירור מהתיעוד הרשמי החי (§0,
  `developers.facebook.com/docs/instagram-platform/reference/instagram-media/`,
  2026-08-09) — `DELETE /{ig-media-id}` **קיים ומתועד**, ומוגבל במפורש ל-"Instagram
  API with Facebook Login" — **בדיוק המשטח שבו תוכנית זו משתמשת**. הממצא השלילי
  המשלים חשוב לא פחות: הפעולה **אינה קיימת כלל** במשטח "Instagram API with
  Instagram Login" — כלומר בחירת-המשטח שכבר נקבעה כאן (§0, §4) היא **גם**
  הבחירה היחידה שבה מחיקה תהיה אפשרית-בעתיד, לא רק פרסום; זה מאמת בדיעבד את
  ההחלטה הארכיטקטונית הקיימת. עם זאת, שלוש חסימות מעשיות עדיין מצדיקות
  **non-goal ל-v1**, לא "תבנה עכשיו": (1) דורש הרשאת `instagram_manage_contents`
  נפרדת שאינה ברשימת ה-App Review המתוכננת כאן (§7 שלב 0) — עלות-ואישור נוספים
  שלא תוקצבו; (2) דורש **Facebook User access token**, לא Page token כפי
  ש-§4.2 מספק — שינוי-קרדנציאל, לא רק הרשאה נוספת על אותו טוקן; (3) שני
  דיוני-קהילה בפורום המפתחים הרשמי (~2023, לפני עדכון-התיעוד הנוכחי) מדווחים
  כישלון/חוסר-ודאות על אותו מסלול, ואין במחקר הזה אישור-הצלחה אמפירי עדכני
  (2025–2026) שמישהו הפעיל את זה בפועל — יתכן ששיקוף מצב-API ישן יותר (כמו
  `instagram_content_publish`, §0), אך לא מאומת. יש גם הגבלה תיעודית קבועה:
  מחיקת carousel היא all-or-nothing (לא ניתן למחוק פריט בודד בתוכו).
  **החלטה מפורשת ל-v1 נשארת ללא שינוי: מחיקת/הורדת פוסט מ-Instagram היא
  non-goal — פעולה ידנית של הבעלים דרך אפליקציית Instagram/Meta Business
  Suite** — אך כעת מנומקת בתיעוד קונקרטי, לא בפער-מחקר פתוח. תוספת עתידית
  (`unpublish-social --platform instagram`) אפשרית-טכנית ומתועדת, ודורשת:
  הרשאת `instagram_manage_contents` בהגשת-App-Review נפרדת, Facebook User
  token, ואימות-אמפירי-אחד מול חשבון אמיתי לפני שקוד נכתב — ואז כתוספת
  נפרדת ומאושרת בפני עצמה, לא כחלק מתוכנית זו.

### המלצה: v1 אמיתי, או "dry-run artifact" ביניים קודם?

התוכנית שוקלת את שתי האפשרויות ומגיעה למסקנה **מפוצלת ומודעת**, לא "כן" גורף או
"לא" גורף:

**כן, שווה שלב-ביניים של dry-run — אבל צר וזמני, לא v1 שלם.** הנימוקים:
1. **פער ה-image hosting (§4.6) חייב החלטת-תשתית** (bucket/מדיניות RLS) שדורשת
   מעורבות `rls-schema-engineer` בכל מקרה — זו עבודה אמיתית שלא תלויה בקרדנציאל
   Meta בכלל, וניתן להתחיל בה במקביל.
2. **קרדנציאל Meta עצמו דורש App Review באורך 2–4 שבועות לכל הרשאה** (§0) — יש
   פער-זמן טבעי ובלתי-נמנע בין "מוכנים לכתוב קוד" ל-"יש קרדנציאל אמיתי לבדוק מולו".
   שלב dry-run שמייצר בדיוק את ה-JSON payload שהיה נשלח (ללא קריאת רשת בפועל,
   נשמר כ-artifact תחת `.fleet-logs/drafts/social/<batch>/publish-payload-<platform>-<caption-basename>.json`
   — שם-הבסיס של קובץ הכיתוב נכלל בשם הקובץ כדי שלא יחפפו שני פוסטים באותה
   אצווה×פלטפורמה, תיקון 2026-08-12)
   מאפשר לבדוק את **כל** מכונת-האישורים/ה-hashing/ה-idempotency-ledger מקצה-לקצה
   עם blast radius אפס, לפני שיש בכלל טוקן חי לטעות איתו.
3. זה עקבי עם הדפוס הכללי-והמוכח של הצי עצמו: **כל** role יצירתי אחר (`content-seo-strategist`,
   `creative-producer`, `marketing-content`) בנוי היום כ"טיוטה/דיווח קודם, פעולה
   אחר-כך" — ואף אחד מהם לא קפץ ישר לפעולה חיה בלי שלב-ביניים כתוב-ומאושר.

**אבל לא כ-v1 "מלא" בפני עצמו** — כלומר לא מומלץ להשקיע בבניית dry-run **מלא**
לשתי הפלטפורמות ולשני סוגי-המדיה כמוצר-ביניים עצמאי. הסיבה: ברגע שה-ledger
(`fleet_social_posts`) ומכונת-האישורים כבר בנויים (וזה נדרש גם ל-dry-run וגם
ל-live), ההבדל בין "כתוב JSON לקובץ" ל-"שלח `fetch` אמיתי" הוא **שורה אחת של
קוד** ב-`cmdPublishSocial` — לא עבודה משמעותית נפרדת. לכן ה-dry-run הנכון הוא
**דגל `--dry-run` על אותו verb**, לא verb/צינור נפרד — וה-רצף המדורג ב-§7
כבר מייצר בפועל בדיוק את ההדרגתיות הזו (טקסט-בלבד לפייסבוק לפני תמונה, פייסבוק
לפני אינסטגרם) בלי לבנות שני מסלולי-קוד מקבילים.

---

## 7. שלבי הטמעה מוצעים

כל שלב עצמאי, ניתן-לביקורת, ומסתיים במפורש בהמתנה לאישור — לא רצף שמתבצע אוטומטית.

**שלב 0 — תשתית-קרדנציאל (לא קוד, הבעלים בלבד, מחוץ לצי):** רישום/אימות אפליקציית
Meta, אימות-עסקי (Business Verification), קישור דף-Facebook + חשבון-Instagram
Professional, הגשת App Review עבור `pages_manage_posts`+`pages_read_engagement`+
`pages_show_list`+`instagram_basic`+`instagram_content_publish` (משטח "Instagram API
with Facebook Login" — **לא** `instagram_business_content_publish`, ראו §0 המתוקן;
2–4 שבועות משוער, §0). זהו
תנאי-סף אמיתי לכל שלב שדורש קריאת-רשת חיה (שלבים 4 ואילך) — שלבים 1–3 **אינם**
תלויים בו טכנית ויכולים להתקדם במקביל.
**ממתין לאישור בעלים.**

**שלב 1 — מיגרציית `fleet_social_posts`** (§4.3, `rls-schema-engineer`): טבלה +
constraint ייחודי + RLS ללא policies (service-role בלבד). ללא שינוי התנהגות — טבלה
ריקה עד ששלב 4+ מתחיל לכתוב אליה. (ה-bucket הציבורי-הצר ל-Instagram, §4.6, אינו
תלוי בקרדנציאל Meta מבחינה טכנית וניתן היה לצרף אותו לאותה מיגרציה — אך משויך-
לוגית לשלב 6 בתוכנית זו כדי לא להקדים בניית-תשתית לפני שיש בה שימוש קרוב.)
**ממתין לאישור בעלים.**

**שלב 2 — `publish-social --dry-run`** (§6, המלצה): מימוש מלא של §4.1–§4.5 (בדיקות
בטיחות, hash-pinning, grounding מכני, REVIEW.md מכני, מכונת-מצבים ב-`fleet_social_posts`
עם `status='dry_run'` נוסף למותר), **ללא** §4.6 (אין קריאת Meta בפועל כלל) — כותב
את ה-payload המדויק שהיה נשלח לקובץ `.fleet-logs/drafts/social/<batch>/publish-payload-<platform>-<caption-basename>.json`.
מוודא את כל צינור-האישורים מקצה-לקצה בלי שום קרדנציאל אמיתי.
**ממתין לאישור בעלים.**

**שלב 3 — תוספות ה-prompt ל-`social-manager.md`** (§5): מחווט את זרימת בקשת-הפרסום
ה-per-post וטיפול-ה-verdict, עדיין מול `publish-social --dry-run` בלבד (שלב 2).
בודק את הזרימה האנושית-חלקית המלאה (הנחת-תמונה ידנית → REVIEW.md → בקשת-פרסום
per-post → אישור הבעלים → dry-run artifact) בלי סיכון-פומבי כלשהו.
**ממתין לאישור בעלים.**

**שלב 4 — פרסום אמיתי לפייסבוק, טקסט/קישור בלבד (ללא תמונה)**: מסירים את `--dry-run`
עבור `--platform facebook --caption-file ... ` (בלי `--image-path`) בלבד — מסלול
היחיד שעוקף לגמרי את בעיית ה-image hosting (§4.6). דורש שלב 0 (קרדנציאל חי) כתנאי-סף.
זהו ה-**live-write הראשון** בכל התוכנית — היקף מכוון-קטן.
**ממתין לאישור בעלים.**

**שלב 5 — תמיכה בתמונה לפייסבוק**: מימוש העלאה מולטיפארט ישירה ל-`POST /{page-id}/photos`
(שם-שדה `source`, מאומת כשיטה נתמכת ב-§0/§4.6 — נותר רק אימות-שם-שדה מדויק בזמן
המימוש) — קריאת bytes ישירות מ-`.fleet-logs/drafts/social/<batch>/`, **בלי**
Storage bucket ובלי `image_url` ציבורי כלל. תלוי רק בשלב 4 (קרדנציאל חי);
**אינו** תלוי ב-`rls-schema-engineer`/מיגרציית-bucket — זו נדרשת אך ורק לשלב 6
(Instagram).
**ממתין לאישור בעלים.**

**שלב 6 — פרסום אמיתי ל-Instagram**: דורש **קודם** את מיגרציית ה-bucket
`social-publish-assets` + מדיניות-ה-RLS שלו (§4.6, `rls-schema-engineer`),
ורק אז את זרימת ההעלאה-פרסום-מחיקה המלאה (§4.6) — IG מחייב תמונה (§0/§4.6,
אין מסלול-עקיפה כמו בפייסבוק, כי `image_url` הוא הדרך היחידה הקיימת), +
`META_INSTAGRAM_BUSINESS_ACCOUNT_ID` + הרשאת `instagram_content_publish`
פעילה בפועל (לא רק מוגשת). ממומש רק אחרי כמה מחזורי-הצלחה יציבים בפייסבוק
(שלבים 4–5), לא במקביל אליהם.
**ממתין לאישור בעלים.**

**שלב 7 (עתידי, לא חלק מ-v1, מוזכר להשלמה בלבד)**: TikTok — דורש צינור-הפקת-וידאו
שלא קיים היום בכל הצי (§1). לא נבחן בתוכנית זו מעבר לציון-חסימה זה. **נקודת-פתיחה
קונקרטית לעתיד, לא יותר**: `creative-producer` כבר מחזיק צינור-הפקה עובד לכך —
HyperFrames (הרכבת MP4) + ElevenLabs (קריינות/מוזיקה/SFX) — אך מתועד במפורש
בתפקידו-שלו (`.claude/fleet/roles/creative-producer.md`, נמדד 2026-07-29) שהצינור
הזה עובד **רק בסשן אינטראקטיבי** ("בריצה אוטומטית (Tier-0) אין לך מסלול הפקה. אף
אחד.") ולא בריצת-צי headless. לכן שלב-TikTok עתידי סביר **לא** יבנה צינור-הפקה
חדש בתוך הצי, אלא ישכפל את הדפוס הקיים כבר בתוכנית הזו (§1, §3 שלב 3): וידאו
מופק אינטראקטיבית, מאושר ע"י brand-director+הבעלים, ומונח בתיקיית ה-batch —
ורק אז הרחבה עתידית כמו `publish-social --platform tiktok` (שאינה קיימת) צורכת
את התוצר המוגמר, בדיוק כפי ש-`publish-social` היום צורך תמונה שהופקה ידנית.

---

## 8. סטטוס

**זו תוכנית DRAFT, ממתינה לאישור בעלים מפורש לפני שכל שלב-הטמעה כלשהו מתחיל** — כולל
שלב 1 (מיגרציה) ושלב 2 (dry-run), שאינם דורשים קרדנציאל Meta בפועל אך עדיין מהווים
שינוי קוד/סכימה בפרודקשן.

**תנאי-סף שהבעלים חייב לטפל בו מחוץ לצי לפני שכל שלב live (4 ואילך) יכול להתחיל**:
יצירה/הוצאה של אפליקציית Meta Graph API אמיתית — אימות-עסקי (Business Verification),
קישור דף-Facebook וחשבון-Instagram Professional, והגשת App Review להרשאות הנדרשות
(`pages_manage_posts`, `pages_read_engagement`, `pages_show_list`,
`instagram_basic`, `instagram_content_publish`) — תהליך עם זמן-אישור משוער 2–4 שבועות
לכל הרשאה (§0). אין בתוכנית זו, ולא יהיה בשום שלב-הטמעה, קרדנציאל אמיתי, קריאת-רשת
בפועל, או עריכה ל-`.claude/fleet/**`/`fleet.json` — כל אלה ממתינים לאישור מפורש
ונפרד, שלב אחר שלב, כפי שמפורט ב-§7.
