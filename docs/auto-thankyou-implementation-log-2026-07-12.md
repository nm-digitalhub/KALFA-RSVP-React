# יומן מימוש — שליחת תודה אוטומטית פוסט-אירוע

תאריך: 2026-07-12
מתעד (scribe): ty-scribe
צוות: thankyou-dev (מימוש) · thankyou-review (ביקורת יריבה) · ty-scribe (תיעוד)
תוכנית מקור: `/var/www/vhosts/kalfa.me/.claude/plans/auto-thankyou-post-event.md`

## תקציר התוכנית

מטרה: שליחה אוטומטית של הודעת תודה לאורחים לאחר האירוע, תוך הימנעות ממגבלת 131049
(מגבלת תבניות-שיווק פר-משתמש של מטא). מסקנת המחקר: הבעיה היא burst בשליחה לאותו נמען,
לא marketing כשלעצמו — לכן העיצוב מתמקד במניעת התנאים המפעילים את המגבלה, לא בעקיפתה.

**מנגנוני מסירה בטוחה (ליבת התוכנית):**
1. תודה אחת בלבד לכל אורח — דדופ מול `contact_interactions`, job = exactly-once.
2. קהל מעורב בלבד — רק אורחים `attending` + עם הסכמה בתוך הסט המורשה.
3. קצב מפוזר (pacing) — שליחה סריאלית עם השהיה, מיחזור תשתית send-timing קיימת.
4. אין auto-retry על 131049 — טרמינלי ל-~24ש', נרשם ב-`contact_interactions`, נחשף ב-breakdown; "שלח שוב" ידני = P2.
5. ניתוב MM Lite קיים + `CLOUD_API_FALLBACK`.

**תזמון:** pg-boss job נפרד (לא drip engine) לכל קמפיין; ברירת מחדל = הבוקר שאחרי `event_date`
~10:00 שעון ישראל, ניתן לעריכה. נדחה-מחדש אם `event_date` משתנה, מבוטל אם האירוע/opt-in בוטלו.

**בקרת בעלים:** toggle `thankyou_auto_enabled` (ברירת מחדל **true**, עם חלון ביטול לפני הירי,
fail-closed בזמן ריצה). הכפתור הידני הקיים (`sendThankyouAction`) נשאר ומשלים.

**סכימה (מתוכננת):** עמודות על `campaigns`/`events`: `thankyou_auto_enabled`, `thankyou_send_at`
(או offset), `thankyou_sent_at` (exactly-once guard). guard/אינדקס לדדופ. RLS/ownership דרך
`requireEventAccess`.

**חלוקת עבודה:** הצוות (Sonnet-5, dev+review יריב+scribe) בונה מקומית — קוד, migration files,
טסטים, gates. החלת migration לפרודקשן + deploy + שליחת אמת מבוקרת — הסשן הראשי, תחת אישור המשתמש.

**מגודר מהסבב הראשון (P2):** העדפת חלון-24ש'-פתוח לתזמון חכם פר-נמען; תבניות `_v2` מעוצבות
לכל 9 סוגי האירוע (רק brit קיים כרגע); i18n; "שלח שוב ללא-נמסרו" הידני.

## Discovery / Breakdown

**thankyou-dev — שלב 1 (Discovery) הושלם:**
- קבצים שנקראו: `worker/main.ts`, `src/lib/queue/queues.ts`, `src/lib/data/outreach.ts`
  (`sendCampaignWhatsApp`/`sendOneWhatsApp`), `src/lib/outreach/enqueue.ts`,
  `src/lib/data/campaign-delivery.ts`, `campaign-actions.ts` (`sendThankyouAction`), סכימת
  `campaigns`/`contact_interactions`, `src/lib/data/event-date.ts`
  (`ilWallTimeToIso`/`israelCalendarDay`).
