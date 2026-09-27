# ניתוח תפקיד ה-fleet `social-manager`: ריצות חוזרות 27.9.2026

**סוג המסמך:** ניתוח לקריאה בלבד. לא שונה שום קובץ, config, תפקיד או DB. לא בוצע restart. לא נסגרה ולא אושרה שום בקשה.
**נכתב:** 27.9.2026, בערך 15:15 IDT.
**סימון טענות:** כל טענה מסומנת **MEASURED** (יש לה ראיה: קובץ ושורה, לוג או שאילתה) או **INFERRED** (הסקה).

---

## 0. תקציר

1. **סיבת השורש: ה-answer-watcher, לא ה-cron.** **MEASURED.**
   - ה-slot השבועי (11:30) רץ פעם אחת בלבד.
   - כל 47 ה-spawns שאחריו הגיעו מה-answer-watcher ב-`scheduler.mjs`. כולם ניסו לצרוך את אותו verdict: `62dc162c`, שהוא `publish-20260913-batch-2-instagram-r2`, בסטטוס `approved`.
   - לבקשה הזו **אין שום יציאה חוקית** מהצד של התפקיד:
     - `publish-social` נחסם בתקרת הניסיונות, בגלל false-positive של ה-validator על המילה "תמיד".
     - `ack` נחסם בקוד (הגנת ה-ack-trap).
     - `complete` על כישלון אסור לפי ה-prompt.
     - ה-expire חל רק על בקשות `pending`.
   - מאז commit ‏`7465ab6` (31.8) ה-marker של verdict הוא cooldown של 4 דקות ולא סימון חד-פעמי. לכן ה-verdict נשלח מחדש כל 4–5 דקות, והגבול היחיד הוא `answer_daily_run_cap=50`.
2. **האם זה עדיין פעיל? כן.** **MEASURED.**
   - spawn אחרון שנצפה: 15:12:12. המונה `answer-20260927` עמד על 48 ב-15:11 (אחרי ה-spawn של 15:12 כנראה 49).
   - היום זה ייעצר כשהמונה יגיע ל-50, כלומר תוך דקות.
   - **ב-00:00 (28.9) המונה מתאפס והלולאה תחזור**, כ-50 ריצות ביום, כל יום, עד שמישהו יסגור את `62dc162c`. **INFERRED** מהקוד, ודאות גבוהה.
   - תופעת לוואי: אחרי שהלולאה ממצה את התקרה, בערך ב-03:30, **כל verdict של כל תפקיד אחר נדחה לשארית היום** (`break` ב-`scheduler.mjs:353`). זו בדיוק ההרעבה שהתקרה הנפרדת נבנתה למנוע ב-30.7.
3. **ה-restart וה-reboot לא גרמו לבעיה.** **MEASURED.** ה-markers יושבים על הדיסק. אחרי restarts ב-12:53, 13:09, 13:51 ו-14:12 הקצב נמשך בלי שינוי.
4. **הספירה האמיתית היא 48 spawns, לא 61.** **MEASURED.** מתוכם 39 ריצות בפועל ו-9 שנדחו על ה-lock.
   - עלות: $22.99 היום. יום ראשון רגיל עולה $1–2.
   - בקשת ה-fyi ‏`c5098e27` אבחנה את הבעיה לא נכון: היא כתבה "cron" ו-"61".
5. **ההמלצה הדחופה ביותר: לעצור לפני חצות.**
   - **הדרך היחידה שאומתה לעצור בלי שינוי קוד:** `"enabled": false` ל-social-manager ב-`.claude/fleet/fleet.json`. ה-answer-watcher מדלג על תפקיד מושבת (`scheduler.mjs:301`), והשינוי נקלט תוך 60 שניות.
   - הבעלים **לא יכול** לשחרר את `62dc162c` מ-/admin/fleet: `answerFleetRequest` (`src/lib/data/admin/fleet.ts:222-248`) קורא ל-`fleet_answer_request`, שמקבל רק בקשות `pending`. **MEASURED.**
   - גם תשובה ל-`5bb80831` לא תצרוך את `62dc162c`. היא רק תוסיף verdict שני לתור.
   - ה-payload של `62dc162c` קפוא, ולכן אי אפשר להוסיף לו `facts_source` בדיעבד.
   - אחר כך מתקנים את ה-scheduler (§4.2, תקרת ניסיונות לכל verdict) ומגדירים יציאה חוקית (§4.3). רק אחרי זה מחזירים `enabled: true`.

