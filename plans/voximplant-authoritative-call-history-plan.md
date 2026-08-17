# תוכנית: היסטוריית שיחות מ-Voximplant כמקור סמכות

**סטטוס:** טיוטה — ממתינה לאישור מפורש ("בצע"). לא בוצע דבר.
**תאריך:** 2026-08-17 (גרסה 2 — אחרי תיקון הבעלים למודל הזהות)

**דרישות הבעלים:**
1. "אתה חייב להציג את היסטוריית השיחות ישירות מ-Voximplant כולל כל המידע."
2. "תוסיף אפשרות סינון… לפי תאריכים/שעות. תבדוק בדיוק אילו פרמטרים נתמכים ע"י voxi!"
3. "אנחנו בסופו של יום חברה, וככל הנראה המון שיחות לא יהיו קשורות לאירוע או ללקוחות קיימים. התייחסות ספציפית לאירוע או לשמות אורחים היא שגויה. אני כבעלים החברה בכלל לא אמור לסמן לפי שם אורח."

---

## 0. התיקון — ולמה גרסה 1 הייתה שגויה

גרסה 1 בנתה את המסך סביב "שם אורח + אירוע". מדדתי, וזו טעות בסדר גודל:

```sql
select count(*), count(guest_id), count(event_id), count(contact_id)
from console_calls where direction='inbound' and created_at >= now() - interval '7 days'
```

```
שיחות נכנסות בשבוע          1,241
מתוכן עם שיוך לאורח            28
מתוכן עם שיוך לאירוע           28
                            ─────
                            2.3%
```

**97.7% מהשיחות אינן קשורות לאף אירוע ולאף אורח.** בנוסף, במסד כולו יש 43 אנשי קשר ו-46 אורחים — מול 1,913 סשנים בשבוע. בניתי מסך עבור 2.3% מהתעבורה.

### מודל הזהות המתוקן

הבעלים הוסיף: *"אם עד עכשיו הצגת שמות אורחים זו טעות. אם כבר, אצלי כבעלים נכון לשייך לקוח וממש לא לפי אורח."*

זה לא ניואנס — אלה **שני צירים שונים לגמרי**, ובחרתי בשגוי:

| ציר | מי זה | טבלה | כמה |
|---|---|---|---|
| **לקוח** | מי שפתח אירוע ומשלם — הלקוח של החברה | `profiles` (`full_name`, `phone`) | **4** |
| אורח | מי שהוזמן לאירוע של לקוח | `guests` | 46 |
| איש קשר | רשומת הסכמה/מסרים, **משויכת ל-`event_id`** | `contacts` | 43 |

`contacts` נראה כמו CRM אבל הוא לא — הוא נושא `event_id`, כלומר הוא עוד ציר-אורח.

**אורח הוא לא הלקוח שלנו. הוא המוזמן של הלקוח שלנו.** להציג את שמו כזהות המתקשר בלוג של בעל החברה זה פשוט הציר הלא נכון.

| | גרסה 1 (שגויה) | גרסה 2 |
|---|---|---|
| זהות ראשית של שורה | שם אורח | **מספר הטלפון — תמיד** |
| העשרה | שם אורח, "אורח" | **לקוח** (`profiles`) כשהמספר מוכר |
| אירוע | ציר מרכזי | לא מוצג כזהות |
| שורה בלי התאמה | "אורח" / ריק | **שורה תקינה לגמרי** — זה המצב הרגיל |

הקו הוא **קו טלפון עסקי**, לא לוח אורחים. שיחה ממספר שלא מוכר אינה חריגה שצריך למלא בערך ברירת מחדל — היא ברירת המחדל.

הערה כנה: עם 4 פרופילים, ההעשרה תתאים כמעט לכלום היום. זה **תקין ורצוי** — עדיף מספר נכון בלי שם, מאשר שם שגוי מציר שגוי.

---

### 0.1 הבעלים הכריע: ציר האורח לא מוצג כלל