- **פרצה סכמתית שהתגלתה:** ל-`contact_interactions` אין עמודת `message_key` → דדופ פר-אורח
  פר-**סוג-הודעה** אינו אפשרי במבנה הנוכחי, מכיוון שקמפיין אחד משרת את כל סוגי ההודעות של
  האירוע (invite/reminder/thankyou/gift וכו'). התוכנית המקורית הניחה דדופ "אחת לכל אורח בקמפיין
  הזה" — צריך לוודא שזה לא מתנגש עם שליחות קודמות (invite/reminder) לאותו קמפיין.
- thankyou-dev שלח breakdown ברמת-קבצים ל-main וממתין לאישור/כיוונון לפני שלב 2 (מימוש).

## החלטות עיצוב

**סטייה מהתוכנית המקורית שהתגלתה תוך כדי עבודה (thankyou-dev, 2026-07-12):**
- **§2.3 pacing הוסר מהסקופ.** התוכנית עודכנה אחרי ש-thankyou-dev כבר התחיל: 131049 היא מגבלה
  **פר-נמען**, לא throughput כללי — הדדופ פר-אורח (מנגנון #1) פותר את בעיית ה-burst לגמרי בלי
  צורך בהשהיה סריאלית בין הודעות. המימוש **אינו כולל pacing**.
- **מנגנון הדדופ השתנה במהלך העבודה:** בהתחלה נשקל guard ברמת-קמפיין בלבד
  (`thankyou_sent_at` על `campaigns`). אחרי ניתוח partial-failure (שליחה חלקית לאורחים בקמפיין),
  thankyou-dev עבר לדדופ אמיתי **פר-אורח** דרך `contact_interactions.message_key` (עונה גם על
  הפרצה הסכמתית שתועדה ב-Discovery). `thankyou_sent_at` נשאר, אך רק כאופטימיזציית-סינון
  לשאילתת ה-sweep — לא כמנגנון הדדופ עצמו.

## קבצים שהשתנו

**Migration (חדש, לא הוחל על ה-DB):**
- `supabase/migrations/20260712205030_auto_thankyou_schema.sql` — 3 עמודות על `campaigns` +
  `message_key` על `contact_interactions` + 2 אינדקסים חלקיים.

**קוד:**
- `src/lib/data/event-date.ts` — `defaultThankyouSendAt()`
- `src/lib/data/auto-thankyou.ts` (חדש) — `listDueThankyouCampaigns`/`runThankyouSweep`/`markThankyouProcessed`
- `src/lib/data/outreach.ts` — תיוג `message_key` בכל שליחה, attending-filter + דדופ פר-אורח ל-thankyou
- `src/lib/data/campaigns.ts` — `activateCampaign` מזרעע `thankyou_send_at`; `getThankyouSchedule`/`updateThankyouSchedule`
- `worker/main.ts` + `src/lib/queue/queues.ts` — queue+schedule חדשים (`campaign-thankyou-sweep`, `*/5 * * * *`)
- `src/lib/validation/campaigns.ts` — `thankyouScheduleSchema`
- `campaign-actions.ts` / `manage-client.tsx` / `page.tsx` — UI toggle + לוח זמנים

**טסטים:**
- `event-date.test.ts` — DST קיץ/חורף
- `outreach.test.ts` — 4 טסטים חדשים (דדופ, לא-דדופ-חוצה-סוג, attending-only, תיוג)
- `auto-thankyou.test.ts` — 10 טסטים חדשים
- `campaigns.test.ts` — 6 טסטים חדשים

**Commit:** `57c2fe0` על branch `feature/auto-thankyou` (מקומי בלבד).

## תוצאות אימות

- `lint` — נקי
- `tsc --noEmit` — נקי
- `vitest run` — 1200 עברו, 19 skipped, **0 נכשלו**
- `next build --webpack` — הצליח
- esbuild worker bundle — הצליח
- **ללא deploy/push בפועל** — לפי חלוקת העבודה (ראה תקציר התוכנית).

**הבהרת migration:** ה-SQL נוצר מקומית בלבד (`supabase migration new`), **לא הוחל** על ה-DB
המקושר (לא בוצע `db push`). הקוד קורא/כותב לעמודות החדשות דרך `select('*')` + narrowing מתועד,
עד ש-`generate_typescript_types`/`gen types` ירוץ אחרי שהמנהל יחיל את המיגרציה.

## ממצאי ביקורת (thankyou-review)

**סקירה עצמאית על commit `57c2fe0` (feature/auto-thankyou):** tsc/lint ירוקים, 92/92 טסטים
עוברים ב-4 קבצי auto-thankyou/campaigns/outreach/event-date — הבאגים למטה **אינם** נתפסים ע"י
הטסטים הקיימים.

**Verdict: BLOCK — 2 באגים חמורים, לתיקון ע"י thankyou-dev.**

**BUG #1 (חמור) — הדדופ הוא check-then-act, אין backstop אטומי ב-DB (race condition/כפילות שליחה):**
- `supabase/migrations/20260712205030_auto_thankyou_schema.sql:58-60` יוצר רק **אינדקס** על
  (campaign_id, contact_id, message_key) — לא **UNIQUE constraint**.
- הדדופ בפועל (`src/lib/data/outreach.ts:312-326`): SELECT prior interactions → סינון contacts
  → לולאה עם `sendOneWhatsApp` (upsert על `channel,provider_id` — לא מדביק כפילויות כי
  provider_id שונה בכל שליחה אמיתית).
- **Race קיים בפועל:** שני מסלולים בלתי-תלויים קוראים ל-`sendCampaignWhatsApp(campaignId,
  'thankyou')` בלי נעילה ביניהם — הכפתור הידני `sendThankyouAction`
  (`campaign-actions.ts:292-322`, web tier) וה-sweep האוטומטי `runThankyouSweep` (worker, כל 5
  דקות; אין `singletonKey` ב-`src/lib/queue/queues.ts`). לחיצה בו-זמנית / ticks חופפים → שתי
  הקריאות קוראות אותה priorRows ריקה → הודעה כפולה בפועל לאותו אורח.
- **תיקון מוצע:** UNIQUE constraint אמיתי (לא רק אינדקס) על
  `contact_interactions(campaign_id, contact_id, message_key) WHERE direction='out'` +
  reserve-then-send (insert השורה **לפני** קריאת ה-API, לא אחריה) כך שה-upsert יזרוק על violation
  וימנע את קריאת ה-HTTP הכפולה עצמה.

**BUG #2 (חמור) — sweep מסמן "נשלח" גם כשלא נשלח כלום, בלי דרך חזרה (בלתי הפיך):**
- `src/lib/data/auto-thankyou.ts:83-101`: `runThankyouSweep` קורא ל-`markThankyouProcessed`
  (מסמן `thankyou_sent_at`) על **כל** קריאה מוצלחת (לא-throw) ל-`sendCampaignWhatsApp`, כולל
  כשהתשובה היא `{sent:0, skipped:0}` בלי throw — קורה בכמה מסלולים לגיטימיים
  (`outreach.ts:200-232`): kill-switch גלובלי כבוי, WhatsApp config חסר, campaign/event לא
  active, תבנית לא מאושרת/לא פעילה.
- **תוצאה:** אם ה-tick הראשון "due" נופל בדיוק כשאחד מהתנאים חולף — `thankyou_sent_at` מסומן
  **לצמיתות** בלי שנשלחה הודעה. בלתי הפיך: `updateThankyouSchedule`
  (`campaigns.ts:794-828`) חוסם עריכה כש-`thankyou_sent_at` לא null (`.is('thankyou_sent_at',
  null)` guard) — גם הבעלים לא יכול לתזמן מחדש דרך ה-UI. אין sink/רישום נראה לעין (בניגוד
  ל-`recordTemplateFailure`) — רק `console.error`, ורק בענף ה-throw השונה.
- הטסט הקיים (`auto-thankyou.test.ts:212-222`) בודק רק את מקרה ה-throw, לא את המקרה המסוכן:
  `{sent:0,...}` בלי throw.
- **תיקון מוצע:** `markThankyouProcessed` רק כש-`sent>0` (או תנאי דומה שאינו gate חולף), ולסמן
  מצב נפרד ("attempted, 0 sent, gate reason X") שנשאר retry-able ונראה לבעלים.

**נבדק ותקין (לא לגעת):**
- attending-filter (`outreach.ts:289-300`) לפני הדדופ — סדר נכון, אין leak.
- דדופ message_key ספציפי ל-'thankyou', שוויון מדויק — לא דולף בין invite/gift/thankyou, כולל
  מול NULL ישן.
- `activateCampaign` seeding עם `.is('thankyou_send_at', null)` — מגן נכון על re-activation.
- forward-compat `select('*')` + narrowing — לא קורס לפני apply migration.
- UI guard על עריכה אחרי שליחה — אכוף server-side.
- אין רגרסיה נראית ל-gift/event_day/invite.
- no-retry על 131049 — תקין.

## אימות מול DB חי (ty-inspector)

בעקבות תיקון BUG #1 (introspection על סכימה חיה, read-only — לא בוצע שינוי):

**סכימה חיה (`contact_interactions`):** `direction`/`kind` הם `text` רגיל (לא enum, אין CHECK);
ערכים חיים `direction`∈{in,out}, `kind`∈{message,template,qa_quickreply_probe}. `provider_id` =
`text NOT NULL` (מאשר את הצורך ב-placeholder דטרמיניסטי). `message_key` **עדיין לא קיים** בסכימה
החיה. `contact_id` FK הוא `ON DELETE SET NULL` (זניח). `campaigns`: 3 העמודות `thankyou_*` עדיין
לא קיימות — **אין קונפליקט** מול הסכימה החיה. UNIQUE קיים יחיד: `(channel, provider_id)`. 0 שורות
thankyou היסטוריות מתוך 129 שורות total — אין קונפליקט נתונים עם ה-partial unique index החדש.

**מכשול (לא שובר P0, אך דורש תיקון לפני deploy):** ה-RPC `claim_thankyou_recipient` (מהתיקון
ל-BUG #1) בונה `provider_id` דטרמיניסטי (`thankyou-claim:<campaign>:<contact>`) ומציין
conflict_target מפורש (`thankyou_claim_uq`). ב-Postgres, `ON CONFLICT` עם arbiter מפורש מטפל
**רק** בהתנגשות דרך האינדקס הזה — התנגשות מקבילה בקונסטריינט unique אחר
(`channel, provider_id`, שגם הוא מתנגש כי `provider_id` זהה בריצה חוזרת לאותו campaign+contact)
עדיין זורקת `23505` רגיל, לא "נבלעת" ל-`DO NOTHING`. בפועל זה עדיין מונע double-send (ה-caller
ב-`outreach.ts` עושה skip על כל error), אך מייצר רעש/שגיאות DB גולמיות בכל race אמיתי (2 sweep
ticks חופפים / web+worker) במקום `'already_claimed'` נקי כמתועד בהערות.
**תיקון מומלץ:** לעטוף את ה-INSERT ב-RPC ב-`EXCEPTION WHEN unique_violation THEN return
'already_claimed';`.

**נקודה משנית:** ההערה במיגרציה שאומרת ש-`sendOneWhatsApp`'s own insert "silently no-ops" מול
אותה שורה — נכונה בפועל אך מהסיבה הלא-מדויקת (מתנגש ב-`thankyou_claim_uq`, לא ב-arbiter שצוין
במפורש; השגיאה נבלעת ע"י ה-best-effort הקיים). תוצאה תקינה בפועל, אך שברירי/לא מתועד מדויק.

**מסקנת ty-inspector (מקורית):** התכנון בר-ביצוע על הסכימה החיה כפי שהיא, בכפוף לתיקון ה-`EXCEPTION
WHEN unique_violation` לפני deploy. לא בוצעה בדיקה אמפירית בטרנזקציה (read-only mandate + חסימת
permission classifier) — thankyou-dev צריך לוודא בפועל.

**עדכון — הופרך אמפירית ע"י הסשן הראשי (ראו §"אימות אמפירי סופי" למטה):** החשש היה סביר
כתיאוריה, אך בבדיקה אמפירית עם טופולוגיית-constraints מדויקת (`(channel,provider_id)` הוותיק +
`thankyou_claim_uq` החדש, באותו סדר יצירה) בתוך `BEGIN`/`ROLLBACK` — לא נמצא `23505` גולמי; ה-RPC
`claim_thankyou_recipient` **כפי שהוא (ללא EXCEPTION)** מחזיר `already_claimed` נקי.

## סבב תיקון BUG #1/#2 (thankyou-dev, commit `de3c5a1`)

commit חדש `de3c5a1` על גבי `57c2fe0` (לא amend), בתגובה ל-BLOCK של thankyou-review:

**תיקון BUG #1 (דדופ לא-אטומי):** הוחלף read-then-filter (קרא priorRows ואז סינן) ב-**claim-before-send
אטומי**: RPC חדש `claim_thankyou_recipient` (בתוך המיגרציה הקיימת) מכניס שורת-placeholder ל-
`contact_interactions` מוגנת ע"י partial UNIQUE index על `(campaign_id, contact_id) WHERE
message_key='thankyou'` — race אבוד מחזיר `'already_claimed'` בלי לכתוב שורה, **לפני** קריאת ה-API
של WhatsApp. שליחה מוצלחת (accepted) → **finalize**: מעדכן את `provider_id` האמיתי על אותה שורה
(כך שה-webhook של Meta ימצא אותה). שליחה כושלת → השורה נשארת (permanent claim, בכוונה — תואם
את פילוסופיית ה-at-most-once ואת "אין auto-retry" מהתוכנית). נוסף גם `policy: 'singleton'` לתור
ה-sweep (`worker/main.ts`) כדי שלא ירוצו שני ticks חופפים מלכתחילה.

**תיקון BUG #2 (mark-processed על חסימה חולפת):** `sendCampaignWhatsApp` מחזיר עכשיו `blocked:
boolean` — `true` לכל gate מוקדם (kill-switch כבוי, אין קונפיג, קמפיין/אירוע לא פעיל, תבנית לא
מאושרת) לפני שאפילו resolved contacts; `false` כשההרצה הגיעה בפועל ללולאה (גם אם `sent=0`).
ה-sweep מסמן `thankyou_sent_at` רק כש-`blocked=false`, ורושם `console.error` גלוי כש-`blocked=true`
(לא נכשל בשקט).

**טסטים:** רגרסיה נכתבה **לפני** כל תיקון (עכשיו ירוקה): `auto-thankyou.test.ts` +2 (blocked
לא מסומן / `sent:0`-לא-blocked כן מסומן), `outreach.test.ts` שוכתב כמעט לגמרי ל-describe של
thankyou (claim-order verification, finalize-on-accepted, לא-finalize-על-כישלון).

**Gates:** lint+tsc נקיים, `vitest run` 1204 עברו/0 נכשלו, build+worker-bundle הצליחו.

**⚠ פתוח לאימות ע"י thankyou-review:** דיווח thankyou-dev **לא מציין במפורש** אם נוסף
`EXCEPTION WHEN unique_violation` ל-RPC `claim_thankyou_recipient`, כפי שהמליץ ty-inspector
(ה-arbiter המפורש `thankyou_claim_uq` ב-`ON CONFLICT` אינו מכסה קונפליקט מקביל על
`(channel, provider_id)`). יש לוודא בסבב הביקורת הבא שהמכשול הזה טופל בפועל ולא רק ש-BUG
#1/#2 המקוריים נסגרו.

## חידוד RPC + אימות אמפירי (thankyou-dev, commit `9da8181`)

בעקבות המכשול שתיעד ty-inspector (ON CONFLICT arbiter מפורש לא מכסה קונפליקט מקביל על
`(channel, provider_id)`) ובקשת ty-scribe לאימות מפורש — thankyou-dev חזר עם commit `9da8181`:

- **pg-boss מול ctx7 (תיעוד חי):** אושר ש-`policy:'singleton'` על ה-`createQueue` (לא
  `singletonKey` על ה-send) הוא הנכון — כבר יושם בסבב הקודם, אין שינוי נדרש.
- **בדיקה אמפירית בפועל** (לא תיאורטית בלבד) ב-container Postgres מבודד
  (`pg-outreach-diagnose`, סכימת scratch שנמחקה בסוף): שתי טרנזקציות **מקבילות אמיתיות** (אחת
  נשארת פתוחה/uncommitted במכוון, השנייה מנסה claim לאותו contact+campaign בזמן שהראשונה עדיין
  לא commit). **תוצאה: גם בלי exception handler, ה-arbiter resolution כבר פתר את זה נקי
  ל-`'already_claimed'`, בלי `23505` גולמי** — כי ה-`provider_id` הפלייסהולדר קשור 1:1 לאותו
  (campaign,contact) שה-partial index כבר שומר עליו, כך ששני ה-constraints לעולם לא מתפצלים
  בעיצוב הזה. הממצא האמפירי תועד במיגרציה עצמה.
- **בכל זאת נוסף** `EXCEPTION WHEN unique_violation` כ-**defense-in-depth** (לא משנה נכונות,
  משפר observability ומגן מפני שינוי עתידי בסכמת ה-placeholder) — **כך שהפער שסומן קודם בלוג
  כפתוח (§ סבב תיקון BUG #1/#2) נסגר בפועל.**
- תוקנה גם הערה לא-מדויקת ב-`outreach.ts`: `sendOneWhatsApp`'s own insert attempt לא "no-ops
  בשקט" — הוא זורק `23505` אמיתי שנבלע ע"י ה-best-effort הקיים (לא בודק error).
- **Gates:** lint+tsc נקיים, `vitest run` 1204/0 נכשלו, build+worker-bundle הצליחו.

## אימות אמפירי סופי (הסשן הראשי, על `de3c5a1`)

הסשן הראשי (manager) אימת אמפירית את חשש ty-inspector בעצמו, בלי לגעת בטבלה האמיתית: temp table
עם טופולוגיית ה-constraints המדויקת מהסביבה החיה — `(channel,provider_id)` unique ותיק +
partial `thankyou_claim_uq` חדש, **באותו סדר יצירה** — בתוך `BEGIN`/`ROLLBACK`.

**תוצאה: ה-RPC `claim_thankyou_recipient` ב-`de3c5a1` נכון כפי שהוא — ה-`EXCEPTION` מיותר.**
- הכנסה שנייה עם `provider_id` דטרמיניסטי זהה → **`DO NOTHING` נקי, 0 שורות, אין `23505`**,
  מחזיר `already_claimed` נקי.
- הסיבה: כששני האילוצים מופרים ע"י אותה שורה כפולה, Postgres מזהה את ה-arbiter ומבטל את
  ה-speculative insert לגמרי → `(channel,provider_id)` **לעולם לא מופר**. חשש ה-inspector
  (23505 גולמי) **לא התממש** למקרה הזה.
- נבדקו גם EXCEPTION-wrapper ו-provider_id-ייחודי — שניהם עובדים אך **מיותרים**.

מסקנה מעשית: ה-`EXCEPTION WHEN unique_violation` שנוסף ב-`9da8181` נשאר במקום כ-defense-in-depth
תקין (לא שגוי, לא מזיק) — אך **לא היה קריטי לנכונות**, כפי שנטען בטעות בסבב הקודם של הלוג.
thankyou-review-2 מבצע כעת ביקורת חוזרת על `de3c5a1`.

## ביקורת חוזרת (thankyou-review-2, commit `de3c5a1`) — Verdict: APPROVE

בדיקה עצמאית מלאה: `npx tsc --noEmit` נקי, `npm run lint` נקי, `npx vitest run` → 1204
עברו/19 skipped/0 נכשלו. **לא נמצאו באגים חדשים. אין apply/deploy/send בפועל.**

**BUG #1 (claim-before-send אטומי) — אומת כמתוקן:**
- `claim_thankyou_recipient` (מיגרציה `20260712205030`) מכניס placeholder מוגן ב-partial UNIQUE
  index חדש `(campaign_id, contact_id) WHERE message_key='thankyou' AND direction='out'`,
  `ON CONFLICT ... DO NOTHING` עם החזרה מבוססת-FOUND `'claimed'`/`'already_claimed'`.
- ב-`outreach.ts`: קריאת ה-claim מתבצעת פר-contact **לפני** `sendOneWhatsApp` (סדר קוד מאומת) —
  `claimErr` או תוצאה שאינה `'claimed'` → skip, לעולם לא שולח. הטסט מאמת `claimOrder < sendOrder`
  דרך `invocationCallOrder`.
- ב-`accepted`: `UPDATE` מפורש מסיים (finalize) את `provider_id` על אותה שורה (למציאה ע"י
  webhook המסירה של Meta). אומת ש-upsert-ה-own של `sendOneWhatsApp` (`onConflict
  channel,provider_id`) לא מתנגש עם ה-UPDATE הזה — יעד arbiter שונה; בשליחה אמיתית מאושרת הוא
  יזרוק `23505` אמיתי מול ה-partial index של thankyou, שנבלע ע"י ה-best-effort הקיים של
  `sendOneWhatsApp` — תואם בדיוק את תיאור ההערה במיגרציה (אומת מול `classifyResponse`/
  `DeliveryOutcome` וקריאת ה-upsert).
- בכשל/לא-ידוע: שורת ה-claim נשארת בכוונה (אין auto-retry) — trade-off מתועד, תואם פילוסופיית
  at-most-once קיימת. הטסט `'does NOT finalize... when send is not accepted'` מאמת שאין UPDATE.
- `worker/main.ts`: תור ה-sweep נוצר עם `{ policy: 'singleton' }` (אומת מול תיעוד pg-boss חי
  דרך context7: singleton = מקסימום 1 פעיל, תור ללא הגבלה) — מוגדר נכון **לפני** `boss.schedule`,
  סוגר את מרוץ ה-tick-חופף במקור, כהגנה שנייה.
- הנימוק במיגרציה עצמה (למה אין 23505 מה-insert של ה-claim RPC עצמו — provider_id דטרמיניסטי
  1:1 עם campaign_id+contact_id) תקין ותואם את מה שהמנהל כבר אימת אמפירית — לא נבדק מחדש.

**BUG #2 (blocked flag) — אומת כמתוקן:**
- `sendCampaignWhatsApp` מחזיר `{sent, skipped, blocked}`. כל early-return לפני resolved contacts
  (outreach כבוי, אין קונפיג WhatsApp, קמפיין חסר/לא active, ערוץ לא מותר, gate של
  past-event-day, אירוע לא active, אין תבנית ניתנת-לפתרון) מגדיר `blocked:true`. כל מסלול שמגיע
  ל-resolution של contacts (כולל ענף ה-fail-closed של event-day עם token חסר, והלולאה הרגילה)
  מחזיר `blocked:false` — כולל המקרה הלגיטימי "0 contacts זכאים ב-tick הזה".
- `runThankyouSweep` קורא ל-`markThankyouProcessed` רק כש-`blocked` הוא false; ב-blocked מגדיל
  מונה נפרד ורושם `console.error` גלוי (ללא PII) עם `campaignId`, וממשיך לקמפיין הבא — תואם דרישת
  "המפעיל חייב לראות את זה".
- הטסטים מכסים את שני הענפים החדשים: blocked→לא מסומן (+ assertion על לוג גלוי), ו-
  `sent:0`/`blocked:false`→כן מסומן (מבחין "אין זכאים" מ-"gate חסם").

**בדיקת רגרסיה:** 4 קריאות שאינן-thankyou ל-`sendCampaignWhatsApp` (gift/event_day_pay/thankyou
actions, whatsapp-send route) עושות destructure/assign תואם מבנית לשדה `blocked` החדש — ללא
שגיאות קומפילציה. תיוג `message_key` ב-`sendOneWhatsApp` ללא שינוי בדיף הזה (כבר קיים מ-`57c2fe0`);
זרימות invite/gift/event_day לא נגעו בקומיט הזה.

## פתוחים / מגודר

- **BLOCK הוסר — APPROVE סופי מ-thankyou-review-2 על `de3c5a1`.** לאחר מכן בוצע commit נוסף
  (`bfda835`, הסרת exception handler מיותר) — ממתין לביקורת חוזרת קצרה על השינוי הזה בלבד.
- migration לפרודקשן + deploy + שליחת אמת מבוקרת — מבוצעים ע"י הסשן הראשי בלבד, לא ע"י הצוות
  (עדיין לא בוצע).
- P2 (לא בסבב זה): חלון-24ש'-פתוח לתזמון חכם, תבניות `_v2` מעוצבות לכל 9 סוגי אירוע, i18n,
  "שלח שוב ללא-נמסרו" ידני.

## נבדק ותקין (הוסף מתוך "פתוחים")

- **המכשול של ty-inspector (`EXCEPTION WHEN unique_violation`):** נבדק אמפירית פעמיים —
  פעם ע"י thankyou-dev (`9da8181`, container מבודד) ופעם ע"י הסשן הראשי (temp table, אותה
  טופולוגיית constraints, `BEGIN`/`ROLLBACK`). **המסקנה הסופית: ה-RPC נכון גם בלי ה-EXCEPTION** —
  ה-arbiter resolution של Postgres כבר פותר את הקונפליקט הכפול נקי. אין צורך בפעולה נוספת.

## הסרת ה-exception handler (thankyou-dev, commit `bfda835`)

בעקבות האימות האמפירי הכפול (thankyou-dev + הסשן הראשי, שני temp/container tests עצמאיים
עם אותה מסקנה) — הסשן הראשי ביקש להסיר את ה-`EXCEPTION WHEN unique_violation` שנוסף ב-`9da8181`:
הוא נחשב **dead code מטעה** — קורא עתידי עלול להסיק ששני ה-constraints ("channel,provider_id"
וה-`thankyou_claim_uq`) יכולים "להתפצל", כשבפועל הם לא יכולים (ה-`provider_id` הדטרמיניסטי
תמיד קשור לאותו tuple `campaign_id+contact_id`).

**commit `bfda835`:**
- הוסר ה-exception handler מה-RPC `claim_thankyou_recipient`.
- הורחבה ההערה במיגרציה כדי לתעד את **שני** האימותים האמפיריים העצמאיים (של thankyou-dev
  ב-`9da8181`, ושל הסשן הראשי ב-temp table) וההנחה המבנית שעליהם הם נשענים.
- שאר הקוד (הערת `sendOneWhatsApp` המתוקנת, ה-RPC עצמו, ה-partial index) — ללא שינוי.

**Gates:** lint+tsc נקיים, `vitest run` 1204/0 נכשלו, build הצליח.

**ממתין לביקורת חוזרת של thankyou-review על `bfda835`** (וידוא שהסרת ה-exception handler לא
פוגעת בהתנהגות — צפוי ללא שינוי פונקציונלי, רק ניקוי dead code + תיעוד).

## ביקורת Frontend/RTL/נגישות (ty-frontend-expert, commit `bfda835`) — Verdict: ISSUES

בדיקה על ה-UI של toggle+לוח-הזמנים (`manage-client.tsx`). **3 ממצאים, כולם ב-UI, אין השפעה על
הלוגיקה/הדדופ/ה-RPC שנבדקו לעיל.**

1. **`manage-client.tsx:222-237`** — `ThankyouScheduleForm` משתמש ב-`<input type="date">`/
   `<input type="time">` נטיביים במקום `DateSelectIL`/`TimeSelect24` — הקונבנציה הקיימת בכל
   שאר הפרויקט (למשל `edit-event-form.tsx`). native inputs מוצגים לפי locale/OS של הדפדפן ועלולים
   להטעות משתמש ישראלי בממשק אנגלי (mm/dd/yyyy, שעון 12ש'). **תיקון:** להחליף לרכיבים הקיימים,
   `name` נשאר זהה.
2. **`manage-client.tsx:206`** — `new Date(thankyou.sentAt!).toLocaleString('he-IL')` בלי
   `timeZone` → hydration mismatch + שעה שגויה מחוץ ל-`Asia/Jerusalem`. **תיקון:** להשתמש
   ב-`formatIsraelDateTime` מ-`@/lib/date`.
3. **מינורי:** class אד-הוק על ה-inputs לא תואם ל-`compactSelectClass` המשותף — נפתר ממילא
   עם תיקון #1.

**מה תקין:** checkbox labeling, `alreadySent` state, `FormError`/`FormNotice`, conditional
render מול `page.tsx`, client/server boundary (`event-date.ts` ללא תלויות).

**סטטוס:** ממצאים נשלחו גם ל-main; לטיפול ע"י thankyou-dev בסבב UI נפרד (לא חוסם את ה-APPROVE
של הלוגיקה האחורית).

## תיקון 4 ממצאי פאנל-מומחים (thankyou-dev, commit `b2df52f`)

commit חדש `b2df52f` (על גבי `bfda835`) — כל 4 הממצאים מ-5 מומחי-הדומיין תוקנו:

**Frontend (2 סטיות אמת מקונבנציות מתועדות):**
1. `manage-client.tsx` — הוחלפו `<input type="date">`/`<input type="time">` הנטיביים ברכיבי
   הפרויקט `DateSelectIL`/`TimeSelect24` (אותם `name=` בדיוק — server contract לא השתנה).
2. `manage-client.tsx` — הוחלף `new Date(...).toLocaleString('he-IL')` (בלי `timeZone` →
   hydration mismatch + שעה שגויה) ב-`formatIsraelDateTime` מ-`@/lib/date`.

**זול + כדאי:**
3. `outreach.ts` — ה-finalize UPDATE (מעדכן `provider_id` אחרי accepted send) עכשיו בודק ומתעד
   error, עקבי עם `markThankyouProcessed`/`recordTemplateFailure`.
4. `claim_thankyou_recipient` RPC — נוסף null-guard זול ל-`p_campaign`/`p_contact` בתחילת
   הפונקציה (partial unique מתייחס ל-NULL כלא-שווה, לא reachable כרגע אבל insurance חינם).
   thankyou-dev אימת על סכימת scratch מבודדת שהפונקציה מתקמפלת ומתנהגת נכון (null→
   `already_claimed`, claim רגיל→`claimed`→`already_claimed` בשנייה).

**Gates:** lint+tsc נקיים, `vitest run` 1204/0 נכשלו, build הצליח.

**ממתין לביקורת חוזרת:** ty-frontend-expert לאמת את תיקוני ה-UI, הסשן הראשי להריץ dry-run על
המיגרציה.

## סגירה (הסשן הראשי) — 2026-07-12

הפרויקט מוזג, נפרס, והמיגרציה הוחלה על הפרודקשן:

- מוזג לענף `main` (commit `b88d780`).
- נפרס ל-beta.
- migration `20260712205030_auto_thankyou_schema.sql` הוחלה על ה-DB המקושר (הסשן הראשי בלבד,
  כמתוכנן מההתחלה).
- ה-sweep (`campaign-thankyou-sweep`) רשום ורץ בתזמון (`*/5 * * * *`, worker).
- team-lead שחרר את הצוות (thankyou-dev / thankyou-review / thankyou-review-2 / ty-inspector /
  ty-frontend-expert / ty-scribe) — הפיצ'ר "שליחת תודה אוטומטית פוסט-אירוע" הושלם.

**מצב סופי:** מיושם, נבדק (2 סבבי BLOCK→APPROVE על הלוגיקה האחורית + סבב UI/RTL נפרד שתוקן
במלואו), מוזג, נפרס, migration חי בפרודקשן. ראו "פתוחים/מגודר" למעלה ל-P2 שנותרו מחוץ לסבב
הזה (חלון-24ש'-פתוח, תבניות `_v2` מעוצבות לכל 9 סוגי אירוע, i18n, "שלח שוב ללא-נמסרו" ידני).