---

## 1. סיבת השורש

### 1.1 איך תפקיד מופעל: שלושה מסלולים נפרדים (`.claude/fleet/bin/scheduler.mjs`)

| מסלול | קוד | dedup | תקרה |
|---|---|---|---|
| Slot מתוזמן | `tick()` ‏:104-159 | marker קבוע `slot-<role>-<date>-<hhmm>` (:129-130), כלומר ריצה אחת ל-slot, לנצח | `daily_run_cap` (14) משותף |
| Reactive (inquiry-watcher) | `inquiryWatcherTick()` ‏:412-478 | cooldown של 4 דק' לכל תפקיד (`REACTIVE_COOLDOWN_MS` ‏:254) | `daily_run_cap` משותף |
| **Answer-watcher** | `answerWatcherTick()` ‏:277-367 | **cooldown של 4 דק' לכל verdict** (`VERDICT_RETRY_COOLDOWN_MS` ‏:264, :327-331) | **`answer_daily_run_cap` (50), נפרד** (:350-354) |

**MEASURED:**
- ה-slot של social-manager (`"time":"11:30","days":"0"`, fleet.json) נורה פעם אחת בדיוק. ראיות: `locks/slot-social-manager-20260927-1130`, ו-`count-20260927 = 8` לכל ה-fleet היום.
- "חלון 30 דק'" בכלל אינו חלון תזמון. זה `timeout_minutes: 30`, שמשמש רק ל-`timeout` של ריצה בודדת (`run-role.sh:109,139`). אין בקוד מושג של חלון.

### 1.2 הראיה: לוג pm2 **MEASURED**

```
11:30:43 spawning social-manager                                   ← slot
11:56:44 answer-watcher: spawning social-manager to consume "אצוות סושיאל שבועית לאישור"   ← e6769c72, לגיטימי
11:57:44 answer-watcher: ... "…ההערה הקטנה…"  +  "…תשובה אחת…" (אותו tick; אחד מהם נדחה על ה-lock)
12:01:44 / 12:06:44 אותם שניים (0acf38d9 פורסם והושלם ב-12:08)
12:11:44 → 15:12:12  "🔴 פרסום בפועל: אינסטגרם — ההערה הקטנה…" כל 4–5 דק' ברצף
```

- כל spawn מ-11:56 ואילך הוא answer-watcher.
- מ-12:11 כולם עבור verdict אחד: `62dc162c-7425-4801-9bf1-bf01901acec9`.
- ה-marker `locks/verdict-62dc162c-…` מתעדכן בכל spawn. חותמת הזמן האחרונה שנצפתה: 15:07:12.

### 1.3 למה ה-verdict לא יוצא מהתור לעולם

`cmdVerdicts` (`scripts/fleet-agent-cli.ts:828-838`) מחזיר כל שורה בסטטוס `approved`/`denied`/`answered` עם `consumed_at IS NULL`. **MEASURED:** נכון ל-15:11, `62dc162c` הוא ה-verdict היחיד שמחכה בכל ה-fleet.

כל היציאות מהמצב הזה חסומות:

| יציאה | למה חסומה | ראיה |
|---|---|---|
| `publish-social` (הצלחה, ואז `complete`) | ה-validator דוחה את "תמיד" ב"אישור הגעה זה **לא תמיד** רק כן או לא". ה-ledger נמצא ב-`failed`, ‏`attempt_count=2`, ‏`PUBLISH_RETRY_CEILING=2`. | `src/lib/fleet/publish-social.ts:124` (`SUPERLATIVE_WORDS=['הכי','תמיד','בטוח']`), ‏:444. שורת `fleet_social_posts` ‏`860f3c07`: ‏`error="caption contains a price/promise pattern (superlative ("תמיד"))…"` **MEASURED** |
| `ack` (מעבר ל-consumed) | הקוד מסרב: `assertNotPublishSocialVerdict` | `fleet-agent-cli.ts:938-962`, נוסף ב-`0cc1636` (1.9). הריצה של 13:40 ניסתה `ack` ונדחתה. **MEASURED** |
| `complete` על כישלון | ה-prompt אוסר ("**לעולם לא** `complete` על כישלון") | `roles/social-manager.md:160-163` |
| expire | ה-sweep מעדכן רק `pending` | `src/lib/fleet/expire.ts:37-38` (`.eq('status','pending')`) |
| תשובת בעלים | השאלה `5bb80831` ממתינה מ-12:09 | query ל-`fleet_requests` **MEASURED** |