נשאל במפורש אם להציג תג צדדי "מופיע כאורח באירוע X". **התשובה: לא.** ציר האורח יורד מכל משטחי השיחה — לא כזהות, לא כתג.

### 0.2 איפה זה יושב בקוד — ומה חייב להישאר

המקור הוא שורה אחת:

```ts
// src/app/api/voximplant/console/route-inbound/route.ts:356
caller_display: identified?.guestName ?? normalizedCli,
```

זו השורה ששמה "מבורך קלפה" על הטלפון המצלצל. שים לב שה-fallback שלה כבר היום הוא המספר — כלומר ההתנהגות הרצויה קיימת, היא פשוט נדחקת ע"י שם האורח.

⚠️ **אבל `identifyInboundCaller` אינה פונקציית תצוגה בלבד, ואסור למחוק אותה.** מאז אירוע ההונאה (17.8) היא מזינה את שער הקיבולת:

```ts
isIdentifiedCaller: identified !== null,   // → evaluateInboundCaps
```

מתקשר מזוהה מקבל תקציב רחב יותר; לא-מזוהה מקבל תקציב הדוק. אם נסיר את התאמת האורח, **כל מתקשר יהפוך ללא-מזוהה** ויקבל את התקציב ההדוק — כולל אורח אמיתי שמתקשר לגבי אירוע. זו דרך טובה לסרב לשיחות לגיטימיות.

לכן הפיצול:

| שאלה | מקור | נחשף? |
|---|---|---|
| "האם המספר מוכר לנו בכלל?" — אות אנטי-הונאה | contacts/guests, כמו היום | **לא. בוליאני פנימי בלבד** |
| "את מי מציגים כמתקשר?" | מספר + `profiles` אם מוכר | כן |

התאמת אורח נשארת כאות ביטחון. היא מפסיקה להיות שם.

---

## 1. הפרמטרים שנתמכים — שלוף verbatim מהתיעוד החי

`GetCallHistory`, כל 25 הפרמטרים. **סינון לפי שעות נתמך במלואו** — הפורמט הוא `YYYY-MM-DD HH:mm:ss`, לא רק תאריך.

### זמן

| פרמטר | טיפוס | התיעוד אומר |
|---|---|---|
| `from_date` | timestamp | *"The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted, a server-configured default interval is used (default is one month)"* |
| `to_date` | timestamp | זהה |
| `timezone` | string | *"The selected timezone or the 'auto' value (the account location)"* |

⚠️ `timezone` חייב להיקבע במפורש ל-`Asia/Jerusalem`. אחרת `auto` = מיקום החשבון, והשעות שיוצגו לא יהיו השעות שלך.

### מספרים

| פרמטר | טיפוס | התיעוד אומר |
|---|---|---|
| `remote_number` | stringlist | *"a call history for a specific remote numbers… separated by semicolons (;). A remote number is a number on the client side. **Ignored if the `remote_number_list` parameter is not empty**"* |
| `remote_number_list` | string | *"A JSON array of strings… **Has higher priority than the `remote_number` parameter**"* |
| `local_number` | stringlist | *"…for a specific local numbers… A local number is a number on the platform side"* |

### משך

| פרמטר | טיפוס | התיעוד אומר |
|---|---|---|
| `min_duration` | number | *"The minimum call duration in seconds to filter"* |
| `max_duration` | number | *"The maximum call duration in seconds to filter"* |

### שיוך

| פרמטר | טיפוס | התיעוד אומר |
|---|---|---|
| `application_id` / `application_name` | number / string | לפי אפליקציה |
| `rule_name` | string | *"**Applies only if you set application_id or application_name**"* |
| `user_id` | intlist | *"…the output contains the calls from the listed users only"* — סינון לפי נציג |
| `call_session_history_id` | intlist | *"…separated by a semicolon (;). The maximum number of records is 1000"* |
| `call_session_history_custom_data` | string | *"To filter the call history by the custom_data passed to the call sessions"* |
| `child_account_id`, `children_calls_only` | intlist / boolean | לא רלוונטי לנו |

