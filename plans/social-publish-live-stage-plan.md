# KALFA Fleet — `publish-social` שלב §4.6 (הקריאה החיה ל-Meta) + פתרון ה-image hosting ל-Instagram

> מסמך זה נכתב לאחר קריאה מלאה (לא grep) של `src/lib/fleet/publish-social.ts` (279 שורות)
> ו-`src/lib/fleet/publish-social.test.ts` (271 שורות), קטע ה-`publish-social`
> ב-`scripts/fleet-agent-cli.ts` (התחל שורה 1592, כולל תיעוד-הפקודות בראש הקובץ ומנגנון
> `--attach`/`resolveFleetLogsPath`), `supabase/migrations/20260810061515_fleet_social_posts.sql`,
> `src/app/api/admin/fleet-file/route.ts`, `src/lib/url.ts`, `src/lib/storage/event-media.ts`,
> `src/lib/storage/legal-docs.ts`, `src/app/(public)/g/[token]/page.tsx` +
> `src/app/(public)/g/[token]/go/route.ts`, ומסמך התוכנית המקורי המלא
> `plans/fleet-social-publishing-capability-plan.md` (696 שורות — כולל §0 עד §8). כן נבדק
> ישירות מול הפרויקט החי (Supabase MCP, קריאה-בלבד): רשימת ה-buckets הקיימים, בעלות/RLS
> על `storage.objects`, וחברות-תפקידים (`pg_auth_members`) — ראו §2.4. **גם** את מלוא
> מצב-ה-`fleet_requests`/`fleet_social_posts` הקיים בפועל עבור `payload.action='publish_social'`
> (24 שורות, כל השדות הרלוונטיים) — ראו §0, ממצא-חי קריטי שהוביל להוספת §0 כתנאי-סף. כן
> בוצע אימות-חי נוסף מול תיעוד Meta — **שני מקורות עצמאיים, לא מזיכרון-מאומן**: (1) `ctx7`
> CLI (`npx ctx7@latest library`/`docs`, ספריות `/websites/developers_facebook_instagram` +
> `/websites/developers_facebook_graph-api`, לפי הנחיית הבעלים) ו-(2) WebFetch/WebSearch
> ישיר מול `developers.facebook.com` — ראו §7, טבלה עם ציון-מקור לכל שורה, נכון ל-2026-08-12.
>
> **זהו מסמך תכנון בלבד.** לא בוצע אף שינוי קוד, לא נכתב שום דבר ל-DB (כולל §0 — כל השאילתות
> שם `SELECT` בלבד; פקודות ה-`complete` המוצעות שם מיועדות להרצה על-ידי הבעלים/המפעיל, לא
> הורצו על-ידי), לא בוצעה שום קריאת-רשת עם טוקן Meta (אין לי טוקן כזה, ולא חיפשתי אחד). כל
> בלוק "copy-ready" הוא הצעה להעתקה-והחלה ידנית בשלב מאושר נפרד. `src/lib/fleet/publish-social.ts`
> ו-`scripts/fleet-agent-cli.ts` **לא נערכו**.

---

## 0. Pre-flight חובה — לבצע **עכשיו**, לא בשלב go-live (ממצא-חי קריטי, 2026-08-12)

**זו הפעולה הדחופה ביותר במסמך הזה, ובכוונה ממוקמת ראשונה.** גילוי חי (הבעלים, דרך
team-lead): הטווין האוטונומי אישר בעבר 8 בקשות `publish_social` (מפתחות `-logo`) לשתי
האצוות `20260802-batch`/`20260809-batch`, כשהן מצרפות את קבצי הטיוטה הגולמיים
(`post-N.md`) ככיתוב-לפרסום. קראתי ישירות מול ה-DB החי (SELECT בלבד, לא סמכתי על הדיווח
כשלעצמו) — הממצא **מדויק יותר** מ"6-7" שבדיווח המקורי:

### 0.1 מצב מאומת (SELECT ישיר על `fleet_requests`+`fleet_social_posts`, לא grep, 2026-08-12)

| קבוצה | כמות | `fleet_requests.status` | `fleet_social_posts.status` | סיכון |
|---|---|---|---|---|
| **`-logo` — סיכון אקוטי** (`publish-20260809-batch-2-{instagram,facebook}-logo`, `publish-20260802-batch-{1,2}-{instagram,facebook}-logo`) | **6** | `approved` | `failed`, `attempt_count=2` | **כן — retry-eligible דרך `decideExistingRow('failed')→'retry'`. ברגע ש-§4.6 חי עם קרדנציאלים, ריצת `poll` רגילה של social-manager (שמריצה `publish-social` מחדש על כל בקשה שעדיין `approved`, בדיוק לפי plan §3 סעיף 9) תפרסם בפועל את ה-Markdown הגולמי** |
| `-logo` — מלוכלך אך כבר-חסום | 1 (`publish-20260809-batch-1-facebook-logo`) | `consumed` | `failed`, `attempt_count=1` | לא — `validatePublishRequestRow` דורש `status==='approved'` **בדיוק**; `consumed` נכשל בבדיקה הראשונה, לפני `decideExistingRow` בכלל. אך שורה מלוכלכת-ללא-הסבר בledger |
| `-logo` — כבר-נקי | 1 (`publish-20260809-batch-1-instagram-logo`) | `consumed` | אין שורה | לא — אותו טיעון |
| **`-final` — האצווה הנכונה** (`publish-{20260809,20260802}-batch-{1,2}-{instagram,facebook}-final`) | 8 | `approved` | אין שורה עדיין (לא נוסה מעולם) | **זו** האצווה שאמורה להתפרסם בפועל — לפי team-lead, ומאושש ע"י צורת-נתיב-הכיתוב (קובץ `.txt` ייעודי-לפלטפורמה, `post-N-caption-<platform>.txt`, לא `.md` משותף) — **לא נגזר מקריאת-תוכן עצמאית שלי** |
| ישן, כבר-טרמינלי | 8 (מפתח-רגיל בלי סיומת, כל השורות `expired`) + 2 (`test-...`/`TEST-DELETE-ME-...`, `expired`/`consumed`) | `expired`/`consumed` | אין/לא-רלוונטי | לא — כבר טרמינלי, ללא פעולה נדרשת |

**סה"כ 24 בקשות `publish_social`.** ה"6-7" בדיווח המקורי מתיישב עכשיו במדויק: 6 בסיכון
אקוטי + 1 נוספת שנגעה ב-ledger (סה"כ 7 עם `fleet_social_posts` row) + 1 עוד `-logo`
נקייה-לגמרי (סה"כ 8 מפתחות `-logo`).

### 0.2 למה **עכשיו**, לא כ"שלב pre-flight" בזמן go-live

הסטאב הקיים היום (`if (!dryRun) { markFailed(...); fail(...) }`,
`fleet-agent-cli.ts:1806–1811`) הופך פרסום-חי לבלתי-אפשרי **פיזית** — זה הרגע הבטוח
ביותר לסגור את השורות האלה. אם הניקוי נדחה ל"שלב pre-flight של go-live", הוא יתבצע
בדיוק ברגע שרשת-הביטחון הזו מוסרת, ע"י מי שכבר עסוק גם בקרדנציאלים וגם ב-App Review —
התזמון הגרוע ביותר האפשרי. **הפעולה הזו עצמאית לגמרי משאר המסמך: לבצע היום, בלי תלות
בהחלטת-האחסון (§2), בקוד §4.6, או באישור-בעלים לשלבי-ההטמעה ב-§7 של התוכנית המקורית.**

### 0.3 הפעולה הנדרשת — סגירה טרמינלית של 6 השורות

בדקתי את מכונת-המצבים המלאה, האוכפת-DB, של `fleet_requests`
(`supabase/migrations/20260727000620_fleet_requests_completed_status.sql`, פונקציית
`fleet_requests_guard()` — trigger, לא הנחה): המעבר החוקי היחיד מ-`approved` למצב-טרמינלי
**בלי** לבצע את הפעולה המבוקשת בפועל הוא `approved → completed`, דרך verb ה-`complete`
הקיים **כבר** ב-CLI (`complete --id UUID --summary TEXT`) — אין verb "ביטול"/"דחייה"
נפרד. **מתח מובנה שיש לקרוא בקול, לא להצניע**: הערת-הראש של plan §5 קובעת "**לעולם לא**
`complete` על כישלון — זה בדיוק הבאג ש-`digest` נתפס בו" — ושש הבקשות האלה **מעולם לא
פורסמו בפועל**. מכנית `complete` הוא המנגנון החוקי היחיד, אבל **טקסט ה-`--summary` חייב
לשאת את מלוא הנטל של יושר**: לומר במפורש "לא פורסם" ו"הוחלף ע"י `-final`" — לא לתת
לרישום `completed` להיקרא בעתיד כ"פורסם בהצלחה".

**שקלתי גם `ack` (מעבר `approved → consumed` — גם הוא מעבר חוקי לפי אותו trigger) ונדחה**:
לא קראתי את ה-RPC `fleet_consume_request` עצמו (מחוץ להיקף-הקריאה שלי היום), כך שזהו
נתיב לא-מאומת; וה-trigger מקפיא את `answer` במעבר הזה — כלומר לא נשאר שום הסבר-בledger
למה הבקשה נסגרה. מנגנון אחד מאומת (`complete`) עדיף על שניים כשרק אחד מאומת.

**פקודות מוכנות-להעתקה** (להריץ ע"י הבעלים/המפעיל — **לא** על-ידי — `complete` הוא כתיבת-DB,
מחוץ לגבול "אפס כתיבה ל-DB" שלי. **לאמת מחדש שה-`status` עדיין `approved` לפני כל הרצה** —
ה-IDs נקראו-חי כעת אך מצב יכול להשתנות במקביל):

```bash
npm run fleet:agent -- complete --id fddf8880-baa2-400e-9fce-32b65df05580 \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight לפני שקוד §4.6 עולה. הבקשה צירפה את הטיוטה הגולמית post-2.md ככיתוב; הוחלפה ע\"י publish-20260809-batch-2-instagram-final עם כיתוב נקי ייעודי-לפלטפורמה."

npm run fleet:agent -- complete --id 42504b14-8d53-4ea4-883b-096d2168f45b \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight. הוחלפה ע\"י publish-20260809-batch-2-facebook-final."

npm run fleet:agent -- complete --id 26388c2b-896c-4807-886f-53ca0d4c48ed \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight. הוחלפה ע\"י publish-20260802-batch-1-instagram-final."

npm run fleet:agent -- complete --id 5df2aeed-055c-4276-8014-45b57a6dca36 \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight. הוחלפה ע\"י publish-20260802-batch-1-facebook-final."

npm run fleet:agent -- complete --id f5ae8001-d05e-4841-ba26-65b434d47362 \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight. הוחלפה ע\"י publish-20260802-batch-2-instagram-final."

npm run fleet:agent -- complete --id 0197073f-fa1e-4cef-92ce-5e13bfbaf8d2 \
  --summary "לא פורסם בפועל — סגירה טרמינלית pre-flight. הוחלפה ע\"י publish-20260802-batch-2-facebook-final."
```

שתי השורות ה-`consumed` (§0.1) **אינן ניתנות** ל-`complete` (ה-trigger לא מגדיר מעבר
`consumed → completed`) — כבר טרמינליות וחסומות; ניקוי-קוסמטי שלהן הוא אופציונלי, לא
דרוש לבטיחות. **אל תיגע בשמונה בקשות ה-`-final`** — הן נשארות `approved`, הן המטרה
המיועדת לניסיונות-הפרסום-החיים הראשונים ברגע ש-§4.6 עולה.

### 0.4 אימות שהניקוי הצליח — assertion, לא dump

שתי שאילתות `SELECT`-בלבד. **הראשונה חייבת להחזיר 0 שורות** לפני טעינת כל קרדנציאל:

```sql
select fr.request_key, fr.status, fr.payload->'attachments'->0->>'path' as caption_path
from fleet_requests fr
where fr.role = 'social-manager' and fr.kind = 'approval'
  and fr.payload->>'action' = 'publish_social'
  and fr.status = 'approved'
  and fr.payload->'attachments'->0->>'path' like '%.md';
-- 0 שורות = תקין: אין יותר בקשת publish_social במצב 'approved' שמצביעה על קובץ .md גולמי
```

**השנייה מאשרת שנשארו בדיוק 8 השורות הנכונות**:

```sql
select fr.request_key
from fleet_requests fr
where fr.role = 'social-manager' and fr.kind = 'approval'
  and fr.payload->>'action' = 'publish_social'
  and fr.status = 'approved'
order by fr.request_key;
-- אמור להחזיר בדיוק 8 שורות, כולן עם הסיומת -final
```

### 0.5 שכבת-הגנה מכנית נוספת (מומלץ, לא תחליף לניקוי הידני)

**Guard 1 — דחיית קובץ-כיתוב בפורמט `.md` (מומלץ, לממש יחד עם §4.6)**: פונקציה טהורה
חדשה ב-`publish-social.ts`, למשל `validateCaptionFileFormat(path: string): string | null`
שמסרבת כש-`extname(path) === '.md'`. חלה **גם** על dry-run **וגם** על live — אין סיבה
בטיחותית להחריג dry-run, ו-fixture הטסט הקיים (`post-01-caption.txt`) כבר תואם. **תלות-
הדדית שיש להצהיר עליה**: ה-guard הזה שולח יחד עם תיקון-prompt מתועד ל-
`.claude/fleet/roles/social-manager.md` (לא מוחל כאן — הצעה בלבד) שקובע במפורש שכיתוב-
לפרסום הוא קובץ `.txt` ייעודי-לפלטפורמה — משקף את מה שכבר קרה בפועל היום ב-`-final`.
**להטמיע קוד בלי לתעד את המוסכמה הוא מלכודת לאצווה הבאה** — plan §5 היום אומר רק
`--attach <נתיב-כיתוב>`, בלי כלל-פורמט.

**נשקל ונדחה (לא כרגע)**: אכיפת-שם-קובץ-מכיל-את-הפלטפורמה (`instagram`/`facebook`
בשם-הקובץ). נדחה כי `validatePublishPayload` **כבר** צולב-בודק `--platform` מול
`payload.platform` (קוד קיים, בדוק), המוסכמה נצפתה בסבב-בדיקה **אחד** בלבד היום ואינה
כתובה בשום מקום, ואכיפתה הייתה שוברת את האצווה החוקית הבאה אלא אם ה-prompt של
social-manager גם מעודכן לייצר שמות כאלה תמיד — יותר-מדי חלקים-נעים עבור כשל שעדיין
לא קרה בפועל.

**Guard 2 — תאריך-חיתוך `PUBLISH_SOCIAL_LIVE_CUTOFF` (מומלץ, **live-path בלבד**)**: env
var חדש; **חובה כשלא dry-run** — אותה עמדת fail-closed כמו קרדנציאל Meta חסר (§3.1/§4.6):
לא מוגדר ⇒ `fail()`, exit 1, **לא** דילוג שקט — בדיוק כמו `APP_ORIGIN` ב-`src/lib/url.ts`
בפרודקשן (ערך-מוגדר-מפורש, לעולם לא נגזר). **רק live** — אין תועלת-בטיחותית לחסום
dry-run לפי תאריך, רק חיכוך-בדיקות מיותר. `cmdPublishSocial`'s live path בודק
`fleet_requests.created_at >= PUBLISH_SOCIAL_LIVE_CUTOFF` (ISO 8601, נפרס פעם אחת)
לפני כל המשך — בקשה ישנה-מהחיתוך נדחית עם הודעה ברורה, `markFailed`, אפס קריאת-Meta.
הבעלים קובע את הערך בפועל בזמן ה-deploy — כל תאריך אחרי `2026-08-12T06:04:40Z`
(רגע-היצירה של בקשת ה-`-final` האחרונה) **וגם** אחרי סיום הניקוי (§0.3) — למשל
`2026-08-12T06:10:00Z` ומעלה — **לא** hardcoded בקוד. **זהו guard-מעבר, לא invariant
לצמיתות**: מגן בדיוק על החלון "הרגע שהקרדנציאלים עלו — האם נשאר משהו ישן שעדיין
approved". בעוד חצי שנה כל בקשה לגיטימית תהיה אחרי החיתוך והוא יהפוך לאינרטי (לא-מזיק
להשאיר — הבדיקה זולה וללא-תופעת-לוואי); ברירת-המחדל המומלצת היא **להשאיר לצמיתות**,
לא לתזמן הסרה — הסרתו-מאוחר-יותר, אם בכלל, יכולה להיות PR קטן נפרד בלי דחיפות.

### 0.6 מוכנות תפעולית של 8 בקשות ה-`-final` (נפרד מהשאלה הבטיחותית)

ל-8 בקשות ה-`-final` **אין** עדיין שורת `fleet_social_posts` (מעולם לא נוסו), ולא
אימתתי שהקבצים-בפועל/ה-hash שלהם ב-`.fleet-logs/drafts/social/<batch>/` עדיין תואמים
את `payload.attachments[].sha256` שנשמר בזמן האישור. hash-pinning (§4.5, קוד קיים) נכשל-
סגור אם יש סטייה — **זו לא חשיפת-בטיחות**, אבל אם הקבצים זזו מאז האישור, ריצת-החי
הראשונה תפיק 8 כשלים במקום 8 הצלחות. מומלץ: מעבר `--dry-run` יחיד על כל 8 בקשות
ה-`-final` **לפני** הסרת `--dry-run` בפרודקשן, כדי לתפוס סחיפה מוקדם וזול.

---

## תוספת א׳: מסלול Instagram API — קלאסי (Facebook Login) מול חדש (Instagram Login) — הכרעה, 2026-08-12

**רקע** (צילום-מסך מדשבורד Meta, מהבעלים): הבעלים הקים את מוצר **"Instagram API"** —
מסלול **Instagram Login** — **שונה** מהמסלול הקלאסי שכל `src/lib/fleet/publish-social.ts`
הקיים (§1.1) וכל §2–§4 של מסמך זה עד כאן בנויים עליו. `instagram_business_basic`/
`instagram_business_manage_comments`/`instagram_business_manage_messages` כבר נוספו
למוצר; `instagram_business_content_publish` (הנחוצה בפועל לפרסום) — **עדיין לא**.
`META_APP_ID`/`META_APP_SECRET` כבר יושבים ב-env בשרת (לא נקראו על-ידי — רק ידוע שהם שם).

### שני המסלולים — מאומת-חי (ctx7, `/websites/developers_facebook_instagram`, 3 קריאות
נוספות + WebFetch, 2026-08-12 — לא מזיכרון)