**מה ה-DB מתיר:** ה-guard מתיר שני מעברים מ-`approved`:
- `approved → completed` (`20260727000620_fleet_requests_completed_status.sql:99`).
- `approved → consumed` (:112, ושדות ה-verdict קפואים).

כלומר, החסימה כולה בשכבת ה-CLI וה-prompt, לא ב-DB. **MEASURED.**

### 1.4 מה השתנה ומתי

**MEASURED** מ-git:
- `7465ab6` (31.8, "stop a lock-skipped answer-watcher spawn stranding a verdict forever") החליף את ה-marker הקבוע (`writeFileSync(marker,'spawned')` + `if (existsSync(marker)) continue;`) ב-cooldown מבוסס timestamp. אין שום תקרה לכל verdict.
- ההנחה בהערה של ה-commit (:318-326) היא שהריצה תמיד תצרוך את ה-verdict. היא לא צפתה verdict שהתפקיד **אינו מסוגל** לצרוך.
- `0cc1636` (1.9) הוסיף את סירוב ה-ack.
- `PUBLISH_RETRY_CEILING` קיים מ-`fdb7b8e` (12.8).

הלולאה נוצרה מהצירוף של שלוש הגנות, שכל אחת מהן נכונה בפני עצמה:
- retry ב-scheduler בלי תקרה,
- סירוב ack,
- תקרת retry ב-publish.

**INFERRED.**

### 1.5 האם זה קרה בעבר? האם זה משותף לתפקידים אחרים?

**MEASURED:** ספירת `started` ב-`runs/index.ndjson`:

- **social-manager, ימים עם יותר מריצה אחת:**
  - 23.8: 6 ריצות, $4.36
  - 31.8: 7 ריצות, $5.97
  - 12.8, 16.8, 30.8, 6.9: 2 ריצות בכל יום
  - 27.9: **39 ריצות, $22.99**
- **31.8 ו-23.8 לא היו לולאה.** ב-pm2 כל כותרת נשלחה 1–2 פעמים. אלה היו ימים עם הרבה verdicts שונים.
- **27.9 הוא המקרה הראשון** של verdict אחד שנשלח שוב ושוב.
- **support-drafter, 14–15 ריצות ביום (26.8, 1.9):** המסלול הוא reactive (`contact_messages_new`), שחסום ב-`daily_run_cap=14`. זה מנגנון אחר, והוא חסום כמו שצריך. **MEASURED** בחלקו: 3 שורות `"reactive"` ב-1.9, ושאר ה-spawns ב-pm2 הם `inquiry-watcher`.
- **החולשה משותפת לכל תפקיד שאינו `auto_ack`.** כל verdict שהתפקיד לא יכול או לא ירצה לצרוך ייכנס לאותה לולאה. **INFERRED** מהקוד.

### 1.6 Restart, deploy ו-reboot

**MEASURED:**
- ב-pm2 מופיעות הודעות `starting` ב-12:53, 13:09, 13:51 ו-14:12 (reboot). אחרי כל אחת הקצב נמשך. אחרי ה-reboot ה-spawn הגיע תוך 7 שניות (14:12:18), כי ה-marker היה בן יותר מ-4 דקות.
- ה-scheduler לא שומר בזיכרון שום מצב שקובע את התזמון. רק `inFlightAcks` ו-`lastKillswitchState` נשמרים בזיכרון, ושניהם לא רלוונטיים.
- מסקנה: ה-restarts לא יצרו את הבעיה ולא האיצו אותה.

### 1.7 בעיות נלוות

- **שני spawns באותו tick לאותו תפקיד** (11:57:44 ו-12:01:44): אחד מהם תמיד נדחה על ה-lock ובכל זאת מחויב בתקרה (9 דחיות lock היום). **MEASURED.**
- **נראוּת (observability):** spawn של answer-watcher לא כותב `indexLine` (`scheduler.mjs:356-365`, בניגוד ל-:135 ול-:467).
  - ב-`index.ndjson` אי אפשר להבדיל בין ריצת verdict לריצה מתוזמנת. **MEASURED.**
  - ה-prompt של הריצה לא מקבל את סיבת ה-spawn: `run-role.sh` מקבל רק `<role>`, ו-`run-context.sh` לא יודע מה העיר אותו.
  - לכן התפקיד "אבחן" cron. **MEASURED.**