### פלט ועימוד

| פרמטר | טיפוס | התיעוד אומר |
|---|---|---|
| `count` | number | *"The number of returning records. **The maximum value is 1000**"* |
| `offset` | number | *"The number of records to skip… **The maximum value of 10000**"* |
| `desc_order` | boolean | סדר יורד |
| `with_calls` | boolean | *"a list of sessions with all calls within the sessions, including phone numbers, call cost and other information"* ← **זה מה שנותן את רגלי השיחה** |
| `with_records` | boolean | הקלטות |
| `with_other_resources` | boolean | ResourceUsageType |
| `with_total_count` | boolean | *"Whether to include the 'total_count' **and increase performance**"* |
| `with_header` | boolean | רק ל-CSV |
| `is_async` | boolean | *"…instead of returning the data immediately. **requires the output=csv**"* — לא נשתמש |

### 1.1 המלאי המלא — סריקה רקורסיבית, לא דגימה

נסרק תכנותית מהשורש, עוקב אחרי כל קישור טיפוס עד שלא נוספו חדשים.
**11 מתודות, 51 שדות ב-4 מבנים.**

#### 11 מתודות תחת `references.httpapi.history`

`GetCallHistory` · `GetCallHistoryAsync` · `GetBriefCallHistory` · `GetHistoryReports` · `DownloadHistoryReport` · `GetACDHistory` · `GetAuditLog` · `GetAuditLogAsync` · `GetTransactionHistory` · `GetTransactionHistoryAsync` · `DeleteRecord`

#### `CallSessionInfoType` — 17 שדות (רמת סשן)

| שדה | הערה |
|---|---|
| `call_session_history_id` | **מפתח ה-upsert** |
| `calls[]` | → `CallInfoType`, רגל לכל שיחה |
| `custom_data` | **מפתח החיבור שלנו** |
| `start_date`, `duration` | |
| `rule_name`, `application_id`, `application_name`, `account_id`, `user_id` | |
| `records[]` | → `RecordType` |
| `other_resource_usage[]` | → `ResourceUsageType` |
| `audio_quality` | *"Standard \| HD \| Ultra HD"* |
| `finish_reason` | ערכים סגורים: *"Normal termination, Insufficient funds, Internal error (billing timeout), Terminated administratively, JS session error, Timeout"* |
| `log_file_url` | ⚠️ *"The log retention policy is **1 month**, after that time this field clears"* |
| `media_server_address`, `initiator_address` | |

#### `CallInfoType` — 15 שדות (רמת רגל) ← **לב העניין**

| שדה | הערה |
|---|---|
| `incoming` | נכנסת/יוצאת |
| `successful` | **האם הרגל הצליחה** — זה מה שמחליף את הניחוש שלנו |
| `end_reason` | ⚠️ **אובייקט** `{code, details}`, לא מחרוזת |
| `remote_number`, `remote_number_type` | *"PSTN, mobile, user or sip address"* |
| `local_number`, `duration`, `start_time` | |
| `call_id`, `transaction_id`, `cost` | |
| `custom_data` | ברמת הרגל, נפרד מהסשן |
| `diversion_number` | *"Call forwarding number"* |
| `record_url`, `media_server_address` | |

#### `RecordType` — 10 שדות

`record_id` · `record_url` · `record_name` · `duration` · `file_size` · `cost` · `start_time` · `transaction_id` · **`transcription_status`** (*"Not required, In progress, Complete"*) · **`transcription_url`**

→ **תמלול זמין דרך אותה קריאה.** לא היה בגרסאות קודמות של התוכנית.

#### `ResourceUsageType` — 9 שדות

`resource_type` מרשימה סגורה: `CALLSESSION, VIDEOCALL, VIDEORECORD, VOICEMAILDETECTION, YANDEXASR, ASR, TRANSCRIPTION, TTS_TEXT_GOOGLE, TTS_YANDEX, AUDIOHDCONFERENCE` — עם `cost`, `resource_quantity`, `unit`, `used_at`, `ref_call_id`.