| | **מסלול A — קלאסי** (Facebook Login) — הקוד הקיים ו-§2–§4 כאן בנויים עליו | **מסלול B — חדש** (Instagram Login) — מה שהבעלים כבר הקים |
|---|---|---|
| Host | `graph.facebook.com` | `graph.instagram.com` |
| סוג טוקן | Facebook Page access token | Instagram User access token |
| תלות בדף-פייסבוק מקושר | כן — IG Business Account **חייב** להיות מקושר לדף, הטוקן נגזר מהדף (`GET /me/accounts` → `instagram_business_account.id`) | לא — עצמאי, לא תלוי בקישור-דף |
| הרשאות פרסום | `instagram_basic`+`instagram_content_publish`+`pages_read_engagement` (+`pages_show_list`, +`ads_management`/`ads_read` אם יש תפקיד Business Manager — §7) | `instagram_business_basic`+`instagram_business_content_publish` |
| **App Review לפרסום לחשבון-עצמי** | **תמיד נדרש**, ללא הבחנה חשבון-עצמי/חשבון-לקוח — 2–4 שבועות (מאומת בתוכנית המקורית + §7 כאן) | **לא נדרש תחת Standard Access** — ראו ציטוט-מקור להלן |
| מנגנון-בדיקה לחשבון-עצמי | Instagram Tester קלאסי (Facebook App Testers) | הוספת חשבון-אינסטגרם ישירות ב-App Dashboard ("Step 7: Generate access tokens" — כניסה-ישירה; מנגנון-הזמנה/אישור מדויק **לא** אומת במלואו, ראו הסתייגות למטה) |
| **פרסום לפייסבוק** (`/feed`, `/photos`, §3.2/§4.5) | **זהה בשני המסלולים** — Page access token + `graph.facebook.com` תמיד; **לא מושפע כלל מבחירת-מסלול-IG** | (אותו דבר) |
| **`image_url`/bucket (§2)** | **זהה בשני המסלולים** — שני המשטחים דורשים `image_url` ציבורי-נגיש-ל-Meta באותו אופן; §2.7 (מבחן-מבחין) נשאר תקף, רק הקריאה הנבדקת עוברת ל-`graph.instagram.com` | (אותו דבר) |

**הממצא המכריע**, ציטוט ישיר מ-`developers.facebook.com/docs/instagram-platform/overview`
(מאומת פעמיים — ctx7 **וגם** WebFetch ישיר לאותו עמוד, שני מקורות זהים מילה-במילה,
2026-08-12): *"Standard Access is the default access level for all apps... If your app
only serves your Instagram professional account or an account you manage, Standard Access
is all your app needs"* וגם *"Your app must complete Meta App Review to be granted
Advanced Access"* — App Review קשור **אך ורק** ל-Advanced Access (חשבונות **שאינם**
בבעלות/ניהול המפתח), **לא** ל-Standard. מכיוון ש-KALFA מפרסם אך ורק לחשבון-האינסטגרם
העסקי **שלו-עצמו**, מסלול B נכנס תחת Standard Access — ומחיקה בכך את חסם-הזמן החמור-
ביותר שהתוכנית המקורית זיהתה (2–4 שבועות App Review, §0 שם + §7 כאן).

### השלכות על הבילדרים/הקוד המוצע (§3–§4 להלן, **טרם הוחל**)

- `buildInstagramPublishPlan`/`publishInstagram` (§4.1/§4.5) יזדקקו ל-endpoint-ים תחת
  `https://graph.instagram.com/v26.0/...` במקום `graph.facebook.com` — **לאמת-נקודתית
  את מחרוזת-הגרסה למשטח הזה בזמן המימוש**, בדיוק כפי שכבר סומן ב-§7 עבור המשטח הקלאסי;
  לא הונח כאן.
- שם-קרדנציאל **חדש**, שונה מ-§3.1/§4.2 הקיימים: מוצע `META_INSTAGRAM_USER_ACCESS_TOKEN`
  (Instagram User token — **לא** `META_PAGE_ACCESS_TOKEN`, שנשאר ייעודי-לפייסבוק בלבד).
  מזהה-החשבון (`ig-user-id`) **כנראה** זהה למספר שכבר יושב תחת
  `META_INSTAGRAM_BUSINESS_ACCOUNT_ID` (אותו חשבון אינסטגרם עסקי, רק דרך משטח-טוקן אחר) —
  **לא הנחה, לאמת אמפירית**: לקרוא `GET /me` עם הטוקן החדש ולהשוות ידנית מול הערך הקיים
  לפני שמניחים זהות.
- `pageAccessToken`/`facebookPageId`/`buildFacebookFeedRequest`/`buildFacebookPhotoRequest`
  (§3.1–3.2/§4.1/§4.6) **נשארים בדיוק כפי שהם** — פרסום-פייסבוק לא מושפע כלל.
- §2 (bucket פרטי + signed URL) ו-§0 (pre-flight) **אינם מושפעים כלל** מבחירת-המסלול —
  §2 כי מנגנון ה-`image_url` זהה בשני המשטחים; §0 כי הסיכון שם הוא תוכן-שגוי-שמתפרסם,
  לא תלוי-host.
- **מחוץ להיקף "סעיף-הכרעה קצר"**: קוד ה-`copy-ready` המלא ב-§3/§4 להלן **עדיין כתוב
  למסלול A** (כפי שהיה כשנכתב, לפני העדכון הזה). ברגע שהבעלים מאשר את מסלול B, נדרש
  עדכון ממוקד (endpoint host + שם-קרדנציאל, לא ארכיטקטורה חדשה) לפני החלה — לא בוצע
  במסמך זה, כדי לשמור על הסעיף הזה קצר וממוקד-בהכרעה כפי שהתבקש.

### המלצה חדה

**לעבור למסלול B (Instagram Login).** הנימוק המרכזי: זהו החסם התזמוני החמור-ביותר
שהתוכנית המקורית זיהתה — App Review בן 2–4 שבועות — והוא **נעלם כליל** עבור פרסום
לחשבון-עצמי תחת Standard Access, מאומת-חי פעמיים (ctx7+WebFetch) מתיעוד Meta הרשמי של
היום. פייסבוק ממשיך **ללא כל שינוי** דרך המסלול הקלאסי (Page token) — אין ולא נחוץ
תחליף-Instagram-Login לפייסבוק. עלות-המעבר בקוד: שינוי endpoint-host אחד + שם-קרדנציאל
אחד בקוד-המוצע (§4, טרם-הוחל) — לא ארכיטקטורה חדשה; §0 ו-§2 השלמים נשארים תקפים כמות-
שהם.