- **נעילה גלובלית:** 38 ריצות מיותרות החזיקו את ה-flock הגלובלי (`run-role.sh:126-130`), בערך 60–480 שניות כל אחת.
  - slot מתוזמן של תפקיד אחר שייפול בזמן ריצה כזו יאבד **לצמיתות**, כי ה-marker שלו קבוע.
  - היום זה לא קרה: fleet-maintainer ב-13:00 רץ. **MEASURED.**
  - הסיכון קיים בכל לילה שהלולאה פעילה. **INFERRED.**

---

## 2. התפקיד עצמו

| נושא | פירוט |
|---|---|
| מטרה | טיוטות סושיאל בעברית (IG/FB/TikTok), כיתוב + HTML שמרונדר ל-PNG, ובקשות פרסום לבעלים. `roles/social-manager.md:3-5` |
| Tier / מודל | Tier 0, ‏sonnet, ‏timeout 30 דק'. reactive: `owner_direct_request`, ‏`goal_due`. fleet.json |
| כלים | `render-image` (Puppeteer מקומי), `request`, `ack`, `complete`, `publish-social`. אין רשת ואין `.env`. ‏:13-39, :179-185 |
| קלט | `docs/marketing/BRAND.md`, ‏`.fleet-logs/drafts/social/*`, ‏`poll` (inbox/verdicts/open) |
| פלט | `drafts/social/<YYYYMMDD>-batch/post-N.{md,html,-image.png}`, ‏`PUBLISHED.md`, summary, בקשות מסוג approval/publish_social/fyi/question |
| ערוצי בקשה | approval לאישור תוכן שבועי; approval עם `payload.action=publish_social` (`--request-key publish-<batch>-<N>-<platform>`); fyi על כישלון; question על כישלון שני |

### 2.1 מה הושג ב-30 הימים האחרונים (28.8–27.9) **MEASURED**

- **5 פרסומי Instagram הצליחו** (`fleet_social_posts`):
  - 30.8: שני פוסטים
  - 1.9: פוסט אחד
  - 7.9: פוסט אחד
  - 27.9: פוסט אחד (`0acf38d9`, 20260920 post-2)
- **כישלון אחד**: `62dc162c`.
- **אצוות:** 20260830, 20260906, 20260913, 20260920, 20260927. אצווה אחת בשבוע, 2 פוסטים בכל אחת.
- **בקשות שפגו בלי מענה:** 20260913 (תוכן, post-1, post-2), 20260920 (תוכן), 20260906 post-1, ‏20260816 post-1 v2. חלק ניכר מתור האישור פג לפני שהבעלים הגיע אליו.
- **עלות:** $37.11 ב-30 יום, ומתוכם $22.99 היום לבד. הלולאה עצמה מתחילה ב-12:11: ‏36 ריצות, בערך $19.27. הריצות של 11:56 ו-12:06 היו עבודה לגיטימית ולא נספרות בה.
  - יום ראשון רגיל: $1–2.
  - אם `cost_usd` הוא ערך "שווה-API" תחת token מנוי, העלות היא ניצול מכסה ולא חיוב ישיר. **INFERRED.**
  - אם הלולאה תימשך: בערך $25–30 ליום (50 ריצות × ~$0.55). **INFERRED.**
- **אחוז ריצות "ללא שינוי" היום:** 35 מתוך 39 (~90%). רק 11:30, 11:56 ו-12:06 עשו עבודה, ועוד 12:37 שניסה publish וקיבל אותו כישלון.

### 2.2 פערים ידועים

1. **PUBLISHED.md נכתב לכל אצווה ולא לכל פוסט.**
   - 20260920: post-2 פורסם ו-`PUBLISHED.md` נכתב, אבל post-1 (`d826fec6`) עדיין pending.
   - לפי `roles/social-manager.md:111-114`, "אצווה עם PUBLISHED.md — סגורה לנצח". סעיף 3 (:121-126) מדבר על פוסטים.
   - הסתירה בין השניים גורמת ל-post-1 להיתקע. **MEASURED** ב-summary של 15:07.
2. **מלכודת ack.** בקוד יש כעת סירוב, וזה מונע נזק. אבל זה גם אחד משלושת הרכיבים של הלולאה (§1.3).
3. **false-positive של ה-validator על "תמיד".**
   - `includesHebrewWord` לא מבין שלילה ("לא תמיד").
   - ברמת תוכן יש פתרון תקני: `payload.facts_source` לא ריק מעביר את הבדיקה (`publish-social.ts:167`).
   - אבל ה-payload נקבע כשהבקשה נפתחת, ואי אפשר לשנות אותו אחרי האישור.