→ **עלות מפורטת לכל רכיב**, לא רק לשיחה.

### 1.2 HTTP API מול VoxEngine — השוואה שם-מול-שם

```
only in HTTP      : none
only in VoxEngine : none
```

**25 מול 25, זהים לחלוטין** (camelCase מול snake_case). אין הבדל יכולת — רק מי קורא ומתי.

### 1.3 שני מפתחות `customData`, לא אחד

| מסלול | מי חותם | דורש פריסת תרחיש? |
|---|---|---|
| שיחה **יוצאת** מהמכשיר | `CallSettings.customData` (Android SDK) | **לא** |
| שיחה **נכנסת** | `VoxEngine.customData` (תרחיש) | כן |

שניהם מוגבלים ל-**200 בתים**. מהתיעוד החי של ה-SDK verbatim: *"It can be passed to the cloud to be obtained from the CallAlerting event **or Call History via HTTP API**. Maximum size is 200 bytes."*

### מה **לא** קיים — חשוב לדעת מראש

1. **אין סינון לפי תוצאה.** אין פרמטר `successful` ואין "רק שיחות שלא נענו". חייבים לחשב מ-`calls[]` אחרי השליפה.
2. **אין `with_logs`.** נבדק בשתי הגרסאות — 25 פרמטרים בכל אחת, אף אחד אינו `with_logs`. הלוגים מגיעים דרך `log_file_url` בתוך הסשן.
3. **המפריד הוא `;` ולא פסיק.** `call_session_history_id`: *"separated by a semicolon (;). The maximum number of records is 1000"*.

---

## 2. הראיה שמצדיקה את המעבר

חלון 7 ימים, `with_calls: true`, 20 עמודים, 8.0 שניות:

```
sessions                1,913      inbound 1,912
  משך סשן ≤ 3 שניות        668
  נוסתה רגל נציג           168
  רגל נציג התחברה           12
  פוספסו (נוסה, אף אחד)    156
sessions with custom_data     1
```

**הרשימה שלנו מציגה 12 שיחות שלא נענו. Voximplant יודעת על 156.**

הסיבה: `findMissedCalls` מסנן `answered_at is null`, אך השדה נדלק כשה**מערכת** ענתה — הקראת הגילוי ומוזיקת ההמתנה. כל 156 השיחות שבהן המערכת ענתה והנציג לא, מסוננות החוצה.

שיחה אמיתית (סשן 7734244460), מדוד:

```
incoming=true   successful=true    29s  pstn   200 Normal call clearing
incoming=false  successful=false    0s  user   480 User offline
incoming=false  successful=false    0s  user   603
```

---

## 3. מפתח החיבור והפער ההיסטורי

`VoxEngine.customData(str)` — verbatim: *"can be later obtained from **call history via management API**"*, מקסימום **200 בתים**. UUID = 36.

⚠️ רק סשנים שייווצרו **אחרי** פריסת התרחיש יישאו מפתח. מדוד: **סשן אחד מתוך 1,913** נושא היום `custom_data`.

בגרסה 2 הפער הזה כמעט לא מזיק — הזהות הראשית היא המספר, שקיים תמיד בכל סשן. המפתח נחוץ רק להעשרה של 2.3%.

---

## 4. ארכיטקטורה — הוכרעה במדידה

8.0 שניות ל-20 עמודים. מסך בטלפון לא יכול לפנות ל-Voximplant בכל בקשה. קיים גם קוד שגיאה מתועד **340 `Rate limit exceed`** (`voxRetry` ב-`core.ts` כבר מטפל בו).

```
pg-boss job (כל ~5 דק')
  → GetCallHistory(from=מאז הסנכרון האחרון, with_calls=true,
                   with_total_count=true, timezone='Asia/Jerusalem')
  → נרמול לכל רגל + חישוב תוצאה (נענה / לא נענה / ניתוק מיידי)
  → upsert: vox_call_sessions / vox_call_legs   מפתח call_session_history_id
/api/agents/call-history?from=&to=&min_duration=&outcome=&number=
  → קורא מהטבלה המסונכרנת (מהיר)
  → מעשיר בשם מה-DB לפי מספר, כשקיים
```