**הסתייג-חובה, לא לדלג עליו**: ההמלצה סומכת על "Standard Access מספיק לחשבון-עצמי".
עצם **הוספת** ההרשאה `instagram_business_content_publish` למוצר בדשבורד (הצעד שהבעלים
עדיין לא ביצע) עלולה עדיין לדרוש שלב-הגדרה כלשהו (גם אם לא "App Review" מלא עם
screencast) — **לאמת בפועל ברגע שההרשאה נוספת בדשבורד**, לא להניח שזה אוטומטי-לחלוטין.
מנגנון ה-Tester/יצירת-הטוקן המדויק (WebFetch ישיר לעמוד ה-setup לא סיפק תוכן שימושי —
דף דורש הרשאות-גישה שלא היו זמינות לי; ctx7 נתן רק תיאור-חלקי: "Step 7: Generate access
tokens... add a public Instagram account... login... Multiple accounts... for multiple
testers") נותר לאימות-נקודתי בזמן המימוש בפועל. גם אם מתברר שנדרש איזשהו אישור-מקוצר —
סביר-מאוד שעדיין מהיר משמעותית מ-2–4 השבועות של מסלול A, אך זו נקודת-אימות אחרונה לפני
הסתמכות על "אפס-המתנה".

---

## 1. ניתוח המצב הקיים

### 1.1 `src/lib/fleet/publish-social.ts` — מה כבר קיים ומאומת (279 שורות, ללא I/O)

קובץ-לוגיקה-טהורה (`import { createHash } from 'node:crypto'` בלבד + `zod` — אין
filesystem/DB/network) עם 4 קבוצות פונקציות שכבר בנויות ובדוקות ב-271 שורות טסט
(`publish-social.test.ts`, 100% מהפונקציות המיוצאות מכוסות):

1. **ולידציה** — `validatePublishRequestRow` (role/kind/status), `validatePublishPayload`
   (Zod schema על `payload`, כולל בדיקת platform-match והודעת-שגיאה ייעודית ל-sha256
   חסר/לא-תקין), `validatePlatformImageRequirement` (IG חייב תמונה).
2. **grounding מכני** — `scanGroundingClaims`/`validateGrounding` (₪ / N% / חינם / סופרלטיבים
   → דורש `facts_source`).
3. **מכונת-מצבים** — `decideExistingRow(status)`: `'published'|'publishing'` → `'noop'`,
   `'failed'|'dry_run'` → `'retry'`, כל דבר אחר → `throw`. **חשוב**: הפונקציה הזו **לא
   מקבלת/בודקת `attempt_count`** — ראו §9.2, זו אחת משתי הפערים שזיהיתי מול §4.4 של
   התוכנית המקורית.
4. **בוני-בקשה טהורים** (הליבה הרלוונטית ל-§4.6): `buildFacebookFeedRequest`,
   `buildFacebookPhotoRequest`, `buildInstagramPublishPlan`, `buildDryRunArtifact` — כולם
   בונים את גוף-הבקשה **המדויק** שיישלח ל-Meta, כולל endpoint-ים מלאים עם `v26.0` ופלייסהולדרים
   מילוליים (`{META_FACEBOOK_PAGE_ID}` וכו') **ולא** ערכים אמיתיים — בדיוק כפי שתועד בהערת
   הראש (`// No network/credential access here`). `buildInstagramPublishPlan` בונה תוכנית
   תלת-שלבית (`create_container` → `poll_status` → `publish`) עם `image_url: null` **קבוע**,
   ותיעוד מפורש בקוד (שורה 241) שזה תלוי ב"social-publish-assets public bucket (plan §4.6,
   §7 stage 6) — not yet migrated". **כלומר: שם ה-bucket וההחלטה שהוא ציבורי כבר כתובים
   בקוד היום**, כתזכורת-להמשך — לא רק בתוכנית המקורית.

### 1.2 `scripts/fleet-agent-cli.ts` — מה `cmdPublishSocial` כבר עושה בפועל (שורות 1592–1841)

זרימה מלאה שכבר עובדת עד לנקודת-העצירה המכוונת:

1. פרסינג + `validatePlatformImageRequirement`.
2. `resolveFleetLogsPath` על `--caption-file`/`--image-path` — containment קיים, לא נכתב מחדש.
3. שליפת שורת `fleet_requests` לפי `--request-id`, `validatePublishRequestRow` +
   `validatePublishPayload(row.payload, platform)`.
4. חישוב `sha256Hex` בפועל על `--caption-file`/`--image-path` (שורות 1644–1661).
5. **claim על `fleet_social_posts`** (§4.4 של התוכנית): `INSERT`, ובהתנגשות `SELECT` +
   `decideExistingRow` + CAS `UPDATE` על retry. **שים לב**: אין כאן כרגע שום בדיקה של
   `attempt_count` מול תקרה — ראו §9.2.
6. Safety #2 (hash-pinning), #3 (grounding), #4 (REVIEW.md) — כל כשל קורא ל-`markFailed`
   (מעדכן `status='failed', error=<reason>`) ואז `fail()` (exit 1). **אף נתיב לא משאיר את
   השורה תקועה ב-`'publishing'`.**
7. **נקודת-העצירה** (שורות 1804–1811): אם `!dryRun` → `markFailed('live publishing is not
   implemented in this pass...')` ואז `fail()`. **זה בדיוק מה ש-§4.6 הזה בא להחליף** — לא
   לגעת בכלום לפני שורה זו.
8. Dry-run מצליח: `buildDryRunArtifact` → כתיבת JSON → `UPDATE status='dry_run'`.

**פער-קוד קונקרטי שמצאתי** (רלוונטי ישירות ל-§4.6): המשתנה `imageBuffer` בתוך בלוק חישוב
ה-hash (שורות 1653–1661) הוא **block-scoped** (`let imageBuffer: Buffer` בתוך ה-`if
(imageAbsPath)`) — לא נגיש מחוץ לבלוק. §4.6 (גם להעלאת bucket ל-Instagram, גם למולטיפארט
Facebook) צריך את הבייטים האלה שוב בהמשך. פתרון מינימלי: להרים את ההצהרה החוצה לבלוק
(`let imageBuffer: Buffer | null = null;` לפני ה-`if`) — שינוי בן שורה אחת, לא לוגי. מפורט
ב-§4.7.

### 1.3 מנגנון `--attach` וה-hash-pinning (איפה קבצים נשמרים, איך sha256 נרשם)

- `cmdRequest` (שורות 546–616): `--attach PATH` (חוזר) — מאמת `PATH` תחת
  `<repo>/.fleet-logs/drafts/` (`resolve` + `startsWith(draftsRoot + sep)`, שורות 578–586),
  קורא `statSync`+`readFileSync`, ומאחסן ב-`payload.attachments[]` את
  `{path: <יחסי-ל-repo>, label: basename, mime: <מ-ATTACH_MIME לפי סיומת>, sha256:
  sha256Hex(bytes)}`. **ה-sha256 מחושב כאן, בקוד-שרת מהימן, לא סופק ע"י ה-role** — בדיוק כפי
  שתועד ב-plan §4.5 סעיף 2 ובהערת הראש (שורות 36–42).
- שרת: `src/app/api/admin/fleet-file/route.ts` — `GET` **אדמין-בלבד**
  (`requirePlatformPermission('manage_settings')`), משרת קבצים **רק** מתחת ל-realpath'd
  `.fleet-logs/drafts` (symlink-safe), MIME-allowlist, 25MB cap, `Cache-Control: private,
  no-store`. זהו התקדים הישיר הרלוונטי ל-Option B (§2.3 למטה) — אותו דפוס בדיוק, רק
  ציבורי-לגמרי במקום אדמין-בלבד.
- **קריטי לניתוח-האבטחה**: `.fleet-logs/**` הוא **כתיב** ע"י כל role יצירתי ב-Tier 0 (ה-Edit
  allow-list שלהם מוגבל ל-`.fleet-logs/**`, לא read-only — מאומת ישירות מהערת-הקוד ב-§4.5
  שורות 313–316 של התוכנית המקורית + `resolveFleetLogsPath`'s containment root being
  `.fleet-logs/` generically, not `drafts/` specifically, for the file-flag helpers). זו
  הסיבה שה-hash-pinning קיים מלכתחילה, וזו גם הסיבה המרכזית ש-Option B (§2.3) נפסל — ראו שם.

### 1.4 `fleet_social_posts` — מה כבר קיים בסכימה (מיגרציה חיה, `20260810061515`)

טבלה **כבר יושבת ב-DB החי** (RLS מופעל, ללא policies, `service_role` בלבד, מאומת ישירות
מול הפרויקט החי — §2.4 למטה): `status check (in 'publishing','published','failed','dry_run')`,
`external_post_id text`, `permalink text`, `caption_sha256 text not null`, `image_sha256
text`, `attempt_count int not null default 1`, `error text`, `published_at timestamptz`,
`unique (request_id, platform)`. **פער מרכזי שמצאתי**: `status='published'`,
`external_post_id`, `permalink`, `published_at` **קיימים בסכימה אבל שום נתיב-קוד היום לא
כותב אליהם** — `cmdPublishSocial` תמיד מסתיים ב-`'dry_run'` או `'failed'`. זה **בדיוק** מה
ש-§4.6 (§4 למטה) צריך להשלים.

### 1.5 מסמך התוכנית המקורי — מה כבר הוכרע שם ל-§4.6, ומה עדיין פתוח

קראתי את `plans/fleet-social-publishing-capability-plan.md` במלואו (696 שורות). §4.6 שם
**כבר** כולל ספק טכני מפורט מאוד לקריאות ה-Meta עצמן (endpoints, גוף-בקשה, permissions
מאומתים-חי ב-§0 של אותו מסמך, קוד-שגיאה/timeout, retry-מדורג) — §3 למטה מאמץ את רוב זה
כמעט-כלשונו, עם שינוי אחד מהותי: **§4.6 שם כבר הכריע על bucket ציבורי (`public=true`) עבור
בעיית ה-image hosting של Instagram, כולל SQL מוכן**. המשימה שקיבלתי היא לבחון מחדש את
ההכרעה הזו כחלופה מול לפחות עוד אחת (§2 למטה) — לא לאמץ אותה כמובנת-מאליה. הממצא המרכזי
שלי (§2.4–§2.6): קריאה ישירה של הקוד הקיים (`event-media.ts`, `legal-docs.ts`, ושימוש
ה-signed-URL ב-`/g/[token]`) מגלה **תקדים שכבר עובד בפרודקשן** לבעיה **מבנית-זהה** (לתת
ל-Meta כתובת-URL שהיא יכולה למשוך תמונה ממנה) שהתוכנית המקורית לא בדקה — וזה משנה את
ההמלצה. `unpublish`/מחיקת-Instagram, TikTok, ו-App Review (שלב 0) **לא** נבדקו מחדש כאן —
כבר מנומקים במלואם בתוכנית המקורית ואין להם קשר ישיר ל-§4.6 עצמו.

### 1.6 `src/lib/url.ts` — `getAppOrigin`/`getAppUrl`

נקרא במלואו. רלוונטי רק בעקיפין: מדגים את מדיניות-הפרויקט ל"כתובת מהימנה אחת" (משתנה-סביבה
מוגדר-במפורש, לא Host header) — **אותו עיקרון** יחול על בחירת ה-storage option למטה (כתובת
ה-image_url חייבת לבוא מקוד-שרת מהימן, לא מקלט חיצוני). `getAppUrl`/`getAppOrigin` עצמם
**אינם** בשימוש ישיר ב-§4.6 — Option B (§2.3) היה משתמש בהם לו נבחר, אך הוא לא נבחר (§2.6).

---

## 2. חלופות לאחסון ציבורי של התמונה המאושרת (בעיית `image_url` ל-Instagram)

תזכורת-היקף (מאומתת ב-§0/§4.6 של התוכנית המקורית **ובאימות-חי נוסף שלי, §7 למטה**):
Facebook **לא** צריך תשתית זו כלל — `POST /{page-id}/photos` תומך במולטיפארט ישיר
(§0/§4.6 שם; מאומת שוב היום, §7). **רק Instagram** (`POST /{ig-user-id}/media`, פרמטר
`image_url` **בלבד** — אין multipart ל-endpoint הזה) זקוק לכתובת HTTPS שהתמונה המאושרת
תהיה נגישה בה **ברגע קריאת ה-API**.

### 2.1 מה קיים היום בפרויקט החי (נבדק ישירות, לא הנחה)

```sql
select id, name, public from storage.buckets order by created_at;
```
תוצאה (Supabase MCP, קריאה-בלבד, 2026-08-12): **שלושה buckets, כולם `public: false`**:

| bucket | public | שימוש בקוד |
|---|---|---|
| `id-documents` | false | `src/lib/storage/legal-docs.ts` — PII ברמה-הגבוהה-ביותר, **ללא** policies, signed URL קצר (120s) לביקורת אדמין בלבד |
| `event-media` | false | `src/lib/storage/event-media.ts` — תמונת-הזמנה, **ללא** policies, signed URL (3600s ברירת-מחדל) נמסר ל-Meta (WhatsApp Cloud API, `src/lib/data/outreach.ts:154`) **וגם** מוצג ישירות בדפדפן דרך `<Image src={inviteImageUrl}>` בעמוד ציבורי `/g/[token]` (`signedInviteImageUrl(view.invite_image_path, 600)`) |
| `vox-call-logs` | false | פרטי-שיחה, `false public`, ללא policies |

**אין ולו bucket ציבורי אחד בפרויקט הזה, אף פעם.** כל שלוש המיגרציות שיצרו buckets
(`202606240008_id_documents_bucket.sql`, `20260705120408_event_gift_and_invite_media.sql`,
`20260719104000_voice_ops_dashboard.sql`) כתובות באותה מילה: `public: false`, **ואף אחת
מהן לא יוצרת policy על `storage.objects`** — הדפוס העקבי בכל הקוד הקיים הוא **private +
signed URL בלבד**, לא public+policy.

**ממצא מפתח**: `signedInviteImageUrl` **כבר** פותר בדיוק את אותה בעיה מבנית — "תן ל-Meta
כתובת שהיא יכולה למשוך ממנה תמונה" — עבור WhatsApp Cloud API (`headerImage: {link:
signedUrl}` ב-`resolveTemplateMedia`, `src/lib/data/outreach.ts`). זו לא תבנית-דומה — זו
**אותה** צורת-בעיה (Meta-fetches-a-URL) שכבר רצה בפרודקשן, לא רק ב-WhatsApp אלא **גם**
כתמונה מוצגת ישירות בדפדפן בעמוד-ציבורי (`/g/[token]`), ללא שום policy על `storage.objects`.

### 2.2 אימות-בעלות על `storage.objects` (למה זה משנה להכרעה)

```sql
select tableowner, rowsecurity from pg_tables where schemaname='storage' and tablename='objects';
-- → {tableowner: 'supabase_storage_admin', rowsecurity: true}

select r.rolname from pg_auth_members m
join pg_roles r on r.oid = m.member
join pg_roles g on g.oid = m.roleid
where g.rolname = 'supabase_storage_admin';
-- → 0 שורות: אף role (כולל postgres) אינו חבר ב-supabase_storage_admin