4. **בקשה כפולה לבעלים היום.** **MEASURED.**
   - `e6769c72` ("אצוות סושיאל שבועית לאישור", batch 20260927) נענתה ב-11:56 ונצרכה (ack) בריצה של 11:56. אחרי consume ה-row כבר לא מראה אם התשובה הייתה approved או denied, אבל הריצה עצמה תיעדה אותה כאישור האצווה.
   - ב-12:10 הריצה של 12:06 פתחה עוד בקשה על אותה אצווה: `ac94a5ab`, עדיין pending.
   - זה סותר את "0 בקשות כפולות" שמופיע ב-summaries.
5. **אבחנה שגויה ב-`c5098e27`:** "cron", "61 ריצות". בפועל answer-watcher ו-48 spawns. **MEASURED.**

---

## 3. איכות ההתנהגות מול הבעלים

**התנהגות תקינה:**
- אחרי 12:37 לא פתח שאלות כפולות.
- לא ביצע `ack` על verdict מאושר. היה ניסיון אחד ב-13:40, והקוד חסם אותו.
- לא ייצר אצווה נוספת.
- פתח fyi אחד בלבד על הלולאה (אחרי ~3 שעות).
- קרא את ה-summary של הריצה הקודמת לפני פעולה (מ-~13:28 ואילך).

**בעיות:**
- הבקשה הכפולה `ac94a5ab` (§2.2.4).
- ניסיונות `publish-social` חוזרים על כישלון דטרמיניסטי (12:37, 12:55, 13:14, 13:28, 14:27–15:03). לפי ה-summary של 15:07, "מוכח ב-14:27/14:32/14:37/14:59/15:03". כלומר, גם אחרי שהלקח נרשם, ריצות חדשות ניסו שוב, כי אין להן זיכרון.
- כל ריצה כתבה עוד פסקה ל-summary היומי. הקובץ `20260927-social-manager-summary.md` ועוד 12 קבצי `-HHMM` הם רעש.

**סתירות ב-prompt:** **MEASURED**

1. `run-context.sh:70-77` (משותף לכל התפקידים) אומר: "קרא `ack` … פעם אחת בלבד, **לפני** שאתה פועל… פנייה ב-verdicts שנשארה answered בסוף ריצה (בלי ack) = לא טיפלת בה. **זה כשל**".
   לעומת זאת, `social-manager.md:147-148, 205-208` אומר: "אושר → **לעולם לא `ack`**".
   ההוראה הכללית מגדירה את ההתנהגות הנכונה ככשל. זה מה שדחף את הניסיון ב-13:40, ומסביר חלק מההיסוס שחזר בכל ריצה.
2. `social-manager.md:160-163` אומר: "נכשל → fyi. כישלון שני → question. **לעולם לא** complete".
   אין הוראה מה עושים **אחרי** ה-question. הריצה "מחכה", אבל ה-scheduler לא יודע שהיא מחכה.
3. `social-manager.md:196-197` ("משפט-הצלחה": "כל כיתוב עם הצעת-ויזואל **כטקסט**") מיושן. הוא סותר את :35-39 ("**מעכשיו** … תרנדר אותו לתמונה").
4. `social-manager.md:43` אומר "ראשון 11:30, חלון 30 דק'". זה נכון רק ל-slot, והתפקיד מסיק ממנו שכל ריצה אחרת היא "תקלת cron".

**ההתנהגות הפסיבית ("רק מתעד")** היא התגובה **הנכונה** בהינתן הכלים שהיו לתפקיד. היא נבעה מכך שאין לו יציאה חוקית, לא מבעיה ב-prompt. **INFERRED.** מה שחסר הוא "פעולה סופית" מוגדרת ל-verdict מאושר שלא ניתן לפרסם (§4.3).

---

## 4. המלצות מתועדפות (לא לבצע ללא אישור)

### 4.1 (P0, היום לפני 00:00) בלימה

- **הבלימה היחידה שאומתה בלי קוד:** `"enabled": false` ל-`social-manager` ב-`.claude/fleet/fleet.json`. נקלט תוך 60 שניות בלי restart (`scheduler.mjs:6`, ‏:301).
  - סיכון: גם ה-slot השבועי ו-owner_direct_request כבויים עד שמחזירים.
  - ביטול: `true`.
  - מאשר: הבעלים.
