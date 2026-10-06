# מפת עבודות הרקע (pg-boss) — מטרה, תקינות ואופטימיזציה

תאריך: 2026-09-30. סטטוס: **הושלם** (30.9). קריאה בלבד — לא בוצע שום שינוי.
מקור: קוד ריצה בלבד (worker/main.ts, src/lib/**, node_modules/pg-boss/dist). הערות ותיעוד שימשו כרמז בלבד.
תיוג: MEASURED = נמדד בקוד/בנתונים שסופקו; INFERRED = הסקה.

## ממצאי יסוד (pg-boss 12.33.5)

- כל tick של cron מייצר **2 שורות**: שורה אחת ב-`__pgboss__send-it` ושורה אחת בתור היעד.
  `timekeeper.js:489` מכניס שורת send-it לכל occurrence, ו-`onSendIt` (`timekeeper.js:626-634`) מבצע `send()` לתור היעד. MEASURED (קוד).
- לכן פחות ticks = פחות שורות, ביחס 1:2. MEASURED (קוד). הנתון החי מתאים: 51,369 send-it / 7 ימים ≈ 7,340 ביום, מול סכום ה-occurrences המתוזמנים ≈ 6,800–7,300 ביום. INFERRED (חישוב).
- מחיקה: `plans.js:2582-2592` מוחק שורה שהושלמה כאשר `completed_on + deletion_seconds < now`, ושורה ממתינה כאשר `keep_until < now`. `keep_until = start_after + retention_seconds` (ברירת מחדל 14 יום, `plans.js:85,2010`). MEASURED (קוד).

## נתוני עומס מרכזיים (נמדדו ב-30.9, קריאה בלבד)

- **webhook_inbox:** 167 שורות ב-7 הימים האחרונים. באותה תקופה `webhook-process` רץ 10,195 פעמים, כך שלכל היותר כ-1.6% מהריצות מצאו עבודה. MEASURED (ספירות); היחס עצמו INFERRED.
- **קמפיינים:** 0 קמפיינים במצב `active` או `paused`. לכן בתמונת המצב הנוכחית כל ריצה של `outreach-arm` ו-`outreach-sweeper` מסתיימת אחרי רשימה ריקה. MEASURED.
- **workflows:** 6 פעילים (`is_active`). MEASURED.
- **השהיית polling:** `POLL_MINUTE_CRON = 10s` ו-`POLL_SLOW_CRON = 30s` (`worker/main.ts:902-903`). זה מסביר את ה-wait הממוצע: 4.7s בתורים של כל דקה ו-15s בתורים האיטיים. MEASURED.

## (A) מפת התורים

### קבוצה 1: מנוע השליחה (outreach)

| תור | מטרה (מקוד) | טריגר | פסק דין | נימוק |
|---|---|---|---|---|
| `outreach-arm` | `handleArm` (`worker/main.ts:576-590`) עובר על כל קמפיין פעיל, זורע את `outreach_state` מהסט המוקפא (`seedOutreachState`) ומריץ `ensureCurrentStep` לכל איש קשר פעיל. זה ה-self-heal של הסמן. MEASURED | cron כל דקה (`:1536`) | **לשנות תדירות** | idempotent לפי anchor CAS ו-deterministic ids (`:570-575`). עם 0 קמפיינים פעילים העבודה ריקה. ההפעלה הרגילה של צעד היא job עם `startAfter` (`handleStep`), ו-arm הוא רשת ביטחון. INFERRED: כל 5 דקות מספיק. |
| `outreach-sweeper` | **קורא לאותה פונקציה בדיוק**, `handleArm(boss)` (`:1126-1131`) | cron כל 5 דקות (`:1537`) | **להסיר (כפילות)** | MEASURED: שני תורים מריצים את אותו handler. בכל דקה חמישית handleArm רץ פעמיים. אם `outreach-arm` יעבור ל-*/5, התור הזה מיותר לגמרי. |
| `outreach-step` | `handleStep` (`:351-459`) מבצע צעד אחד לאיש קשר: gate, בדיקת סמן, `planRev` ו-deterministic id, ואז `evaluateStep` → reserve → send → resolve | on demand, `startAfter` | **להשאיר + תיקון קטן** | idempotency: `job.id` חייב להיות שווה ל-`detId`/`deferId` (`:416-420`), ויש reserve/resolve. MEASURED. ראו באג B2. |
| `outreach-dead` | `handleDead` (`:462-…`): dead-letter. טלמטריה ורציפות שרשרת, בלי התאוששות עסקית | on demand (dead letter) | להשאיר | 0 ריצות ב-7 ימים. MEASURED |
| `outreach-call-request` | `handleCallRequest` (`:165`): שיחת AI ל-outreach. משתמש ב-`worker/pgboss-meta.ts` כדי לקרוא `retry_count` ישירות מטבלת ה-job (`:175-177`) | on demand | **לתקן (includeMetadata)** | `work(name, { includeMetadata: true })` מעביר `retryCount` ו-`retryLimit` ל-handler (`pg-boss types.d.ts`, `JobWithMetadata`). כך נחסכים pool נוסף ושאילתה. INFERRED: סמנטיקה זהה. |

### קבוצה 2: נכנסות ו-workflows

| תור | מטרה | טריגר | פסק דין | נימוק |
|---|---|---|---|---|
| `webhook-process` | `handleWebhook` (`:539-…`) תופס עד 50 שורות לא מעובדות מ-`webhook_inbox` ומריץ עליהן לוגיקה כלכלית: reached/billing, RSVP, ו-`startWorkflowRuns` | cron כל דקה (`:1538`), poll 10s | **event-driven + cron דליל** | MEASURED: 167 שורות לעומת 10,195 ריצות. ה-route של ה-webhook לא שולח job (grep על `QUEUES.webhook` ב-src: אין send). הצעה: שה-route (web, `getWebJobSender`) ישלח `webhook-process` עם `singletonKey:'drain'` אחרי persist, ושה-cron יישאר כרשת ביטחון כל 5 דקות. זה גם יקצר את זמן התגובה לתשובת אורח מעד כ-70 שניות לכמה שניות. INFERRED. |
| `workflow-schedule-sweep` | `createScheduledRuns` + `listUndeliveredRuns` + `redeliverStuckWaitingRuns` + `rescueOrphanedWaitingSteps` (`:1162-1188`) | cron כל דקה (`:1541`) | **להשאיר** (הקצב נדרש) | טריגר cron של workflow דורש רזולוציה של דקה. MEASURED: יש 6 workflows פעילים. max 110.6s היה בזמן תקלת DB ב-24.9. |
| `workflow-run` | `handleWorkflowRun` (`:1190-1222`): מריץ גרף שלם. התראה כשריצה נכשלת | on demand, עם singletonKey על ה-send | להשאיר | idempotency: unique `(run_id, node_id)` ו-singletonKey (`:1151-1153`). MEASURED |

### קבוצה 3: sweeps תפעוליים כל 5 או 10 דקות

| תור | מטרה (מקוד) | טריגר | פסק דין | נימוק |
|---|---|---|---|---|
| `campaign-thankyou-sweep` | `runThankyouSweep` (`src/lib/data/auto-thankyou.ts:90`) שולח את התודה האוטומטית לקמפיינים שהגיע זמנם. אם השליחה חסומה, `thankyou_sent_at` לא מסומן. המשימה נחסמת כשמתג ה-outreach כבוי (`worker/main.ts:597-600`) | */5 singleton | להשאיר, או לעבור ל-*/15 | idempotency לפי `claim_thankyou_recipient`. MEASURED. דיוק של 15 דקות מספיק לתודה שנשלחת אחרי האירוע. INFERRED |
| `inquiry-followup-sweep` | `runInquiryFollowupSweep` (`src/lib/data/inquiry-followup.ts:190`): תזכורת, אזהרה וסגירה אוטומטית של פניות שהלקוח לא ענה עליהן. שולח אימייל ומעדכן `contact_messages`. ל-sweep יש kill-switch משלו | */5 singleton | לשנות ל-*/15 או כל שעה | ה-SLA של המעקב נמדד בשעות ובימים. INFERRED |
| `call-callback-sweep` | `runCallbackSweep` (`src/lib/data/call-callbacks.ts:138`): מתזמן שיחות חוזרות שהובטחו, רק בתוך חלון השיחות (`isWithinHumanCallWindow`) | */5 singleton | להשאיר | מחוץ לחלון השיחות הריצה יוצאת מיד. MEASURED |
| `owner-agent-intake-sweep` | `sweep.ts` של ה-owner-agent: שורות intake תקועות או שפגו (`consumer/main.ts:9`) | */5 | להשאיר | רשת ביטחון ל-reply שנשלח on demand |
| `callback-calendar-schedule-sweep` | `runCallbackSchedulingSweep` (`src/lib/data/callback-scheduling.ts:1134`) תחת lock (`worker/main.ts:1320-1331`): משבץ, משחרר ומתקן בקשות callback מול היומן | */10 singleton | להשאיר | כותב לוג רק כשיש שינוי. MEASURED |
| `console-agent-calendar-presence-sync` | `runConsoleAgentCalendarPresenceSync` (`src/lib/data/console-agent-calendar-presence.ts:185`): מסנכרן נוכחות של נציג מול היומן | */10 singleton | להשאיר | |
| `fleet-request-expire-sweep` | `runFleetExpireSweep` (`src/lib/fleet/expire.ts:31`): UPDATE של `status='expired'` לפניות סוכנים שעבר ה-`expires_at` שלהן, והתראת Slack | */10 | **כל שעה** | תוקף הפניות נמדד בימים. דיוק של 10 דקות מיותר. INFERRED |
| `voximplant-call-reconcile`, `voximplant-callback-dispatch-reconcile`, `voximplant-sales-dispatch-reconcile` | שלושה alerters זהים במבנה (`src/lib/data/voximplant-reconcile.ts:102-176`). כל אחד שולף רשומות תקועות מטבלה אחרת (`call_attempts`, `callback_request_attempts`, `sales_call_attempts`) ומתריע. קריאה בלבד. MEASURED | */10, שלושה תורים | **לאחד** | תור אחד `voximplant-reconcile` שמריץ את שלושת ה-`run*` ברצף. ה-alerters נשארים נפרדים, וכך גם ההתראות. |

### קבוצה 4: בדיקות בריאות של ספקים

| תור | מטרה | טריגר | פסק דין |
|---|---|---|---|
| `voximplant-balance-check` | `runBalanceCheck` (`src/lib/data/voximplant-balance.ts:66`): יתרת Voximplant מול סף | */30 | שעה מספיקה. INFERRED |
| `sumit-hold-reconcile` | `runSumitHoldReconcile` (`src/lib/data/sumit-hold-reconcile.ts:67`): מסנכרן `release_status` מתיקיית המסגרות ב-SUMIT (1→3) | */30 | להשאיר. יש 0 מסגרות פתוחות, והשאילתה יוצאת מוקדם. MEASURED |
| `whatsapp-health-check`, `email-health-check` | `src/lib/whatsapp/run-health-check.ts:140`, `src/lib/email/run-health-check.ts:79`: בדיקת ספק (Meta / Resend) | שעתי | להשאיר |
| `elevenlabs-quota-check` | `src/lib/data/elevenlabs-quota.ts:162` | כל 6 שעות | להשאיר |
| `extra-key-check`, `sumit-health-check` | `src/lib/sms/run-key-check.ts:35`, `src/lib/sumit/run-health-check.ts:27` | יומי | להשאיר |
| `graph-intake-subscription-renew` | `runGraphIntakeSubscriptionSweep` (`src/lib/data/inquiry-mail-intake.ts:319`): חידוש subscription של Microsoft Graph | כל 6 שעות, singleton | להשאיר. המנוי חי כ-2.9 ימים |
| `instagram-token-refresh` | `src/lib/data/instagram-token-refresh.ts:290` | שבועי | להשאיר |

### קבוצה 5: תחזוקה יומית ושבועית

| תור | מטרה | טריגר |
|---|---|---|
| `whatsapp-template-health-sync` | עותק של תבניות Meta ובדיקת בריאות שלהן (`src/lib/data/template-health-sync.ts`) | יומי 03:35 |
| `call-dispatch-retention` | DELETE מ-`call_dispatch_status` לשורות מעל 30 יום (`src/lib/data/call-dispatch-status.ts:271`) | יומי |
| `auth-phone-change-cleanup` | `rpc('purge_stale_phone_change')` (`src/lib/data/auth-phone-change-cleanup.ts:24`) | יומי |
| `voximplant-log-export` | ייצוא לוגים של שיחות, כתיבה ל-`vox_log_exports` (`src/lib/data/vox-log-export.ts:248`) | יומי, singleton |
| `agreement-archive-sweep` | העתקת הסכמים חתומים ל-SharePoint, העתקה בלבד (`src/lib/data/agreement-archive.ts:369`) | יומי, singleton |
| `unconfirmed-cleanup-sweep`, `signup-reminder-sweep` | ניקוי הרשמות שלא אומתו, ותזכורת אימות (`unconfirmed-signup-cleanup.ts:70`, `signup-confirmation-reminder.ts:82`) | יומי |
| `owner-agent-retention` | מחיקת טקסט אחרי 7 ימים ו-sessions אחרי 14 (`consumer/main.ts:10`) | יומי |
| `archive-maintenance-sweep` | בדיקת fixity לארכיון (`archive-maintenance.ts:167`) | שבועי |
| `supabase-cli-update` | עדכון של ה-CLI (`src/lib/ops/supabase-cli-update.ts:68`) | שבועי |
| `archive-backup-sweep` | snapshot חודשי (`archive-backup.ts:115`) | חודשי, 1 בחודש |

**פסק דין לקבוצה 5:** להשאיר את כולם. הם זולים (שורה אחת ביום), ו-idempotent לפי singleton או lock. MEASURED (policy).

### קבוצה 6: on demand

- `owner-agent-reply`, `owner-agent-report`: ה-reply מריץ את מודל הסוכן, בממוצע כ-20 שניות. ה-policy נקבע ב-`updateQueue` (`consumer/main.ts:142-143`).
- `meeting-confirm-dispatch`, `sales-call-dispatch`: חיוג (`worker/main.ts:236`, `:262`).

כולם להשאיר.

## (B) באגים

**B1. בדיקת "משימה תקועה" מתנגשת בזמן השמירה (MEASURED בלוגיקה).**
- `isQueueStale` (`src/lib/ops/summary.ts:94-115`) קורא את `lastCompletedOn` מתוך `max(completed_on)` של טבלת ה-jobs, דרך `ops_job_health` (מיגרציה `20260910123341…sql:172`).
- משימה שהושלמה נמחקת אחרי 7 ימים (`deletion_seconds=604800`, נמדד), ואז `lastCompletedOn` חוזר null. הבדיקה נופלת ל-`firstFireAfterRegistration`, שמחזיר את מועד הרישום של ה-schedule, והוא עבר מזמן. התוצאה: **stale**.
- **`archive-backup-sweep` (חודשי, allowance של 40 יום):** אדום מהיום השמיני אחרי כל ריצה ועד הריצה הבאה, כלומר כ-23 ימים בחודש. INFERRED מהלוגיקה.
- **שבועיים** (`supabase-cli-update`, `archive-maintenance-sweep`, `instagram-token-refresh`): הבאדג' מהבהב בחלון קצר סביב היום השביעי, כי השורה נמחקת בערך באותו זמן שהריצה הבאה צריכה לקרות. INFERRED.
- **תיקון:** לקרוא את הריצה האחרונה מ-`pgboss.schedule` (`Schedule.lastJobId` ו-`getSchedules()`, הרשמי) ולא מטבלת ה-jobs, או להשאיר לתורים האלה `deleteAfterSeconds` ארוך מה-allowance שלהם.
- **תנאי:** זה חייב לקרות לפני שמקצרים retention (C1). אחרת כל התורים יהפכו אדומים.

**B2. job של צעד בזמן שמתג ה-outreach כבוי נשאר ב-re-poll כל 5 דקות לעולם, גם לקמפיין סגור (MEASURED בקוד, ההשפעה INFERRED).**
- `stepGate` (`src/lib/data/outreach-engine.ts:249`) בודק קודם את `getOutreachEnabled()` ומחזיר `'paused'`, **לפני** שהוא בודק אם הקמפיין סגור (`:256`).
- `handleStep` שולח על `'paused'` poll job חדש עם `startAfter: 300` (`worker/main.ts:357-360`, `:373-376`).
- **המקרה הקונקרטי:** 2 ה-jobs היתומים של `outreach-step` (נוצרו ב-2.9 עם `start_after` ל-30.11) הם של קמפיינים סגורים.
  - אם ב-30.11 המתג דלוק: הם יסתיימו ב-`'stopped'`, ו-`setOutreachStatus(...,'stopped','closed')` ירוץ. זה בלתי מזיק. MEASURED.
  - אם המתג כבוי: כל אחד מהם יוליד שורה חדשה כל 5 דקות (288 ביום לכל job) עד שהמתג יודלק.
- **תיקון:** להחליף את הסדר ב-`stepGate`, כך שבדיקת קמפיין סגור או חסר תבוא לפני בדיקת המתג. אפשר גם לבטל את 2 ה-jobs היתומים (`boss.cancel`) אחרי אישור.

**B3. כפילות: `outreach-sweeper` ו-`outreach-arm` מריצים את אותו `handleArm` (MEASURED).** `worker/main.ts:1119-1131`. בכל דקה חמישית העבודה רצה פעמיים. זה בטוח בזכות idempotency, אבל בזבזני.

**B4. `seo-technical-watch`** נכשל כל שבוע, כי הועברו שני מקורות הרשאה. **תוקן ב-30.9** (מחוץ לדוח הזה).

**B5. אזהרות של pg-boss לא מתריעות (MEASURED).**
- ב-`worker/main.ts` יש רק `on('error')` (`:964-974`), ואין `on('warning')`.
- אזהרת ה-`monitor_backoff` חזרה שוב ושוב מאז 27.9 בלי שאף אחד קיבל עליה התראה.

## (C) אופטימיזציות לפי סדר עדיפות

**בסיס:** כל tick של cron = 2 שורות (`timekeeper.js:489`, ואז send לתור היעד). היום יש כ-6,790 ticks ביום, כלומר כ-13,600 שורות ביום. ב-retention של 7 ימים זה כ-95 אלף שורות, בהתאמה ל-101 אלף שנמדדו. החישוב INFERRED, הקוד MEASURED.

| # | שינוי | ticks/יום שנחסכים | שורות/יום | סיכון |
|---|---|---|---|---|
| 1 | להסיר את `outreach-sweeper` (B3) | 288 | -576 | נמוך. `outreach-arm` מכסה את אותה עבודה |
| 2 | `outreach-arm` מכל דקה לכל 5 דקות | 1,152 | -2,304 | נמוך-בינוני. arm הוא self-heal, וההפעלה הרגילה של צעד היא `startAfter`. צריך לוודא שהפעלת קמפיין חדש לא מחכה לזריעה (`seedOutreachState` רץ רק מה-arm, `worker/main.ts:582-584`). אחרת עד 5 דקות עיכוב בהתחלה. חלופה: send חד-פעמי של arm מתוך הפעלת הקמפיין |
| 3 | `webhook-process` הופך ל-event-driven: ה-route שולח עם `singletonKey`, וה-cron יורד לכל 5 דקות | 1,152 פחות כ-24 sends | כ-(-2,280) | בינוני. צריך שינוי ב-route של ה-webhook ב-web. מרוויחים גם זמן תגובה מהיר יותר לתשובות של אורחים |
| 4 | איחוד 3 ה-reconcilers של Voximplant לתור אחד | 288 | -576 | נמוך |
| 5 | `fleet-request-expire-sweep` לכל שעה, ו-`inquiry-followup-sweep` ו-`campaign-thankyou-sweep` לכל 15 דקות | 120+192+192=504 | -1,008 | נמוך. לבדוק את SLA ה-follow-up |
| 6 | `voximplant-balance-check` לכל שעה | 24 | -48 | נמוך |
| 7 | **retention:** `updateQueue(name, { deleteAfterSeconds: 86400 })` לתורים התכופים, כולל `__pgboss__send-it`. ל-`updateQueue` אין הגנה על שמות פנימיים, רק `assertObjectName` (`manager.js:1860`, `attorney.js:543`). MEASURED | — | מקטין את הטבלה מכ-7 ימים ליום אחד | **תלוי ב-B1.** השמירה על היסטוריה לצורך איתור תקלות מתקצרת ליום אחד |
| 8 | `includeMetadata` במקום `worker/pgboss-meta.ts` | — | — | נמוך. חוסך pool ושאילתה |
| 9 | `on('warning')` שמתריע ל-Slack (B5) | — | — | נמוך |

**סך הכול, סעיפים 1–6:** כ-3,390 ticks פחות ביום, כלומר **כ-6,790 שורות פחות ביום, בערך מחצית**. INFERRED.
**עם סעיף 7** (שמירה של יום אחד לתורים התכופים): גודל הטבלה במצב יציב יורד מכ-95 אלף לכ-7–10 אלף שורות. INFERRED.

## (D) אי-ודאויות

- לא ניתן למדוד כמה ריצות של כל sweep מצאו עבודה. אף handler לא מחזיר output (`output` null), ולוגים נכתבים רק כשיש שינוי. המדידה היחידה היא דרך ספירות בטבלאות המקור, כמו `webhook_inbox` ומספר הקמפיינים הפעילים.
- האם `updateQueue` על `__pgboss__send-it` נשמר אחרי restart: לפי `timekeeper.js:223`, `createQueue` רץ שוב. INFERRED שהוא לא דורס תור קיים, כי ככה `createQueue` מתנהג לגבי התורים שלנו. צריך לאמת אחרי ה-restart הראשון.
- חשבון החיסכון מניח ש-send מתוך ה-route יוצר שורה אחת בלבד, בלי send-it. INFERRED מהקוד.
- לא נבדקה הלוגיקה של שלושת השלבים ב-`inquiry-followup` (תזכורת, אזהרה, סגירה) באותו tick.
