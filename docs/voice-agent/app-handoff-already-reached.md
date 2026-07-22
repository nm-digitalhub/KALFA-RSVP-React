# Handoff — חוויית already_reached באפליקציית הקונסולה

> **תאריך:** 2026-07-22 · **מצב פריסה:** צד DB — פרוס ופעיל · צד שרת
> (route/worker) — **פרוס ופעיל** (deploy `mrwfoluv`, אומת בריצה: route עונה,
> worker עלה, תור ה-retention רשום) · צד Android — **טרם מומש**. מסמך זה הוא
> המפרט המחייב למימוש צד ה-Android (ריפו `nm-digitalhub/KALFA-ELEVENLABS`).
> משלים את `app-integration-reference.md` (גרסה 2026-07-22b) — שם החוזה הטכני
> המלא; כאן מיפוי ההתנהגות וההודעות.

## מה השתנה בשרת

1. **`console_event_guests`** — ארבעה שדות חדשים לכל אורח:
   `reached_at` · `callback_scheduled_at` · `can_start_outreach_call` ·
   `call_block_reason` (`'already_reached'` | `'callback_scheduled'` | `null`).
   מחושבים לפי `(event_id, contact_id)` בלבד — אותו איש קשר באירוע אחר עדיין
   ניתן לחיוג.
2. **Preflight בנתיב החיוג** — `POST /api/events/{eventId}/outreach-call`
   עונה `409 { code: "already_reached" }` מיידית לאיש קשר שכבר הושג, בלי
   ליצור job.
3. **`call_dispatch_status`** — טבלת Realtime חדשה: שורה לכל בקשת חיוג ידני,
   נוצרת `accepted` לפני ה-202 ומיושבת על-ידי ה-worker לערך סופי. זהו ערוץ
   האמת אחרי 202 (בעבר לא היה כזה בכלל).

## כלל כפתור החיוג

```
dial_enabled = dialable AND has_active_campaign AND can_start_outreach_call
```

| מצב | התנהגות |
|---|---|
| `call_block_reason = 'already_reached'` | כפתור **מושבת**. מציגים **"כבר נוצר קשר באירוע זה"** + הסבר קבוע ונגיש (ראו "נגישות") |
| `call_block_reason = 'callback_scheduled'` | כפתור **מושבת**. מציגים את מועד `callback_scheduled_at` ("שיחת החזרה תתבצע אוטומטית ב-…"). רק מסלול ה-callback האוטומטי יחייג |
| שניהם `null` אך `dialable=false` / אין קמפיין פעיל | ההתנהגות הקיימת (ללא שינוי) |

- **אין override ידני.** אין להוסיף שום מנגנון עקיפה; החריג היחיד הוא callback
  שהאורח ביקש, והוא מטופל אוטומטית בשרת.
- callback טקסטואלי בלי מועד ("מחר בערב") **אינו** חוסם — `callback_scheduled_at`
  יהיה `null` והחיוג הידני מותר (זו הדרך היחידה לחייג אליו).

## מחרוזות קבועות (עברית)

| מפתח | טקסט |
|---|---|
| `already_reached_title` | כבר נוצר קשר באירוע זה |
| `already_reached_explain` | עם אורח שכבר נוצר עמו קשר באירוע לא ניתן ליזום שיחה נוספת, כדי למנוע הטרדה וחיוב כפול. |
| `callback_scheduled` | האורח ביקש שיחת חזרה — תתבצע אוטומטית במועד המוצג. |
| `request_received` | הבקשה נקלטה |
| `dispatch_temp_failure` | לא ניתן היה להעביר את הבקשה. נסו שוב בעוד רגע. |
| `dispatch_unknown` | לא ניתן לאמת אם השיחה יצאה. אין לחייג שוב; בדקו בפיד השיחות. |

**לעולם לא מציגים שמות enum למשתמש.** כל reason ממופה להודעה קבועה.

## מיפוי 409 (סינכרוני)

`409` עם `code: "already_reached"` = **תוצאת domain**, לא שגיאה: מציגים את
`already_reached_title`, משביתים את הכפתור, **בלי** כפתור "נסה שוב", **בלי**
טוסט שגיאת רשת. (הסתעפות על `code` בלבד — לא על הטקסט.) המצב הזה נדיר —
השדות ב-§"כלל כפתור החיוג" אמורים למנוע את הלחיצה מראש; הגעתם לכאן = המסך
היה ישן, רעננו את שורת האורח.