- **למה חשוב לעשות את זה לפני 00:00:** הלולאה צפויה לרוץ בערך מ-00:00 עד 03:35, עד שתגיע לתקרת 50. ה-slot של qa-runner ב-02:30 נופל בתוך החלון הזה, וה-marker שלו קבוע (`scheduler.mjs:129-140`). אם social-manager יחזיק את ה-flock ב-02:30, ה-qa-runner יידחה על ה-lock וההרצה שלו תאבד לאותו יום. **INFERRED.**
- **ה-UI לא עוזר כאן:** אין ב-/admin/fleet פעולה שסוגרת בקשה בסטטוס `approved`. `fleet_answer_request` מקבל רק `pending` (`src/lib/data/admin/fleet.ts:217-248`). **MEASURED.**
- **תשובה ל-`5bb80831` לבדה לא עוצרת את הלולאה.** אפשר לקבל את הנימוק שבה ולבקש מהתפקיד לפתוח בקשה חדשה עם `facts_source` ו-`request_key` ‏`-r3`. זה מקדם את הפרסום, אבל `62dc162c` נשארת approved-unconsumed. לכן **חייבים גם** את 4.2 או 4.3 לפני שמחזירים `enabled: true`.
- **מעקף ידני (לא מומלץ ללא אישור מפורש):** קריאה ישירה ל-RPC ‏`fleet_consume_request('62dc162c-…')`, שעוקפת את ה-guard של ה-CLI. המעבר חוקי ב-DB (:112), אבל זה בדיוק מה שה-guard נבנה למנוע.
- **לא לעשות:** `auto_ack: true` לתפקיד. כך verdicts מאושרים של publish_social לא יקבלו spawn לפרסום בכלל, ובנוסף ה-CLI מסרב ל-ack.
- **לא לעשות:** לסגור את ה-row ב-SQL ידני. זה עוקף את ה-audit.

### 4.2 (P0) תיקון שורש ב-scheduler: תקרת ניסיונות לכל verdict

הרעיון: לשמור את ה-retry על race של lock (מטרת `7465ab6`), אבל לחסום אותו.

```diff
--- a/.claude/fleet/bin/scheduler.mjs
+++ b/.claude/fleet/bin/scheduler.mjs
@@
 const VERDICT_RETRY_COOLDOWN_MS = 4 * 60_000;
+// A verdict the role cannot consume (e.g. an approved publish_social whose
+// publish hit PUBLISH_RETRY_CEILING — ack is refused, complete is forbidden)
+// must not be re-spawned forever (measured 2026-09-27: 48 spawns of one
+// verdict in 3.5h). After this many spawns, stop and surface it once.
+const VERDICT_MAX_SPAWNS = 3;
@@
     const marker = join(LOCKS_DIR, `verdict-${v.id}`);
+    let prev = { last: 0, n: 0 };
     if (existsSync(marker)) {
-      const last = Number(readFileSync(marker, 'utf8').trim()) || 0;
-      if (Date.now() - last < VERDICT_RETRY_COOLDOWN_MS) continue;
+      const raw = readFileSync(marker, 'utf8').trim();
+      try { prev = raw.startsWith('{') ? JSON.parse(raw) : { last: Number(raw) || 0, n: 1 }; }
+      catch { prev = { last: 0, n: 1 }; }
+      if (prev.stranded) continue;
+      if (Date.now() - prev.last < VERDICT_RETRY_COOLDOWN_MS) continue;
+      if (prev.n >= VERDICT_MAX_SPAWNS) {
+        writeFileSync(marker, JSON.stringify({ ...prev, stranded: true }));
+        log(`answer-watcher: "${v.title}" (${v.role}) still unconsumed after ${prev.n} spawns — STRANDED, not re-spawning`);
+        indexLine({ ts: new Date().toISOString(), role: v.role, stranded_verdict: v.id, spawns: prev.n });
+        continue;
+      }
     }
@@
-    writeFileSync(marker, String(Date.now()));
+    writeFileSync(marker, JSON.stringify({ last: Date.now(), n: prev.n + 1 }));
     log(`answer-watcher: spawning ${v.role} to consume "${v.title}"`);
+    indexLine({ ts: new Date().toISOString(), role: v.role, verdict_spawn: v.id, attempt: prev.n + 1 });
     bumpDailyCount(now.dateKey, 'answer');
```