**הסינון עובד על הטבלה המסונכרנת, לא מול Voximplant**, משתי סיבות: (א) אין ב-API סינון לפי תוצאה, (ב) 8 שניות לכל שליפה. הסינון בטבלה מקבל את אותם צירים שה-API תומך בהם, ועוד אחד שאין בו.

---

## 5. שלבים ושערים

| # | שלב | שער |
|---|---|---|
| 1 | הרחבת `CallHistorySession` ב-`core.ts` — `calls[]` + `custom_data` (הטיפוס הקיים לא מכיל אותם; זו הסיבה שהיכולת הייתה מוסתרת) | tsc + טסטי נרמול |
| 2 | מיגרציה `vox_call_sessions` + `vox_call_legs` + RLS + אינדקסים על `start_date`, `remote_number` | **אישור מפורש**; `rls-schema-engineer` |
| 3 | עבודת סנכרון ב-pg-boss | טסטים על payload אמיתי מהחשבון |
| 4 | `VoxEngine.customData(consoleCallId)` ב-`ConsoleInbound` | **פריסה נפרדת** — `npm run vox:upload:inbound` בלבד; לא `vox:upload` חשוף; לא לגעת בכלל 1494311 |
| 5 | החלפת מקור הנתונים + סינון ב-API | השוואה מדודה: 12 מול 156 |
| 6 | מסך: מספר-תחילה, סיבת סיום בעברית לכל רגל, פאנל סינון | שימוש חוזר ב-`SIP_CODE_MEANINGS` / `END_REASON_LABEL` — 480/603/200 כבר ממופים |

---

## 6. סיכונים

1. **PII.** `remote_number` הוא מספר של אדם. הנתיב החדש חייב את אותו טיפול כמו `console_call_pii` — מסלול לצוות בלבד, ואיסור מוחלט על רישום מספרים גולמיים ביומן.
2. **`end_reason` הוא אובייקט** `{code, details}` ולא מחרוזת. נרמול חובה.
3. **`timezone`** — אם לא ייקבע במפורש, השעות יהיו של מיקום החשבון.
4. **פריסת התרחיש היא ייצור** — שלב 4 עומד בפני עצמו.
5. **`offset` תקרה 10,000** — לא מגביל אותנו היום (1,913 בשבוע), אך תקרה אמיתית בגידול.

---

## 7. שאלה שנפתחה בעקבות התיקון שלך — דורשת הכרעה

היום כפתור "חייג בחזרה" מוצע **רק** כששורה נושאת `event_id + contact_id`. לפי המדידה זה **28 מתוך 1,241 שיחות**. על קו עסקי זו התנהגות שבורה: הרוב המוחלט של מי שמתקשר לא ניתן להחזרה.

הסיבה המקורית הייתה החלטת הסכמה — `dial-intent` לא מקבל מספר גולמי, כדי שלא ניתן יהיה לחייג שיווקית לאדם שלא נתן הסכמה.

**אבל החזרת שיחה למי שהתקשר אלינו זה עתה אינה שיחה יזומה.** זו סיטואציה משפטית אחרת לגמרי.

לא אשנה שער הסכמה על דעת עצמי. זו שאלה אליך ואל `israeli-compliance-advisor`.

---

## 8. פתוח לפני התחלה

- מאשר את מודל הזהות בסעיף 0 (מספר-תחילה, בלי "אורח")?
- תדירות סנכרון — 5 דקות?
- מה עם סעיף 7?

---

## 9. תלוי ולא קשור

תיקון `8f6ea20` (כתובת 19KB) **עדיין לא נפרס**:

```
! cd /var/www/vhosts/kalfa.me/beta && npx tsc --noEmit && npm run lint && npm run deploy
```