select rolname, rolsuper from pg_roles where rolname in ('postgres','supabase_admin');
-- → postgres: rolsuper=false | supabase_admin: rolsuper=true
```

ב-Postgres רגיל, `CREATE POLICY` על טבלה דורש בעלות-הטבלה או superuser. `postgres` (התפקיד
שמריץ מיגרציות דרך `supabase db push`/Management API — מאומת קודם, ראו זיכרון "Mgmt API
apply + SECDEF") **אינו** בעל `storage.objects` ואינו superuser. **זה לא מוכיח בוודאות
ש-`create policy on storage.objects` ייכשל במיגרציה רגילה** (תיעוד Supabase הרשמי, שנבדק
היום — §7 — מציג `create policy ... on storage.objects` כדפוס תקני ראשון-במעלה בלי לציין
סייג-בעלות; יתכן שהפלטפורמה מעניקה הרשאה ייעודית מעבר למה ש-`pg_auth_members` מראה). זו
**נותרת שאלה פתוחה שדורשת בדיקה חד-פעמית בזמן המימוש** (בדיוק כפי שהתוכנית המקורית כבר
דגלה) — **לא** ניסיתי DDL אמיתי כדי לא להפר את הגבול "אפס כתיבה ל-DB". אבל הממצא הזה
מספיק כדי להעדיף חלופה שכלל **לא תלויה** בתשובה לשאלה הזו — ראו §2.6.

### 2.3 Option B — route ציבורי ייעודי ב-Next.js

תמונה: `GET /api/public/social-assets/[hash]` (או דומה), עם אותו מנגנון-containment בדיוק
כמו `/api/admin/fleet-file` (§1.3 למעלה) אבל **ללא** `requirePlatformPermission` — כל מבקר
יכול לקרוא, בתנאי שהוא יודע את ה-hash. משרת רק attachment של בקשת-פרסום ש-`status='approved'`
(lookup ב-`fleet_requests` לפי hash → request_id → אימות).

**ניתוח ביטחוני**:

| קריטריון | הערכה |
|---|---|
| רק נכס מאושר-בפועל נחשף | כן, אם ה-route בודק `status='approved'`/`published` בכל בקשה — אבל זו בדיקת-DB **בכל GET**, בניגוד ל-signed URL שנחתם **פעם אחת** אחרי כל ארבע בדיקות-הבטיחות |
| אי-אפשרות enumeration | תלוי-hash (64 hex chars, כמו sha256 קיים) — סביר, בדומה ל-Option A |
| immutability מול hash נעוץ | כן — אותו hash שכבר מחושב ונשמר היום |
| PII | אין (תוכן שיווקי) — זהה לשתי החלופות האחרות |
| cache/CDN | route בתוך אפליקציית Next.js הרצה על השרת עצמו — cache התנהגות תלויה בקונפיגורציית Next/nginx, לא Storage-native CDN |
| ניקוי אחרי פרסום | דורש קוד-ניקוי **חדש**, ייעודי — routes אינם "נמחקים", רק ה-lookup יכול להחזיר 404 אחרי סימון-סטטוס, אך **הקובץ עצמו נשאר יושב תחת `.fleet-logs/drafts/` לצמיתות ונגיש דרך אותו route כל עוד ה-lookup לא נחסם** |
| rollback | קל — להסיר את ה-route |

**הפוסל המכריע (לא נפח-קוד)**: `.fleet-logs/**` הוא **כתיב** ע"י כל role יצירתי ב-Tier 0
(§1.3). route ציבורי-ללא-אימות שמשרת קבצים מתוך ספרייה **שסוכנים אוטונומיים יכולים לכתוב
אליה** הוא blast-radius מובנה-גרוע-יותר מ-bucket ש**רק** `cmdPublishSocial` (קוד-שרת מהימן,
לא role) כותב אליו — גם אם ה-lookup עצמו מוגן-hash, משטח-התקיפה הבסיסי (route ציבורי מעל
ספרייה שקלט-לא-מהימן יכול לגעת בה) רחב יותר מ-Option A. שיקול משני: ה-route רץ על אותו
תהליך שמגיש גם routes אדמיניסטרטיביים — נגישות אמיתית של השרת (beta.kalfa.me) לזחלן של
Meta מבחוץ היא **הנחה לא-מאומתת** כאן (זיכרון-פרויקט קיים מזהיר במפורש ש-IONOS חוסם
פורטים לא-ברשימה-לבנה, ו-WebFetch מריץ **מקומית** מהשרת עצמו — לא מוכיח נגישות-חיצונית),
בעוד ש-Supabase Storage **כבר מוכח** נגיש ל-Meta (מסלול ה-WhatsApp החי, §2.1). מסקנה:
Option B נפסל.

### 2.4 Option A (מקורי, כפי שהתוכנית הראשונה כתבה) — bucket ציבורי (`public=true`)

זו ההצעה המקורית ב-§4.6 של התוכנית הראשונה (SQL מלא שם, שורות 390–413): `insert into
storage.buckets (..., public=true, ...)` + `create policy "social_publish_assets_public_read"
on storage.objects for select to public using (bucket_id = '...')`. מחזור-חיים: העלאה **רק**
אחרי שכל ארבע בדיקות-הבטיחות עברו, נתיב-אקראי (`${randomUUID()}.${ext}`, לא שם-קובץ מקורי),
מחיקה מיידית בתום כל ניסיון (הצלחה **או** כישלון) **דרך Storage API בלבד** — ממצא-מחקר-חי
מוצק מהתוכנית המקורית: `trigger` ברמת-statement חוסם `DELETE FROM storage.objects` גולמי
אלא אם `storage.allow_delete_query=true` באותה session, ורק ה-Storage API מגדיר את הדגל הזה
אוטומטית (מאומת מול changelog של `supabase/supabase`, 2026-03-05). **ממצא נוסף שאני מוסיף**:
ה-`create policy ... to public` **מיותר בפועל אפילו בענף הזה** — תיעוד Supabase הרשמי
שאני שלפתי היום (§7) קובע במפורש: *"This is not needed for public buckets, as they are
already publicly accessible"* — כלומר גם אם בוחרים ב-bucket ציבורי, ה-`create policy`
המוצע בתוכנית המקורית **אינו טעון-תפקיד** ורצוי להשמיטו (שורה אחת פחות DDL, פחות תלות
בשאלת-הבעלות ב-§2.2).

**נקודת-החולשה האמיתית של האופציה הזו** (לא "convention" — סיכון קונקרטי): בין רגע ההעלאה
לרגע המחיקה, האובייקט **ציבורי-לגמרי, ברי-הורדה ע"י כל מי שמנחש/סורק את ה-URL** (התגוננות
היחידה היא אקראיות-הנתיב). המנגנון היחיד שסוגר את החלון הוא **קוד אפליקטיבי שרץ בהצלחה**
(`remove()` בתום הקריאה). אם התהליך נהרג בדיוק בין ההעלאה למחיקה (OOM, restart של
`fleet:agent`, קריסת-Node) — **אין רשת-ביטחון מובנית**; התוכנית המקורית עצמה מודה בכך
ומציעה sweep שעתי **עתידי** ב-worker כ"רשת ביטחון" — **לא חלק מ-v1**, כלומר בפועל v1 חשוף
לחלון בלתי-חסום עד שמישהו יבנה את ה-sweep.

### 2.5 Option A′ (מומלץ) — **אותה** תשתית, `public=false` + `createSignedUrl` בזמן-אמת

זו לא חלופה שלישית עצמאית — זו **אותה בדיוק** ארכיטקטורת-bucket כמו §2.4 (אותו נתיב-אקראי,
אותה תזמון-העלאה-אך-ורק-אחרי-4-בדיקות, אותה מחיקה-בתום-כל-ניסיון דרך Storage API), עם **שני
שינויים בלבד**:

1. `public: false` (במקום `true`) — **אין** צורך ב-`create policy` כלל (אין SELECT ציבורי
   לחסום/להתיר — התלות בשאלת-הבעלות מ-§2.2 **נעלמת לגמרי**).
2. במקום `getPublicUrl()`, `cmdPublishSocial` קורא ל-`admin.storage.from('social-publish-
   assets').createSignedUrl(path, ttlSeconds)` — **אותה קריאה בדיוק** שכבר קיימת ב-
   `event-media.ts`/`legal-docs.ts` ורצה בפרודקשן היום (§2.1) — ומעבירה את ה-URL החתום
   כ-`image_url` ל-`POST /{ig-user-id}/media`.

**למה זה עדיף — הטיעון שלא תלוי בשום דבר לא-מאומת** (בניגוד ל"מוסכמה" בלבד): ל-URL חתום
יש **TTL מובנה**. גם אם התהליך נהרג בין ההעלאה למחיקה, ה-URL **פג מעצמו** תוך דקות
(מציע: TTL קצר מעט מעל חלון ה-poll הריאלי — הפוֹלינג ב-§4.6/§0 של התוכנית המקורית "כמה
שניות עד ~מספר עשרות שניות"; `600` שניות, **אותו ערך בדיוק** שכבר בשימוש ב-`/g/[token]`
עבור אותו סוג-תוכן, נותן שוליים גדולים בלי חשיפה ממושכת) — **ללא תלות בקוד-ניקוי שמצליח
לרוץ**. זה backstop **שני, עצמאי**, שלא קיים כלל באופציה §2.4: שם ה-sweep השעתי-העתידי הוא
ה-backstop **היחיד**, ואינו חלק מ-v1. כאן ה-TTL **הוא עצמו** ה-backstop, קיים מהיום הראשון,
בלי קוד נוסף. מחיקה-בתום-הקריאה (מ-§2.4) **נשארת** כמנגנון הראשי/מהיר — התוספת היא רק
רשת-ביטחון-שנייה חינמית.

תועלות משניות: (א) עקביות-מוחלטת עם שלושת ה-buckets הקיימים (`public: false` בכולם —
Option A′ הוא הראשון-שכבר-קיים-בקוד, לא תקדים חדש); (ב) פותר את שאלת-הבעלות ב-§2.2 —
אין policy, אין תלות בתשובה; (ג) אין enumeration אפשרי בעיקרון — לא רק "לא מעשי" (URL חתום
דורש טוקן-חתימה תקף, לא רק ניחוש-נתיב).

**הסיכון היחיד שהאופציה הזו מוסיפה** (ולכן, לא נטען שהיא חינמית): לא אומת-אמפירית שה-fetcher
של Meta ב-`POST /{ig-user-id}/media` **מקבל** URL עם query-string (טוקן-חתימה) כ-`image_url`
— תיעוד Meta הרשמי (§7 למטה, נבדק היום) אומר רק "publicly accessible", בלי להתייחס
במפורש ל-URLs חתומים. **זו בדיוק הסיבה שהמלצה זו כוללת מבחן מבחין ממוקד לפני שכל קוד
תלוי בה — ראו §2.7.**

### 2.6 טבלת השוואה + המלצה

| קריטריון | A (public bucket) | **A′ (private + signed URL) — מומלץ** | B (route ציבורי) |
|---|---|---|---|
| רק נכס מאושר נחשף | כן (העלאה רק אחרי 4 בדיקות) | כן (זהה) | כן, אך תלוי ב-lookup-status שרץ בכל בקשה |
| אי-אפשרות enumeration | נתיב-אקראי בלבד | נתיב-אקראי **+** טוקן-חתימה | hash בלבד |
| immutability | כן | כן | כן |
| PII | אין (תוכן שיווקי) | אין | אין |
| cache/CDN | Supabase Storage CDN | Supabase Storage CDN | תלוי-קונפיגורציית Next/nginx |
| ניקוי אחרי פרסום | `remove()` מיידי; sweep-עתידי **לא-חלק-מ-v1** | `remove()` מיידי **+ TTL עצמאי מהיום הראשון** | קוד-ניקוי חדש נדרש; קובץ המקור נשאר לצמיתות תחת `.fleet-logs/` |
| rollback | הופך bucket ל-private | (כבר private) | הסרת route |
| תלות בשאלת-בעלות `storage.objects` (§2.2) | **כן** (גם אם ה-policy מיותר בפועל, ה-bucket-flag `public=true` עדיין תלוי בזכות ליצור/לשנות bucket — קיימת בכל מקרה דרך ה-Storage API, ראו §2.7) | **לא** | לא רלוונטי |
| עקביות עם כל ה-buckets הקיימים | ראשון-מסוגו (חריגה) | תואם 3/3 buckets קיימים | לא רלוונטי (לא bucket) |
| blast radius בסיסי | Storage בלבד, קוד-שרת-מהימן כותב | זהה ל-A | חשיפה מעל ספרייה **כתיבה-ע"י-role** (§2.3) |
| מוכח-עובד היום בפרודקשן לבעיה מבנית זהה | לא | **כן** (WhatsApp media header + `/g/[token]`) | לא |

**המלצה**: **A′ — bucket פרטי (`public: false`) + `createSignedUrl` בזמן-אמת**, עם נפילה
מוגדרת-מראש (לא "לחשוב מחדש מאפס") ל-Option A אם המבחן המבחין ב-§2.7 מגלה ש-Meta דוחה URL
חתום: `update storage.buckets set public = true where id = 'social-publish-assets'` +
החלפת `createSignedUrl(...)` ב-`getPublicUrl(...)` בקוד — **שינוי-שורה-אחת בכל צד**, לא
בנייה-מחדש, ולא צריך policy נוסף גם בענף הנפילה (§2.4 מעל). Option B נפסל (§2.3). ההכרעה
הסופית עדיין נתונה לבעלים — זו המלצה מנומקת, לא ביצוע.

### 2.7 המבחן המבחין (Gate ל-שלב 6 ב-§7 של התוכנית המקורית) — **לפני** שקוד תלוי בתשובה

בדיוק בגלל שהתשובה ל"האם Meta מקבלת URL חתום" לא ידועה מהתיעוד, ואי-אפשר לבדוק אותה בלי
טוקן אמיתי (שלא קיים לי, ושלב 0 של התוכנית המקורית עוד לא הושלם) — הבדיקה **עצמה** יכולה
להיות זולה-ובטוחה-לגמרי: `POST /{ig-user-id}/media` **יוצר container בלבד ולא מפרסם שום
דבר** — הפרסום קורה רק ב-`media_publish` הנפרד. כלומר אפשר לבדוק שהמשיכה-בפועל של Meta
מצליחה **בלי לפרסם דבר לעולם**:

1. להעלות תמונת-בדיקה חד-פעמית (לא-תוכן-שיווקי אמיתי) ל-bucket הפרטי, לחתום URL (`600s`).
2. `POST /{ig-user-id}/media` עם ה-URL החתום.
3. `GET /{container-id}?fields=status_code` עד `FINISHED` (או `ERROR`).
4. **לעולם לא לקרוא ל-`media_publish`** — משאירים את ה-container ללא-פרסום; קונטיינרים
   שלא פורסמו פגי-תוקף אחרי זמן-מה (ה-TTL המדויק **לא** אומת כאן — לבדוק בזמן המימוש, לא
   קריטי לתוצאת-המבחן עצמה).
5. תוצאה: `status_code=FINISHED` ⇒ Meta **כן** קראה בהצלחה URL חתום ⇒ A′ מאושר כפי שהוא.
   `status_code=ERROR` (או timeout על ה-fetch) ⇒ נפילה מתועדת ל-Option A (§2.6).

מבחן זה **תלוי בשלב 0** (טוקן חי, App Review) בדיוק כמו כל שלב-live אחר — אינו ניתן לביצוע
היום. הוא **חייב** להירשם כתנאי-סף מפורש לשלב 6 (Instagram) ב-§7 של התוכנית המקורית, **לפני**
שהמיגרציה/הקוד של §4 למטה נחתמים כ"סופיים" — לא כחלק מהעבודה הנוכחית.

---

## 3. תוכנית מימוש §4.6 — פירוט

הבילדרים הטהורים ב-`publish-social.ts` (§1.1) **אינם** משתנים במהותם — §4.7 למטה מפרט את
**התוספת האדיטיבית היחידה** שנדרשת (פרמטר אופציונלי חדש). כל שאר §4.6 הוא קוד **חדש**:
פונקציות-עזר טהורות-נוספות ב-`publish-social.ts` (לבדיקה בלי רשת), וה-orchestration בתוך
`cmdPublishSocial` עצמו ב-`fleet-agent-cli.ts` — בדיוק כפי שהתוכנית המקורית קבעה
(§4.2: "נקודת-הטעינה היחידה [לקרדנציאלים] היא בתוך ה-handler של הפקודה עצמה").

### 3.1 קרדנציאלים — טעינה בתוך `cmdPublishSocial` בלבד

אותם 4 שמות שכבר מוגדרים ב-§4.2 של התוכנית המקורית (**ולא** שונו כאן):
`META_PAGE_ACCESS_TOKEN`, `META_FACEBOOK_PAGE_ID`, `META_INSTAGRAM_BUSINESS_ACCOUNT_ID`,
`META_APP_ID`/`META_APP_SECRET` (לא נחוצים לקריאות-פרסום עצמן). **דפוס-כשל**: היעדר-קרדנציאל
הוא `fail()` רגיל (exit 1), **לא** exit-0-שקט כמו `getGa4ConfigStatus` — התוכנית המקורית
כבר מנמקת זאת מפורשות (§4.2: "לא תוצאה שפירה; זו פעולה מאושרת שלא בוצעה").

**ערך ידוע (נמסר ע"י הבעלים בצ'אט, 2026-08-12): `META_APP_ID=2814488668918329`** —
מזהה-אפליקציה הוא מזהה פומבי (לא סוד; מותר בתיעוד). `META_APP_SECRET`, הטוקן, ושני
מזהי העמוד/חשבון נשארים באחריות הבעלים בלבד, מוזנים ישירות ל-env בשרת (לא דרך סוכן).

### 3.2 Facebook — `/feed` (טקסט) ו-`/photos` (מולטיפארט)

מאומת-חי היום (§7): `pages_manage_posts`+`pages_read_engagement`+`pages_show_list`;
`/photos` תומך גם ב-`url` וגם במולטיפארט (`source` — שם היסטורי, לא-קשיח), ומחזיר
`{id, post_id}` (`post_id` הוא מזהה-הפוסט בעמוד, מקביל ל-`id` של `/feed`) — **פרט חדש
שהתוכנית המקורית לא פירטה, ונדרש כדי לדעת מה לשמור כ-`external_post_id`**.

### 3.3 Instagram — תלת-שלבי + פתרון ה-image hosting

`create_container` (עם `image_url` **חתום**, Option A′) → `poll_status` (bounded, לא
אינסופי) → `publish`. `permalink` דורש קריאה נוספת: `GET /{ig-media-id}?fields=permalink`
(כבר מתועד בתוכנית המקורית §4.6).

### 3.4 טיפול-שגיאות Graph API — מאומת-חי היום (לא מזיכרון)

צורת-שגיאה רשמית (§7): `{ error: { message, type, code, error_subcode, error_user_title,
error_user_msg, fbtrace_id } }`. קודים רלוונטיים (מאומת-חי + השלמת-חיפוש, לסמן
"לאמת-נקודתית-בזמן-המימוש" את הרשימה המלאה): `190` (טוקן פג/לא-תקף — permanent, subcodes
`463`/`467`) הוא **auth**; `4`, `17`, `32`, `341`, `368`, `613` הם **rate-limit/transient**
(Meta ממליצה "המתן ונסה שוב"); כל שאר-קוד-מסופק הוא **declined** (לא-לזיהוי-אוטומטי, כמו
"מוסכם"); ללא-body-פרסה-בכלל הוא **unknown**. הסיווג הזה **אינו** קובע retry-בפועל — הוא
רק תיוג-לצורך `error` בledger ולצורך log ברור; ה-retry עצמו נשאר גבולי-ע"י-ceiling (§3.6).

### 3.5 עדכון ה-ledger בהצלחה — הפער שזיהיתי ב-§1.4

מוסיף מיד לפני ה-`console.log` הסופי (מקום ה-`if (!dryRun)` הקיים היום, שורות 1806–1811):
`UPDATE fleet_social_posts SET status='published', external_post_id=<id>, permalink=<url|null>,
published_at=now(), error=null WHERE id=postRow.id`. **מקרה-קצה חדש שזיהיתי, לא מתועד
בתוכנית המקורית**: אם ה-`UPDATE` הזה עצמו נכשל (רשת/DB) **אחרי** ש-Meta כבר פרסמה בהצלחה —
זה **לא** מצב "פרסום נכשל" (הפוסט **כבר** בחוץ, ציבורי, עם `external_post_id` אמיתי) —
`fail()` הרגיל כאן היה מטעה (היה כותב ל-STDOUT/exit-1 "נכשל" בעוד שבפועל התפרסם). הודעת-
השגיאה במקרה הזה חייבת לכלול את ה-`external_post_id`/`permalink` בפירוש ולציין שנדרש תיקון-
ידני ל-ledger — לא "retry" רגיל (retry היה יוצר פוסט **כפול**).

### 3.6 תקרת-retry (`attempt_count >= 2`) — הפער השני שזיהיתי

`decideExistingRow` (§1.1) **מתעלם לגמרי** מ-`attempt_count` — התוכנית המקורית מתארת את
תקרת-הretry (§4.4) כהתנהגות **של social-manager** ("לא מנסה שוב אוטומטית"), אבל
social-manager **אין לו גישת-SQL** ל-`fleet_social_posts` (מאומת, §3 סעיף 9 בתוכנית
המקורית) — כלומר אין לו דרך לדעת בעצמו כמה ניסיונות כבר נכשלו, אלא אם `publish-social`
**עצמו** אוכף/מדווח את זה. בלי אכיפה קוד-רמה כאן, `poll` שבועי חוזר יכול תיאורטית לנסות
לפרסם את אותה בקשה ל-Meta **ללא הגבלה** לאורך שבועות — בדיוק הסיכון שה-§6 של התוכנית
המקורית מזהיר ממנו (חסימת-חשבון, spam-על-כשל-חוזר). **הפתרון**: אכיפה מכנית **בתוך
`cmdPublishSocial`** בנקודת ה-CAS-retry-claim הקיימת (שורות 1715–1724) — **לא** להסתמך
רק על שיפוט-ה-role. פירוט מלא + קוד ב-§4.5.

### 3.7 שינוי אדיטיבי בלבד לבילדר (`buildInstagramPublishPlan`)

`buildInstagramPublishPlan(caption: string)` היום בונה `image_url: null` **קבוע** — אבל
המסלול-החי צריך URL אמיתי. הפתרון **הכי-קטן**: פרמטר-שני **אופציונלי** עם ברירת-מחדל
`null` — `buildInstagramPublishPlan(caption: string, imageUrl: string | null = null)`.
כל הקריאות הקיימות (כולל `buildDryRunArtifact`, שנשאר **ללא כל שינוי** — הוא אף פעם לא
פותר URL אמיתי, גם ב-dry-run) וכל 271 שורות הטסט הקיים **ממשיכים לעבוד בלי שינוי** —
`buildInstagramPublishPlan('מזל טוב!')` עדיין מחזיר `image_url: null` בדיוק כמו היום.
המסלול-החי (חדש, לא-קיים-היום) קורא ל-`buildInstagramPublishPlan(caption, signedUrl)`
**ישירות** מתוך `cmdPublishSocial`, **לא** דרך `buildDryRunArtifact`.

---

## 4. קוד מוכן-להעתקה

**הכל להלן הצעה בלבד — שום קובץ לא נערך.** מספרי-שורות מתייחסים למצב הקוד כפי שנקרא
ב-2026-08-12; לאמת מחדש לפני החלה בפועל (קוד עשוי להשתנות בין עכשיו לשלב-המימוש המאושר).

### 4.1 `src/lib/fleet/publish-social.ts` — תוספות (לא שינוי לפונקציות קיימות מלבד סעיף א׳)

**א. שינוי אדיטיבי יחיד לפונקציה קיימת** (§3.7 — פרמטר חדש עם ברירת-מחדל, 100% תואם-לאחור):

```typescript
export function buildInstagramPublishPlan(
  caption: string,
  imageUrl: string | null = null,
): InstagramPublishPlan {
  return {
    steps: [
      {
        step: 'create_container',
        method: 'POST',
        endpoint: 'https://graph.facebook.com/v26.0/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media',
        body: {
          image_url: imageUrl,
          caption,
          note: imageUrl
            ? 'image_url is a short-lived Supabase Storage signed URL (plan §2.5/§4.6, social-publish-assets bucket, private)'
            : 'image_url requires the social-publish-assets bucket (plan §4.6, §7 stage 6) — not yet migrated',
        },
      },
      {
        step: 'poll_status',
        method: 'GET',
        endpoint: 'https://graph.facebook.com/v26.0/{container-id}?fields=status_code',
        note: 'poll until status_code=FINISHED',
      },
      {
        step: 'publish',
        method: 'POST',
        endpoint: 'https://graph.facebook.com/v26.0/{META_INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish',
        body: { creation_id: '{container-id}' },
      },
    ],
  };
}
```

**ב. פונקציות-עזר טהורות חדשות** (להוסיף בסוף הקובץ, אחרי `buildDryRunArtifact` — אין
תלות ב-network/DB, נבדקות ישירות ב-unit tests, §5):

```typescript
// Meta Graph API error shape — verified live 2026-08-12 against TWO
// independent sources (ctx7 `/websites/developers_facebook_graph-api` docs
// command AND a direct WebFetch of developers.facebook.com/docs/graph-api/
// guides/error-handling/ — both returned the identical shape):
// { error: { message, type, code, error_subcode, error_user_title,
// error_user_msg, fbtrace_id } }. Classifies for LOGGING/audit only — this
// does NOT decide whether to retry (that stays attempt-count-gated in
// cmdPublishSocial, see isRetryCeilingReached below and plan §4.4).
export type GraphApiErrorKind = 'rate_limit' | 'auth' | 'declined' | 'unknown';

// Rate-limit family, verified-live 2026-08-12:
//   4, 17, 341, 368, 506 — developers.facebook.com/docs/graph-api/guides/
//     error-handling/ (WebFetch), Meta's own "transient, wait and retry" list.
//   32 AND 80001 — ctx7 docs on /websites/developers_facebook_graph-api,
//     Source: developers.facebook.com/docs/graph-api/overview/rate-limiting —
//     32 = "Page calls (User access token) limit reached"; 80001 = "Page
//     calls (Page/System User token) limit reached" — the LATTER is the one
//     directly relevant here, since publish-social always uses a Page access
//     token (plan §3.1/§4.2), never a user token. 80000/80004 (Ads
//     Insights/Management BUC limits) are documented alongside 80001 but are
//     out of scope — this flow never calls Ads endpoints.
//   613 — community cross-check only (not independently confirmed by ctx7 or
//     a direct WebFetch in this pass) — RE-VERIFY at implementation, kept
//     here as a plausible-but-unconfirmed entry, not asserted as fact.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 80001, 341, 368, 506, 613]);
// 190 (OAuthException, "access token has expired") — WebFetch + ctx7, both
// 2026-08-12. 102 ("API Session" — invalid/expired token or login status) —
// ctx7 only (Source: developers.facebook.com/docs/graph-api/guides/
// error-handling/), not independently cross-checked via WebFetch in this
// pass; kept as a second auth code since ctx7 quotes it from the same
// official page as 190.
const AUTH_ERROR_CODES = new Set([190, 102]);

export interface GraphApiErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export function classifyGraphApiError(body: GraphApiErrorBody | null): GraphApiErrorKind {
  const code = body?.error?.code;
  if (typeof code === 'number' && AUTH_ERROR_CODES.has(code)) return 'auth';
  if (typeof code === 'number' && RATE_LIMIT_CODES.has(code)) return 'rate_limit';
  if (body?.error) return 'declined';
  return 'unknown';
}

export function formatGraphApiError(body: GraphApiErrorBody | null, httpStatus: number): string {
  const err = body?.error;
  if (!err) return `Meta Graph API returned HTTP ${httpStatus} with no parseable error body`;
  const parts = [`code=${err.code ?? '?'}`];
  if (err.error_subcode) parts.push(`subcode=${err.error_subcode}`);
  if (err.type) parts.push(`type=${err.type}`);
  if (err.fbtrace_id) parts.push(`fbtrace_id=${err.fbtrace_id}`);
  return `Meta Graph API error [${classifyGraphApiError(body)}] (HTTP ${httpStatus}): ${err.message ?? 'no message'} [${parts.join(' ')}]`;
}

// Instagram container status polling (plan §4.6 step 2) — BOUNDED, never an
// infinite loop. Pure decision function: given the status_code Meta returned
// and how many polls have already happened, decide the next action. The
// actual wait/sleep loop lives in cmdPublishSocial (needs real timers); this
// stays testable without them.
export type ContainerPollDecision =
  | { action: 'publish' }
  | { action: 'wait' }
  | { action: 'fail'; reason: string };

// ~10 polls * 3s spacing = ~30s bounded wait, matching plan §4.6/§0's own
// estimate ("כמה שניות עד ~מספר עשרות שניות"). Tune at implementation if
// empirical FINISHED latency differs.
export const IG_CONTAINER_POLL_MAX_ATTEMPTS = 10;

export function decideContainerPoll(
  statusCode: string,
  attemptsSoFar: number,
): ContainerPollDecision {
  if (statusCode === 'FINISHED') return { action: 'publish' };
  if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
    return { action: 'fail', reason: `Instagram container status_code=${statusCode}` };
  }
  if (attemptsSoFar >= IG_CONTAINER_POLL_MAX_ATTEMPTS) {
    return {
      action: 'fail',
      reason: `Instagram container did not reach FINISHED within ${IG_CONTAINER_POLL_MAX_ATTEMPTS} polls (last status_code=${statusCode})`,
    };
  }
  return { action: 'wait' };
}

// §4.4 retry ceiling (plan §4.4, "תקרת-retry"): after PUBLISH_RETRY_CEILING
// failed attempts, cmdPublishSocial refuses to re-claim the row for another
// live attempt — social-manager has no direct SQL access to
// fleet_social_posts (plan §3 point 9), so it cannot know attempt_count
// itself unless publish-social enforces (not just reports) this.
export const PUBLISH_RETRY_CEILING = 2;

export function isRetryCeilingReached(attemptCount: number): boolean {
  return attemptCount >= PUBLISH_RETRY_CEILING;
}
```

### 4.2 מיגרציה מוצעת — bucket פרטי (Option A′, §2.5) **ללא** policy

**להריץ `supabase migration new social_publish_assets_bucket` בזמן המימוש** כדי לקבל
timestamp אמיתי — לא להמציא שם-קובץ ידנית. תוכן מוצע:

```sql
-- Private storage bucket for the SHORT-LIVED, hash-pinned marketing image
-- publish-social signs a URL for at Instagram publish time only (plan
-- social-publish-live-stage-plan.md §2.5 — Option A', supersedes the
-- public=true design in fleet-social-publishing-capability-plan.md §4.6).
--
-- public: false — same posture as event-media/id-documents/vox-call-logs
-- (ALL THREE existing buckets in this project are private; this is the
-- first, not an exception). No storage.objects RLS policy is created: only
-- service_role (used exclusively inside cmdPublishSocial) ever reads or
-- writes here — same "zero policies, service_role only" pattern as every
-- other bucket. image_url is resolved via a short-lived createSignedUrl()
-- call, never getPublicUrl().
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-publish-assets',
  'social-publish-assets',
  false,
  10485760, -- 10MB — one post image, not a whole batch
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;
```

**Fallback documented, not applied**: if §2.7's discriminating test shows Meta's fetcher
rejects a signed (query-string-token) URL, the one-line fix is
`update storage.buckets set public = true where id = 'social-publish-assets';` — still
**no** `create policy` needed even then (Supabase's own docs, quoted in §7: public buckets
"are already publicly accessible" without one) — and swap `createSignedUrl(...)` for
`getPublicUrl(...)` at the one call site in §4.3 below.

### 4.3 `scripts/fleet-agent-cli.ts` — תוספת אכיפת תקרת-retry (§3.6)

**מיקום**: מיד אחרי `const decision = decideExistingRow(existing.status);` הקיים (שורה
~1692), **לפני** ה-`if (decision === 'noop')` הקיים. Import חדש: `isRetryCeilingReached,
PUBLISH_RETRY_CEILING` מ-`@/lib/fleet/publish-social` (מתווסף לרשימת ה-import הקיימת
בראש הקובץ).

```typescript
    const decision = decideExistingRow(existing.status);

    // §4.4 retry ceiling (plan social-publish-live-stage-plan.md §3.6): a row
    // that has already failed PUBLISH_RETRY_CEILING times is NOT re-claimed
    // for another automatic live attempt. social-manager cannot see
    // attempt_count itself (no sql access to this table) — this is the
    // code-level backstop, not just a prompt instruction (see
    // .claude/fleet/roles/social-manager.md §5 addition, not applied here).
    if (decision === 'retry' && isRetryCeilingReached(existing.attempt_count)) {
      const reason = `retry ceiling reached (attempt_count=${existing.attempt_count} >= ${PUBLISH_RETRY_CEILING}) — publish-social will not retry automatically; the caller must escalate via --kind question, not retry`;
      console.log(
        JSON.stringify(
          {
            published: false,
            outcome: 'retry_ceiling_reached',
            reason,
            platform,
            requestId,
            request: existing,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    if (decision === 'noop') {
```

### 4.4 `scripts/fleet-agent-cli.ts` — הרמת `imageBuffer` מחוץ ל-block (§1.2)

**שינוי-שורה-אחת** בבלוק החישוב הקיים (שורות ~1652–1661) — מעבירים את ה-`let imageBuffer`
מחוץ ל-`if`, כדי שיהיה נגיש למסלול-החי בהמשך:

```typescript
  let imageBuffer: Buffer | null = null;
  let imageSha256: string | null = null;
  if (imageAbsPath) {
    try {
      imageBuffer = readFileSync(imageAbsPath);
    } catch {
      return fail(`--image-path not found: ${imagePathRaw}`);
    }
    imageSha256 = sha256Hex(imageBuffer);
  }
```

### 4.5 `scripts/fleet-agent-cli.ts` — פונקציות-עזר חדשות למסלול-החי

**להוסיף מיד לפני `async function cmdPublishSocial`** (אחרי ההערה `// ── publish-social
──` הקיימת, שורה ~1592). Imports נוספים נדרשים: `classifyGraphApiError, formatGraphApiError,
decideContainerPoll, IG_CONTAINER_POLL_MAX_ATTEMPTS` מ-`@/lib/fleet/publish-social`.

```typescript
const GRAPH_API_BASE = 'https://graph.facebook.com/v26.0';

async function graphApiJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function publishFacebookFeed(
  token: string,
  pageId: string,
  caption: string,
): Promise<{ externalPostId: string; permalink: string | null }> {
  const res = await fetch(`${GRAPH_API_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: caption, access_token: token }),
  });
  const json = await graphApiJson(res);
  if (!res.ok) throw new Error(formatGraphApiError(json as GraphApiErrorBody, res.status));
  const id = (json as { id?: string } | null)?.id;
  if (!id) throw new Error('Meta Graph API returned 2xx from /feed with no post id');
  const permalink = await fetchFacebookPermalink(token, id);
  return { externalPostId: id, permalink };
}

async function publishFacebookPhoto(
  token: string,
  pageId: string,
  caption: string,
  imageBytes: Buffer,
  mime: string,
): Promise<{ externalPostId: string; permalink: string | null }> {
  const form = new FormData();
  form.set('message', caption);
  form.set('access_token', token);
  // Field name 'source' is historical convention, not a hard requirement
  // (verified live 2026-08-12 — see plan §7); confirm at implementation.
  form.set('source', new Blob([imageBytes], { type: mime }), 'image');
  const res = await fetch(`${GRAPH_API_BASE}/${pageId}/photos`, { method: 'POST', body: form });
  const json = await graphApiJson(res);
  if (!res.ok) throw new Error(formatGraphApiError(json as GraphApiErrorBody, res.status));
  // /photos returns {id, post_id} — post_id is the page-post id, analogous
  // to /feed's "id" (verified live 2026-08-12, plan §7). "id" alone is the
  // photo object's own id, not the post.
  const postId = (json as { post_id?: string } | null)?.post_id;
  if (!postId) throw new Error('Meta Graph API returned 2xx from /photos with no post_id');
  const permalink = await fetchFacebookPermalink(token, postId);
  return { externalPostId: postId, permalink };
}

async function fetchFacebookPermalink(token: string, postId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${postId}?fields=permalink_url&access_token=${encodeURIComponent(token)}`,
    );
    const json = await graphApiJson(res);
    if (!res.ok) return null;
    return (json as { permalink_url?: string } | null)?.permalink_url ?? null;
  } catch {
    // Permalink is nice-to-have, not required for the ledger to record a
    // real, successful publish — never fail the whole call over it.
    return null;
  }
}

// Instagram: 3-step container flow (plan §4.6/§0). imageUrl MUST already be
// resolved (signed or public URL, §2.5/§2.6) before this is called.
async function publishInstagram(
  token: string,
  igUserId: string,
  caption: string,
  imageUrl: string,
): Promise<string> {
  const createRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const createJson = await graphApiJson(createRes);
  if (!createRes.ok) {
    throw new Error(formatGraphApiError(createJson as GraphApiErrorBody, createRes.status));
  }
  const containerId = (createJson as { id?: string } | null)?.id;
  if (!containerId) throw new Error('Meta Graph API returned 2xx from /media with no container id');

  for (let attempt = 0; ; attempt += 1) {
    const pollRes = await fetch(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const pollJson = await graphApiJson(pollRes);
    if (!pollRes.ok) {
      throw new Error(formatGraphApiError(pollJson as GraphApiErrorBody, pollRes.status));
    }
    const statusCode = (pollJson as { status_code?: string } | null)?.status_code ?? 'UNKNOWN';
    const decision = decideContainerPoll(statusCode, attempt);
    if (decision.action === 'fail') throw new Error(decision.reason);
    if (decision.action === 'publish') break;
    // decision.action === 'wait'
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const publishJson = await graphApiJson(publishRes);
  if (!publishRes.ok) {
    throw new Error(formatGraphApiError(publishJson as GraphApiErrorBody, publishRes.status));
  }
  const mediaId = (publishJson as { id?: string } | null)?.id;
  if (!mediaId) throw new Error('Meta Graph API returned 2xx from /media_publish with no media id');
  return mediaId;
}

async function fetchInstagramPermalink(token: string, mediaId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
    );
    const json = await graphApiJson(res);
    if (!res.ok) return null;
    return (json as { permalink?: string } | null)?.permalink ?? null;
  } catch {
    return null;
  }
}

// Option A' (plan §2.5): sign a short-lived URL from the PRIVATE
// social-publish-assets bucket. Upload happens here too — deliberately AFTER
// all four safety checks (caller-enforced, see cmdPublishSocial below), never
// speculatively. Object path is random (crypto.randomUUID, not the original
// filename or any batch/event-identifying string) — the plan's own
// requirement (fleet-social-publishing-capability-plan.md §4.6 point 2).
async function resolveInstagramImageUrl(
  admin: ReturnType<typeof createAdminClient>,
  imageBytes: Buffer,
  mime: string,
): Promise<{ url: string; objectPath: string }> {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const objectPath = `${randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from('social-publish-assets')
    .upload(objectPath, imageBytes, { contentType: mime });
  if (uploadError) throw new Error(`social-publish-assets upload failed: ${uploadError.message}`);

  const { data, error: signError } = await admin.storage
    .from('social-publish-assets')
    .createSignedUrl(objectPath, 600); // 600s — same TTL already used for
    // invite-image signed URLs (event-media.ts, /g/[token]); comfortably
    // above the bounded poll window (~30s, IG_CONTAINER_POLL_MAX_ATTEMPTS).
  if (signError || !data) {
    await admin.storage.from('social-publish-assets').remove([objectPath]);
    throw new Error(`social-publish-assets signing failed: ${signError?.message ?? 'no data'}`);
  }
  return { url: data.signedUrl, objectPath };
}

// Cleanup MUST go through the Storage API, never raw SQL — a statement-level
// trigger blocks direct DELETE on storage schema tables unless
// storage.allow_delete_query=true in-session, and only the Storage API sets
// that flag automatically (verified live by the base plan, 2026-03-05
// supabase/supabase changelog — carried forward here unchanged).
async function cleanupInstagramImage(
  admin: ReturnType<typeof createAdminClient>,
  objectPath: string,
): Promise<void> {
  const { error } = await admin.storage.from('social-publish-assets').remove([objectPath]);
  if (error) {
    console.error(`[fleet-agent] publish-social: social-publish-assets cleanup failed for ${objectPath}: ${error.message}`);
  }
}
```

### 4.6 `scripts/fleet-agent-cli.ts` — החלפת נקודת-העצירה (§4.6 בפועל)

מחליף את הבלוק הקיים כולו משורה `// All four safety checks passed...` (~1804) עד סוף
`cmdPublishSocial` (~1841):

```typescript
  // All four safety checks passed.
  if (dryRun) {
    const artifact = buildDryRunArtifact(platform, captionText, imageAttachment ? imageAttachment.path : null);
    const artifactRelPath = deriveDryRunArtifactPath(captionAttachment.path, platform);
    const artifactAbsPath = resolveFleetLogsPath(artifactRelPath, 'dry-run-artifact');
    writeFileSync(artifactAbsPath, JSON.stringify(artifact, null, 2), 'utf8');

    const { data: updated, error: updateError } = await admin
      .from('fleet_social_posts')
      .update({ status: 'dry_run', error: null })
      .eq('id', postRow.id)
      .select()
      .single();
    if (updateError) fail(`publish-social: ledger update to dry_run failed: ${updateError.message}`);

    console.log(
      JSON.stringify(
        { published: false, dryRun: true, outcome: 'dry_run', platform, requestId, artifactPath: artifactRelPath, request: updated },
        null,
        2,
      ),
    );
    return;
  }

  // ── LIVE PATH (plan social-publish-live-stage-plan.md §3-§4) ─────────────
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  const facebookPageId = process.env.META_FACEBOOK_PAGE_ID?.trim();
  const instagramBusinessAccountId = process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
  const missingCred =
    !pageAccessToken || !facebookPageId || (platform === 'instagram' && !instagramBusinessAccountId);
  if (missingCred) {
    // NOT a silent exit 0 — an approved publish request that cannot run for
    // lack of credentials is a real failure, not a benign "not configured"
    // state (plan §4.2 explicitly contrasts this with getGa4ConfigStatus).
    const reason = 'not_configured: missing META_PAGE_ACCESS_TOKEN/META_FACEBOOK_PAGE_ID' +
      (platform === 'instagram' ? '/META_INSTAGRAM_BUSINESS_ACCOUNT_ID' : '');
    await markFailed(reason);
    fail(`publish-social: ${reason}`);
  }

  let externalPostId: string;
  let permalink: string | null = null;
  let igObjectPath: string | null = null;

  try {
    if (platform === 'facebook') {
      const result = imageAttachment && imageBuffer
        ? await publishFacebookPhoto(pageAccessToken!, facebookPageId!, captionText, imageBuffer, imageAttachment.mime)
        : await publishFacebookFeed(pageAccessToken!, facebookPageId!, captionText);
      externalPostId = result.externalPostId;
      permalink = result.permalink;
    } else {
      // Instagram always has an image here — validatePlatformImageRequirement
      // already enforced this before any of the four safety checks ran.
      if (!imageBuffer || !imageAttachment) fail('publish-social: internal error — instagram reached the live path without an image');
      const { url, objectPath } = await resolveInstagramImageUrl(admin, imageBuffer, imageAttachment.mime);
      igObjectPath = objectPath;
      externalPostId = await publishInstagram(pageAccessToken!, instagramBusinessAccountId!, captionText, url);
      permalink = await fetchInstagramPermalink(pageAccessToken!, externalPostId);
    }
  } catch (err) {
    if (igObjectPath) await cleanupInstagramImage(admin, igObjectPath);
    const reason = err instanceof Error ? err.message : 'unknown error calling Meta Graph API';
    await markFailed(reason);
    fail(`publish-social: ${reason}`);
  }

  // Success path: clean up the Instagram staging object BEFORE the final
  // ledger write (a signed URL also self-expires — §2.5 — but the primary
  // mechanism stays "delete on terminal state", not "wait for TTL").
  if (igObjectPath) await cleanupInstagramImage(admin, igObjectPath);

  const { data: updated, error: updateError } = await admin
    .from('fleet_social_posts')
    .update({
      status: 'published',
      external_post_id: externalPostId,
      permalink,
      published_at: new Date().toISOString(),
      error: null,
    })
    .eq('id', postRow.id)
    .select()
    .single();
  if (updateError) {
    // Meta ALREADY published successfully — this is not a "failed post", it
    // is a ledger-write failure on top of a real success. Never call
    // markFailed here (that would make a retry create a SECOND post). Surface
    // the real ids loudly so a human fixes the ledger row directly.
    fail(
      `publish-social: Meta publish SUCCEEDED (external_post_id=${externalPostId}${permalink ? `, permalink=${permalink}` : ''}) but the ledger UPDATE failed: ${updateError.message} — fix fleet_social_posts row ${postRow.id} manually, do NOT retry`,
    );
  }

  console.log(
    JSON.stringify(
      { published: true, outcome: 'published', platform, requestId, externalPostId, permalink, request: updated },
      null,
      2,
    ),
  );
```

---

## 5. הרחבת הטסטים (`publish-social.test.ts`)

בלוקים חדשים להוסיף (הקיימים, 271 שורות, **נשארים ללא שינוי** — §3.7 מבטיח תאימות-לאחור):

```typescript
describe('buildInstagramPublishPlan with a resolved image URL', () => {
  it('still defaults image_url to null when no URL is given (unchanged behavior)', () => {
    expect(buildInstagramPublishPlan('מזל טוב!').steps[0].body.image_url).toBeNull();
  });

  it('places a resolved signed URL into image_url when provided', () => {
    const plan = buildInstagramPublishPlan('מזל טוב!', 'https://xyz.supabase.co/storage/v1/object/sign/social-publish-assets/abc.jpg?token=...');
    expect(plan.steps[0].body.image_url).toContain('social-publish-assets');
  });
});

describe('classifyGraphApiError / formatGraphApiError', () => {
  it('classifies both auth error codes (190, 102)', () => {
    expect(classifyGraphApiError({ error: { code: 190, message: 'Session expired' } })).toBe('auth');
    expect(classifyGraphApiError({ error: { code: 102, message: 'API Session' } })).toBe('auth');
  });
  it('classifies rate-limit codes, including the Page-token BUC code 80001', () => {
    for (const code of [4, 17, 32, 80001, 341, 368, 506, 613]) {
      expect(classifyGraphApiError({ error: { code, message: 'x' } })).toBe('rate_limit');
    }
  });
  it('classifies an unrecognized error code as declined', () => {
    expect(classifyGraphApiError({ error: { code: 100, message: 'Invalid parameter' } })).toBe('declined');
  });
  it('classifies a body with no error key as unknown', () => {
    expect(classifyGraphApiError({})).toBe('unknown');
    expect(classifyGraphApiError(null)).toBe('unknown');
  });
  it('formats a readable message including code/subcode/fbtrace_id', () => {
    const msg = formatGraphApiError({ error: { code: 190, error_subcode: 463, message: 'Session expired', fbtrace_id: 'ABC123' } }, 401);
    expect(msg).toContain('190');
    expect(msg).toContain('463');
    expect(msg).toContain('ABC123');
  });
});

describe('decideContainerPoll', () => {
  it('publishes once FINISHED', () => {
    expect(decideContainerPoll('FINISHED', 0)).toEqual({ action: 'publish' });
  });
  it('fails immediately on ERROR/EXPIRED regardless of attempt count', () => {
    expect(decideContainerPoll('ERROR', 0).action).toBe('fail');
    expect(decideContainerPoll('EXPIRED', 0).action).toBe('fail');
  });
  it('waits while still IN_PROGRESS under the attempt ceiling', () => {
    expect(decideContainerPoll('IN_PROGRESS', 0)).toEqual({ action: 'wait' });
  });
  it('fails after the bounded poll ceiling is reached', () => {
    expect(decideContainerPoll('IN_PROGRESS', IG_CONTAINER_POLL_MAX_ATTEMPTS).action).toBe('fail');
  });
});

describe('isRetryCeilingReached', () => {
  it('allows retry below the ceiling', () => {
    expect(isRetryCeilingReached(1)).toBe(false);
  });
  it('blocks retry at and above the ceiling', () => {
    expect(isRetryCeilingReached(PUBLISH_RETRY_CEILING)).toBe(true);
    expect(isRetryCeilingReached(PUBLISH_RETRY_CEILING + 1)).toBe(true);
  });
});
```

`scripts/fleet-agent-cli.ts` עצמו **אין לו** קובץ-טסט קיים (בדיקה: `find . -iname
"fleet-agent-cli.test.ts"` → ריק) — הלוגיקה-הטהורה שנבדקת היא זו שהועברה ל-`publish-social.ts`
בכוונה (בדיוק בשביל זה, כפי שהערת-הראש של הקובץ מסבירה). ה-orchestration עצמו
(`cmdPublishSocial`, `publishFacebookFeed` וכו') **דורשת mocking של `fetch`/`createAdminClient`**
אם רוצים כיסוי ישיר — לא קיים תקדים לכך בקובץ הזה היום; להעריך בזמן המימוש אם שווה את
המורכבות מול בדיקת-E2E-אמיתית מוגבלת (§6).

---

## 6. צעדי אימות

1. **סטטי**: `npx tsc --noEmit`, `npm run lint` על שני הקבצים המשתנים.
2. **יחידה**: `npm run test -- publish-social` (הקיים + התוספות ב-§5) — **אפס רשת/DB**,
   ריצה מיידית, מכסה 100% מהלוגיקה-הטהורה החדשה.
3. **dry-run תחילה, לא live ישירות**: לפני כל שלב-live, `publish-social --dry-run` עדיין
   חייב לעבור על batch אמיתי (יש כאלה כבר — `.fleet-logs/drafts/social/20260809-batch/`,
   `20260802-batch/`, שניהם עם `post-N-image.png` בפועל) כדי לוודא ש-§4.3/§4.4 (שינויי
   `imageBuffer`/retry-ceiling) לא שברו את המסלול הקיים.
4. **המבחן המבחין** (§2.7) — **לפני** שקוד תלוי בתשובת ה-signed-URL, ולפני שהמיגרציה
   נחשבת "סופית". דורש שלב 0 (טוקן חי) שהושלם.
5. **E2E בלי לפרסם בטעות**: השלב 4/5 המדורג של התוכנית המקורית (§7 שם) הוא בעצמו מנגנון-
   האימות — Facebook-טקסט-בלבד קודם (היקף-נזק הכי-קטן: פוסט-טקסט אחד לעמוד אמיתי, ניתן-
   למחיקה ידנית מאושרת ב-`DELETE /{post-id}`, מאומת-חי §7), רק אחר-כך תמונה-לפייסבוק, רק
   אחר-כך Instagram (הבלתי-הפיך-בפועל, §6 בתוכנית המקורית). **לא** לדלג ישר ל-Instagram
   כדי "לחסוך זמן" — הרצף המדורג **הוא** האסטרטגיה למזער נזק-בזמן-בדיקה.
6. **בדיקת retry-ceiling בפועל**: להריץ `publish-social` פעמיים ברצף על אותה בקשה כשה-
   קרדנציאל שגוי בכוונה (למשל `META_PAGE_ACCESS_TOKEN` ריק) — לוודא שהניסיון השלישי
   מסרב-לנסות (`outcome: 'retry_ceiling_reached'`) במקום לקרוא ל-Meta שוב.
7. **בדיקת cleanup**: אחרי ריצת-Instagram-live אחת (מוצלחת או כושלת), `admin.storage.
   from('social-publish-assets').list()` צריך להיות **ריק** — לא להשאיר אובייקטים-יתומים.

---

## 7. אימות מול תיעוד Meta חי — **שני מקורות עצמאיים**, 2026-08-12 (לא מזיכרון)

לפי הנחיית הבעלים: כל שורה מסומנת עם מקור-האימות המדויק — `ctx7` (`npx ctx7@latest library`/
`docs`, עד 3 קריאות לנושא) ו/או WebFetch/WebSearch ישיר מול `developers.facebook.com`, שניהם
2026-08-12. שורות שבהן שני המקורות הסכימו מסומנות "ctx7 + WebFetch — מוסכם".
`ctx7 library "Facebook Graph API" ...` שלף שלוש ספריות רלוונטיות (בעלות Source Reputation
High): `/websites/developers_facebook_graph-api` (2775 snippets, זהה לזו שהתוכנית המקורית
כבר השתמשה בה), `/websites/developers_facebook_instagram` (1413 snippets), ו-
`/websites/developers_facebook_graph-api_reference_v24_0`. שתי הראשונות נעשה בהן שימוש
ב-`docs` (3 קריאות סה"כ, בתוך המכסה של 3-לנושא).

| נושא | מקור | ממצא |
|---|---|---|
| הרשאות פרסום Instagram (Facebook Login surface) | ctx7 + WebFetch — מוסכם (ctx7: `/websites/developers_facebook_instagram`, Source: `developers.facebook.com/docs/instagram-api/reference/ig-container`; WebFetch: `developers.facebook.com/docs/instagram-platform/content-publishing/`) | `instagram_basic`+`instagram_content_publish`+`pages_read_engagement` — **תואם** לתוכנית המקורית §0/§7 שלב 0. **דלתא, מאושרת פעמיים (ctx7 + WebFetch)**: אם למשתמש-המפרסם יש תפקיד דרך Business Manager על הדף, נדרשות **גם** `ads_management`+`ads_read` — **לא** ברשימת ה-App Review המתוכננת ב-§7 שלב 0 של התוכנית המקורית. הגשה שגויה עולה 2–4 שבועות (זמן-אישור) — **לאמת מול המשתמש-המפרסם בפועל לפני ההגשה**, לא הנחה |
| הרשאות `media_publish` (הצעד השלישי) | ctx7, `/websites/developers_facebook_instagram`, Source: `developers.facebook.com/docs/instagram-api/reference/ig-user/media_publish` | **פרט חדש, לא בתוכנית המקורית ולא ב-WebFetch שלי**: מעבר להרשאות למעלה, נדרש שלמשתמש-המפרסם יש task `MANAGE` או `CREATE_CONTENT` על הדף המחובר. אם מתייגים מוצרים גם `catalog_management`+`instagram_shopping_tag_products` — **לא רלוונטי כאן** (אין תיוג-מוצרים בזרימה). דורש אימות-נקודתי מול הטוקן בפועל בזמן שלב 0/6 |
| **PPA — Page Publishing Authorization** | ctx7, `/websites/developers_facebook_instagram`, Source: `developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing` | **ממצא חדש, לא הופיע בתוכנית המקורית**: אם דף-הפייסבוק המחובר לחשבון-האינסטגרם דורש Page Publishing Authorization, ה-PPA **חייב** להיות מושלם לפני שאפשר לפרסם — ו"**אין דרך פרוגרמטית לדעת אם דף דורש את זה**" (ציטוט-כמעט-מדויק מהתיעוד). **תוספת-תנאי-סף לשלב 0**: לבדוק/להשלים PPA לדף KALFA באופן יזום, לא להניח שהוא לא-רלוונטי |
| "publicly accessible" ל-`image_url` | ctx7 + WebFetch — מוסכם (ctx7 מצטט את אותו משפט משני endpoints שונים בתיעוד; WebFetch מאותו עמוד שה-ctx7 מפנה אליו) | מאשר במפורש: "media must be hosted on a publicly accessible server" — **תואם** התוכנית המקורית. אין אזכור מפורש ל-URL חתום/presigned **בשני המקורות** — לכן §2.7 (מבחן מבחין) נדרש, לא הנחה |
| גרסת-API בדוגמאות Instagram | ctx7 + WebFetch — **אותה תקלה נצפתה בשני המקורות** | ctx7 (`docs/instagram-api/guides/content-publishing`) הראה `<LATEST_API_VERSION>` פלייסהולדר (לא-חד-משמעי); WebFetch הראה `v25.0`+`graph.instagram.com` בדוגמה נפרדת — **כמעט-ודאי** דוגמה ממשטח "Instagram API with Instagram Login" (המשטח האחר, שהתוכנית **לא** משתמשת בו — בדיוק הבלבול ש-§0 של התוכנית המקורית כבר הזהיר ממנו, ושתי בדיקות-עצמאיות-חדשות נתקלות בו שוב). v26.0 מאושר-חי (השורה הבאה) עבור המשטח שבו התוכנית **כן** משתמשת; לאמת נקודתית מחדש את מחרוזת-הגרסה למשטח Facebook-Login-IG בזמן המימוש — לא "גרסה לא-ודאית" באופן גורף |
| הרשאות + שדות `/{page-id}/photos` | ctx7 + WebFetch — מוסכם (ctx7: `/websites/developers_facebook_graph-api`, Source: `developers.facebook.com/docs/graph-api/reference/page/photos`; WebFetch: אותו עמוד) | `pages_read_engagement`+`pages_manage_posts`+`pages_show_list` **תואם** התוכנית המקורית. תומך **גם** `url` **וגם** מולטיפארט — **תואם**. **סייג חדש שגיליתי מ-ctx7**: הדוגמה שם `attached_files` הופיעה **רק** בהקשר `/batch` endpoint (מספר פעולות בקריאה אחת, לא רלוונטי לזרימה כאן — POST בודד ל-`/photos`), **לא** כשם-שדה חלופי ל-`source` בפוסט-בודד. שם-השדה `source` (מ-WebFetch/התוכנית המקורית) **נשאר לא-מאושר-ב-ctx7 באופן ישיר** — לאמת נקודתית בזמן המימוש, כפי שכבר סומן. ctx7's cached snippet הראה `v25.0` בעוד WebFetch-חי היום הראה `v26.0` על אותו עמוד בדיוק — תזכורת נוספת ש-ctx7 עשוי לשקף cache לא-עדכני; **WebFetch-חי הוא הקובע לגרסה**, לא ctx7 |
| שדה תגובה של `/{page-id}/photos` | WebFetch `developers.facebook.com/docs/graph-api/reference/page/photos/` (לא נבדק ב-ctx7 באופן ישיר) | `{id, post_id}` — **`post_id`** הוא מזהה-הפוסט (מקביל ל-`id` של `/feed`) — **פרט חדש**, לא היה בתוכנית המקורית |
| שדה permalink לפוסט פייסבוק | WebFetch `developers.facebook.com/docs/graph-api/reference/v26.0/post` | `permalink_url` — נקרא דרך `GET /{post-id}?fields=permalink_url` |
| גרסת-Graph API נוכחית (כללי) | WebSearch | v26.0 שוחררה בין יולי-אוגוסט 2026, **תואם** התוכנית המקורית (מאומתת שם 2026-07-29) |
| צורת-שגיאה (JSON shape) | ctx7 + WebFetch — מוסכם, זהה-מילה-במילה (ctx7: `/websites/developers_facebook_graph-api`, Source: `developers.facebook.com/docs/graph-api/guides/error-handling`; WebFetch: אותו עמוד) | `{error:{message,type,code,error_subcode,error_user_title,error_user_msg,fbtrace_id}}` |
| קוד-שגיאה: טוקן פג/לא-תקף | ctx7 + WebFetch — **תוספת מ-ctx7 מעבר ל-WebFetch** | `190` (OAuthException) מאושר בשני המקורות. **ctx7 בלבד** (אותו עמוד רשמי, לא cross-checked ישירות ב-WebFetch): קוד `102` ("API Session") — גם הוא טוקן/מצב-התחברות לא-תקף. שני הקודים נכללים ב-`AUTH_ERROR_CODES` (§4.1) |
| קודי-שגיאה: rate-limit | ctx7 + WebFetch, **חלקית-חופפים** | WebFetch (`error-handling`): `1,2,4,17,341,368,506` כ"המתן ונסה שוב". ctx7 (Source: `developers.facebook.com/docs/graph-api/overview/rate-limiting`, נפרד מעמוד ה-error-handling): `32`="Page calls (User access token) limit reached", **`80001`**="Page calls (Page/System User token) limit reached" — **ה-קוד הרלוונטי ביותר לזרימה כאן**, כי `publish-social` תמיד משתמש בטוקן-Page (§3.1/§4.2), לא טוקן-משתמש; `80000`/`80004` הם BUC-limits ל-Ads Insights/Management — **לא רלוונטי**, הזרימה לא נוגעת ב-Ads endpoints. `613` נשאר מ-חיפוש-community בלבד (סבב-מחקר קודם) — **לא** אושר ב-ctx7 או ב-WebFetch בסבב הזה, מסומן להמשך-אימות ב-§4.1 |
| Supabase Storage RLS על bucket ציבורי | `mcp__supabase__search_docs` (Storage Access Control, docs.supabase.com) — לא נבדק ב-ctx7 (מחוץ ל-scope שהבעלים ביקש, שממוקד ב-Meta) | "This is not needed for public buckets, as they are already publicly accessible" — **מבטל** את הצורך ב-`create policy` המוצע בתוכנית המקורית, **גם** בענף-הנפילה ל-public bucket (§2.4/§4.2) |
| בעלות/הרשאות `storage.objects` בפרויקט החי | Supabase MCP, `execute_sql` קריאה-בלבד (לא DDL) — נתון-פרויקט-פנימי, לא רלוונטי ל-ctx7/Meta | `tableowner='supabase_storage_admin'`; `postgres` (מריץ-מיגרציות) לא-חבר ב-`supabase_storage_admin`, לא-superuser — ראו §2.2 לניתוח המלא |

כל שורה שאין לה מקור מפורש בטבלה, ובכל זאת מופיעה ב-§3/§4 למעלה, מסתמכת על ממצא-כבר-מאומת
בתוכנית המקורית (§0 שם) — לא על זיכרון-מאומן שלי. **אם `ctx7` היה מחזיר שגיאת-quota** —
לא קרה בפועל בסבב הזה (כל 4 הקריאות — `library` אחת + 3 `docs` — הצליחו) — ההנחיה הייתה
לציין זאת במסמך ולהמשיך עם WebFetch/WebSearch בלבד, לא לדלג על האימות.

---

## 8. סיכונים

| סיכון | תיאור | מיטיגציה |
|---|---|---|
| **6 בקשות `-logo` ישנות, `approved`+`failed`, retry-eligible** | **חמור ביותר, ממצא-חי** (§0) — ברגע ש-§4.6 עולה עם קרדנציאלים, `poll` רגיל של social-manager יפרסם בפועל Markdown גולמי (`post-N.md`) ל-Instagram/Facebook האמיתיים | §0.3: סגירה טרמינלית **עכשיו**, לפני כל שאר העבודה — לא ממתין ל-go-live; §0.4 מספק assertion-query לאימות; §0.5 שני guards מכניים נוספים (דחיית `.md`, תאריך-חיתוך) כהגנת-עומק |
| Meta דוחה URL חתום ל-`image_url` | לא-מאומת (§2.5/§2.7) — עלול לחסום את כל מסלול-Instagram | §2.7 מבחן-מבחין זול-ולא-הרסני **לפני** מימוש-מלא; נפילה מתועדת-מראש ל-Option A (§2.6) — שינוי שורה אחת בכל צד |
| `ads_management`/`ads_read` חסרים בהגשת App Review | דלתא-חדשה מול התוכנית המקורית, **מאושרת פעמיים** — ctx7 + WebFetch (§7) — הגשה חלקית עולה 2–4 שבועות נוספים | לאמת מול-משתמש-המפרסם-בפועל (יש-לו/אין-לו תפקיד Business Manager) **לפני** ההגשה בשלב 0 |
| Page Publishing Authorization (PPA) לא-מושלם | ממצא-חדש מ-ctx7 (§7) — Meta: "אין דרך פרוגרמטית לדעת אם דף דורש PPA"; אם דרוש ולא הושלם, פרסום-Instagram נחסם בשלב-מימוש, לא בשלב-תכנון | להשלים PPA לדף KALFA באופן יזום כחלק משלב 0, לא להניח שלא-רלוונטי — תוספת לתנאי-הסף הקיימים |
| task `MANAGE`/`CREATE_CONTENT` חסר על הדף | ממצא-חדש מ-ctx7 (§7) — נדרש בנוסף להרשאות-האפליקציה עצמן, ברמת המשתמש-המפרסם על הדף | לאמת מול הטוקן/המשתמש בפועל בזמן שלב 0/6, לא הנחה |
| `UPDATE ... status='published'` נכשל **אחרי** ש-Meta כבר פרסמה | פער-חדש שזיהיתי (§3.5) — retry-אוטומטי במצב הזה היה יוצר פוסט **כפול** | הודעת-`fail()` ייעודית עם `external_post_id`/`permalink` מפורשים, לא `markFailed` (שהיה מאפשר retry) — תיקון ידני נדרש |
| Retry ללא-הגבלה כלפי API פומבי-חי | פער-קוד שזיהיתי (§3.6, §9.2) — התוכנית המקורית מתארת זאת כהתנהגות-role, לא אכיפת-קוד | אכיפה מכנית ב-`cmdPublishSocial` עצמו (§4.3) — לא מסתמך על שיפוט ה-role בלבד |
| קונטיינר Instagram לא-מפורסם משאיר-שיירים | אם ה-poll נכשל/timeout אחרי `create_container` | container לא-מפורסם פג-תוקף מעצמו אצל Meta (TTL מדויק **לא** אומת כאן); התמונה-בבאקט נמחקת בקוד (§4.5/`cleanupInstagramImage`) בכל מסלול-כשל, **וגם** ה-signed URL עצמו פג תוך 600s גם אם המחיקה נכשלת (§2.5) |
| חוסר-בדיקת-E2E ישירה ל-`cmdPublishSocial` | אין תקדים ל-mock-testing של הקובץ הזה (§5) | לוגיקה-מסוכנת מרוכזת ב-פונקציות-טהורות-נבדקות (`publish-social.ts`); ה-orchestration עצמו מאומת דרך הרצף-המדורג ב-§7 של התוכנית המקורית (E2E אמיתי, היקף-נזק-קטן-מכוון) לא unit-mock |
| שינוי בקוד בין כתיבת מסמך זה למימוש בפועל | מספרי-שורות/מבנה עלולים לזוז | כל בלוק-קוד כאן מסומן "לאמת מחדש לפני החלה" (§4 פתיח) |

---

## 9. פערים מזוהים מול התוכנית המקורית ומול הקוד הקיים (סיכום)

1. **`fleet_social_posts.status='published'`/`external_post_id`/`permalink`/`published_at`
   קיימים בסכימה החיה אך שום קוד לא כותב אליהם היום** — §3.5/§4.6 סוגר את זה.
2. **תקרת-retry (`attempt_count>=2`) לא נאכפת בקוד** — `decideExistingRow` מתעלם ממנה
   לגמרי; §3.6/§4.3 מוסיף אכיפה מכנית בנקודת ה-claim.
3. **בעיית ה-scope של `imageBuffer`** בקוד הקיים (§1.2/§4.4) — לא באג פעיל היום (אין
   עדיין קוד שצריך את הבייטים אחרי הבלוק), אבל חוסם ישירות את §4.6 בלי תיקון-שורה-אחת.
4. **בילדר `buildInstagramPublishPlan` נעול על `image_url: null`** — §3.7/§4.1 מציע
   הרחבה אדיטיבית-בלבד, תואמת-לאחור ל-100% מהטסטים הקיימים.
5. **ההכרעה המקורית ל-bucket ציבורי (§4.6 שם) לא בדקה תקדים-קיים-בקוד** (`event-media.ts`
   + שימושו ב-`/g/[token]`) לאותה בעיה מבנית — §2 כאן ממלא את הפער הזה ומגיע להמלצה שונה
   (private+signed, לא public+policy), עם נפילה-מוגדרת אם המבחן המבחין (§2.7) יפריך.

---

## 10. סיכום לבעלים

- **דחוף, נפרד מכל השאר, לבצע היום (§0)**: 6 בקשות `publish_social` ישנות (מפתחות
  `-logo`, שתי האצוות מ-8/8 ו-9/8) יושבות `approved`+`failed`+`attempt_count=2` עם
  Markdown-גולמי (`post-N.md`) כ"כיתוב". ברגע ש-§4.6 עולה עם קרדנציאלים, ריצת `poll`
  רגילה **תפרסם את זה בפועל**. סגירה טרמינלית (`complete`, 6 פקודות מוכנות-להעתקה, §0.3)
  **לפני** כל שאר העבודה במסמך הזה — הרגע הבטוח ביותר לעשות זאת הוא **עכשיו**, כשהסטאב
  הקיים עדיין חוסם כל קריאת-Meta פיזית. שתי הצעות-guard נוספות (§0.5) כהגנת-עומק, לא
  תחליף לניקוי.
- **מסלול Instagram API — המלצה חדה לעבור למסלול B (Instagram Login)** ("תוספת א׳",
  אחרי §0): הבעלים כבר הקים את מוצר "Instagram API" (Instagram Login) — שונה מהמסלול
  הקלאסי שהקוד הקיים ו-§2–§4 בנויים עליו. אימות-חי כפול (ctx7+WebFetch) מתיעוד Meta
  הרשמי מראה ש-App Review בן 2–4 השבועות **אינו נדרש כלל** תחת Standard Access לפרסום
  לחשבון-עצמי — רק ל-Advanced Access (חשבונות של אחרים). פייסבוק ממשיך ללא שינוי דרך
  Page token. עלות-מעבר: endpoint-host + שם-קרדנציאל אחד בקוד המוצע, לא ארכיטקטורה
  חדשה; §0/§2 נשארים תקפים במלואם. הסתייגות-חובה: לאמת בפועל שהוספת ההרשאה
  `instagram_business_content_publish` בדשבורד לא דורשת שלב-אישור נוסף.
- **המלצת-אחסון**: bucket **פרטי** (`social-publish-assets`, `public: false`) +
  `createSignedUrl` בזמן-פרסום — לא bucket ציבורי כפי שהוצע במקור. אותו דפוס-בדיוק שכבר
  רץ בפרודקשן (`event-media.ts`, כולל שימוש-בדפדפן-ציבורי ב-`/g/[token]`), תואם ל-3/3
  buckets קיימים, פותר את שאלת-הבעלות על `storage.objects` (§2.2) לגמרי, ומוסיף TTL
  כרשת-ביטחון-שנייה-עצמאית שהאופציה המקורית לא הייתה מקבלת. תלוי במבחן-מבחין-זול-וללא-
  פרסום (§2.7) שממתין לטוקן חי משלב 0 — עם נפילה-מוגדרת-מראש ל-bucket-ציבורי אם נדרש.
- **היקף המימוש**: תוספת אדיטיבית-בלבד לבילדרים הקיימים (פרמטר-אופציונלי אחד), ~250 שורות
  קוד-חדש (פונקציות-עזר טהורות + orchestration ב-`cmdPublishSocial`), מיגרציה אחת (bucket,
  ללא policy), טסטים חדשים לכל הלוגיקה-הטהורה. שני פערים אמיתיים בין הקוד-הקיים-כבר לבין
  הספק המקורי (ledger-write על הצלחה, תקרת-retry) נסגרים כחלק מהעבודה הזו, לא רק §4.6
  "הטהור".
- **סיכונים מרכזיים**: (1) אי-ודאות אמפירית אם Meta מקבלת URL חתום — מטופלת במבחן זול
  לפני-מימוש; (2) דלתא-הרשאות `ads_management`/`ads_read` שעלולה לעכב App Review ב-2–4
  שבועות אם מוחמצת — **כעת מאושרת פעמיים, ctx7 + WebFetch עצמאית** (§7); (3) שני ממצאים
  **חדשים** שעלו רק דרך ctx7 ולא היו בתוכנית המקורית ולא בסבב-הWebFetch הראשון שלי: דרישת
  Page Publishing Authorization (PPA) — "אין דרך פרוגרמטית לדעת אם דף דורש PPA", ודרישת
  task `MANAGE`/`CREATE_CONTENT` על הדף עבור המשתמש-המפרסם — שתיהן תוספת לתנאי-הסף של
  שלב 0; (4) מקרה-קצה חדש-שזוהה של הצלחת-Meta מול כשל-ledger, שדורש טיפול-שגיאה נפרד
  מ"כשל רגיל" כדי לא ליצור פוסטים כפולים ב-retry.
- **אימות-תיעוד**: כל קביעה טכנית מול Meta ב-§3/§4 מאומתת ב-§7 עם ציון-מקור מפורש לכל
  שורה — `ctx7` (`/websites/developers_facebook_instagram` + `/websites/developers_
  facebook_graph-api`, 4 קריאות, כולן הצליחו, ללא שגיאת-quota) **וגם** WebFetch/WebSearch
  ישיר, שני מקורות עצמאיים בהתאם להנחיית הבעלים — לא הסתמכות על מקור יחיד או על זיכרון.
- **מסמך**: `plans/social-publish-live-stage-plan.md` (זה עצמו).