ובנוסף: **spawn אחד לכל תפקיד בכל tick** בתוך `answerWatcherTick`. מחזיקים `Set` של תפקידים שכבר קיבלו spawn ב-tick הנוכחי. הריצה עצמה מטפלת בכל ה-verdicts של התפקיד דרך `poll`, ולכן spawn שני באותו tick תמיד מבוזבז (§1.7).

- **סיכון:** נמוך. verdict שנדחה על lock שלוש פעמים ברצף יסומן stranded. אבל ה-marker נכתב כך שקל לאפס אותו (מחיקת הקובץ), וה-`indexLine` מאפשר ל-fleet-maintainer ול-chief-of-staff לראות אותו.
  - תאימות לאחור: markers ישנים (מספר בלבד) נקראים כ-`n=1`.
- **ביטול:** `git revert`. אין מיגרציה ואין מצב DB.
- **בדיקות:** unit על פענוח ה-marker (ישן, JSON, פגום); בדיקה מקומית עם `dry_run`.
- **מאשר:** הבעלים. זה שינוי תשתית fleet, ולפי CLAUDE.md "cross-cutting" דורש תוכנית ואישור.

### 4.3 (P1) יציאה חוקית ל-verdict של פרסום שלא ניתן לבצע

ה-DB כבר מתיר `approved → consumed` ו-`approved → completed` (§1.3). שתי חלופות:

- **(א) מועדפת:** להרשות `ack` על verdict מאושר של publish_social **רק** כשב-`fleet_social_posts` יש שורה ל-request_id עם `status='failed'` ו-`attempt_count >= PUBLISH_RETRY_CEILING`.
  - זה שינוי ב-`assertNotPublishSocialVerdict` (`fleet-agent-cli.ts:938`).
  - ה-ack-trap המקורי (ack **לפני** ניסיון פרסום) נשאר חסום.
- **(ב)** verb חדש `abandon-publish --id --reason-file`. הוא מבצע consume ופותח fyi עם הסיבה.
- **בנוסף**, להוסיף ל-`social-manager.md` §"טיפול ב-verdict" שלב סופי: "תקרה מוצתה → `ack` (מותר רק במצב הזה) + question אחד". כך ה-verdict יוצא מהתור וההחלטה עוברת לבעלים דרך בקשה חדשה.
- **סיכון:** בינוני-נמוך. זה מקל על הגנה שנבנתה אחרי שתי תקריות, ולכן התנאי חייב לבדוק את ה-ledger ולא רק את הזמן.
- **ביטול:** revert.
- **מאשר:** הבעלים.

### 4.4 (P1) ה-validator: שלילה והקשר

- להוסיף ל-`scanGroundingClaims` פטור ל"לא תמיד", "לא הכי" ו"לא בטוח" (מילת שלילה צמודה לפני המילה).
- או לפחות לפרט ב-`social-manager.md` §4 ש-`facts_source` חובה כשהכיתוב מכיל את אחת המילים האלה, כדי שהבעיה תיפתר **לפני** האישור.
- בדיקות: `publish-social.test.ts`.
- סיכון: נמוך. ההגנה הזו רק משלימה את הבדיקה של brand-director.
- מאשר: הבעלים.

### 4.5 (P1) עדכוני prompt

1. **`run-context.sh:70-77`:** להוסיף חריג מפורש: "תפקיד שה-prompt שלו מגדיר חריג ל-ack (למשל publish_social מאושר) — ה-prompt של התפקיד גובר". כרגע ההוראה הכללית מגדירה את ההתנהגות הנכונה ככשל.
2. **`run-role.sh`/`run-context.sh`:** להעביר את סיבת ה-spawn (`slot` / `reactive:<trigger>` / `verdict:<id>, attempt N`) כארגומנט שני, ולהציג אותה תחת "הקשר ריצה". כך התפקיד לא יאבחן "cron" ויֵדע איזה verdict העיר אותו.
3. **`social-manager.md`:**
   - לעדכן את "משפט-הצלחה" (:196-197) ל-HTML+PNG.
   - ב-:43 להבהיר שיש 3 מסלולי הפעלה.
   - לפתור את הסתירה בין PUBLISHED.md לכל אצווה לבין פוסטים (:111-126): הכלל צריך להיות לכל פוסט, למשל `PUBLISHED.md` עם שורה לכל פוסט, כשרק שורה קיימת פוטרת את **אותו** פוסט.
   - לפני פתיחת "אצוות סושיאל שבועית לאישור", לבדוק ב-poll/history אם כבר קיימת בקשה (גם consumed) על אותה אצווה.
   - להפסיק לצבור פסקאות ב-summary יומי אחד: ריצה חוזרת ללא שינוי תכתוב שורה אחת.