## מיפוי `call_dispatch_status` (אחרי 202)

מאזינים ב-Realtime (postgres_changes) על הטבלה ומסננים לפי `dispatch_id`
מה-202; אחרי reconnect מבצעים poll לפי אותו מפתח. אין להציג "השיחה בתור"
לפני קבלת 202 אמיתי; `accepted` = "הבקשה נקלטה".

| status | reason | תוצאת domain | UI | retry? |
|---|---|---|---|---|
| `dispatched` | `null` | השיחה יצאה | לעקוב דרך `console_call_feed` לפי `call_attempt_id` | — |
| `dispatched` | `already_dispatched` / `already_concluded` | בקשה מקבילה כבר טופלה — מקושר לניסיון הקיים | תוצאה תקינה, לא כשל; להציג את השיחה הקיימת | לא |
| `skipped` | `already_reached` | **ביטול עסקי תקין** | `already_reached_title` + השבתת הכפתור | **לא** |
| `skipped` | `no_call_consent` | אין הסכמה לחיוג | הודעה קבועה | לא |
| `skipped` | `dnc_listed` | איש הקשר ביקש שלא להתקשר | הודעה קבועה | לא |
| `skipped` | `campaign_not_active` | הקמפיין אינו פעיל | הודעה קבועה | לא (לחיוג עצמו) |
| `skipped` | `event_closed` | האירוע אינו מאפשר עוד חיוג | הודעה קבועה | לא |
| `skipped` | `concurrent_owner` | בקשת חיוג אחרת כבר מטופלת | לא להציג ככשל | לא |
| `skipped` | `max_concurrency` | עומס זמני | אפשר להציע ניסיון מאוחר יותר | מאוחר יותר |
| `skipped` | `campaign_hour_cap` | מגבלת קצב של הקמפיין | הודעה קבועה | לא מיידי |
| `blocked` | `outreach_disabled` / `live_calls_disabled` | שירות החיוג אינו זמין כרגע | הודעה אנושית, בלי פרטים | לא |
| `blocked` | `config_missing` | תקלה מערכתית | הודעה אנושית, **בלי פרטי תצורה** | לא |
| `blocked` | `balance_below_reserve` | חסימה מערכתית | **אין לחשוף יתרה או סכום** | לא |
| `failed` | `failed_to_start` | השיחה לא התחילה | הודעת כשל | מותר |
| `failed` | `temporary_dispatch_failure` | כשל זמני בהעברה | `dispatch_temp_failure` | מותר |
| `unknown` | `start_unknown` | לא ניתן לאמת אם השיחה יצאה | `dispatch_unknown` | **אסור** (אוטומטית) |

עקרונות רוחביים:

- **רק** מצבים זמניים (`failed`, `max_concurrency`) מקבלים פעולת המשך; מצבים
  עסקיים — לעולם לא "נסה שוב".
- `skipped`/`blocked` אינם שגיאות רשת ואינם טוסט אדום.
- שורה שנשארת `accepted` זמן חריג (>דקות) = תקלת ערוץ; להציג "ממתין לעדכון",
  לא להמציא תוצאה.

## נגישות

ההסבר מתחת לכפתור המושבת הוא **קבוע** (לא טולטיפ בלבד): טקסט גלוי, נקרא
על-ידי קורא מסך, עם ניגודיות מספקת, RTL תקין. כפתור מושבת חייב לשאת
`contentDescription` שמסביר *למה* ("כבר נוצר קשר באירוע זה — לא ניתן לחייג").

## בדיקות נדרשות בצד האפליקציה (מקבילות לבדיקות השרת)

1. אורח עם `call_block_reason='already_reached'` ⇒ כפתור מושבת + הטקסט הקבוע.
2. `409/already_reached` ⇒ תוצאת domain — לא טוסט שגיאת רשת, אין retry.
3. אירוע Realtime `skipped/already_reached` ⇒ ביטול תקין של מחוון ההמתנה.
4. אין "השיחה בתור" לפני 202.
5. `callback_scheduled` ⇒ מוצג המועד, החיוג הידני מושבת.
6. אותו איש קשר באירוע אחר ⇒ הכפתור פעיל.