- סיכון: נמוך (טקסט).
- ביטול: revert.
- מאשר: הבעלים. `run-context.sh` משותף לכל התפקידים, ולכן בודקים שה-diff לא משנה התנהגות של אחרים.

### 4.6 (P2) ניטור ובדיקות fleet-maintainer

היום fleet-maintainer (13:00) בדק רק את 8 הערכים ב-`known-issues.json` (summary היומי) ולא הסתכל על `index.ndjson` או על pm2. grep ל-"schedul|index.ndjson|runaway" ב-`roles/fleet-maintainer.md` לא מחזיר כלום. **MEASURED.**

הצעות:

- **בדיקה חדשה ב-`fleet-maintainer.md`:** לכל תפקיד, מספר ה-`started` היום ב-`index.ndjson` לעומת (מספר ה-slots + 3). חריגה פותחת fyi עם הספירה.
  - אחרי 4.2, לבדוק גם שורות `stranded_verdict` ו-`verdict_spawn` עם `attempt>=2`.
- **התראה בזמן אמת ב-scheduler עצמו:** כשתפקיד עובר N spawns (למשל 10) ביום, לשלוח `log` ו-indexLine פעם אחת. fleet-maintainer רץ פעם בשבוע, ולכן לא יכול להיות קו ההגנה הראשון.
- **תקרה לכל תפקיד ב-answer-watcher** (למשל 10 ביום), בנוסף לתקרה הגלובלית של 50. כך תפקיד אחד תקוע לא ירעיב את כל השאר.
- **chief-of-staff digest (17:30):** להוסיף שורה "ריצות לפי תפקיד היום". הנתון כבר קיים ב-`index.ndjson`.
- סיכון: נמוך.
- מאשר: הבעלים. `fleet-maintainer` הוא Tier 2, ובקשת הבדיקה עצמה היא שינוי prompt.

### 4.7 (P2) ניקוי

- להחליט על `ac94a5ab` (בקשה כפולה) ועל `c5098e27` (fyi עם אבחנה שגויה). הבעלים סוגר אותן, או שהתפקיד מבצע `withdraw` ל-`ac94a5ab` כ-superseded.
- להחליט על `d826fec6` ו-`f7142be9` (publish pending).
- מאשר: הבעלים.

---

## 5. נספח: ראיות גולמיות

- **ספירות היום** (`.fleet-logs/locks`):
  - `count-20260927=8`
  - `answer-20260927=48` (15:11)
  - `index.ndjson`: 39 `started`, 9 `skipped:lock`, ל-social-manager
- **שעות הריצה** (`runs/20260927T*-social-manager.json`): 113043, 115644, 120644, 121144, 121644, 122144, 122544, 122944, 123344, 123744, 124244, 124644, 125044, 125519, 130519, 131014, 131414, 132214, 132614, 133015, 133514, 134015, 134415, 134915, 135407, 135807, 140207, 140607, 141218, 142212, 142712, 143217, 143712, 144612, 145012, 145512, 145912, 150312, 150712 (ה-spawn של 15:12 עדיין רץ בזמן הכתיבה).
- **עלות ריצה:** ‏11:30 ‏$2.41, ‏12:06 ‏$0.85, השאר ‏$0.26–$1.00. סה"כ $22.99.
- **`fleet_social_posts`:** ‏`860f3c07` (request `62dc162c`) ‏`failed`, ‏`attempt_count=2`. ‏`d191cbe8` (request `0acf38d9`) ‏`published`, ‏`external_post_id 18066689969513636`.
- **בקשות פתוחות של התפקיד:** `d826fec6`, ‏`f7142be9`, ‏`5bb80831`, ‏`ac94a5ab`, ‏`c5098e27` (pending); ‏`62dc162c` (approved, unconsumed).
- **השאילתות** בוצעו דרך `node --env-file=.env.local dist/fleet-agent-cli.cjs sql|verdicts`. זה wrapper לקריאה בלבד. `npm run fleet:agent` לא הורץ, כדי לא לבנות מחדש את ה-bundle ש-kalfa-fleet משתמש בו.
