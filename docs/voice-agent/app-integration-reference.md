# KALFA — חוזה אינטגרציה לאפליקציית הקונסולה

> **גרסה 2026-07-22.** כל שדה, קוד וערך במסמך נשלף מהקוד או מה-DB החי ביום זה.
> מה שלא נבנה מסומן ❌ ומופיע רק כדי שתדעו מה יגיע.
>
> בסיס: `https://beta.kalfa.me`

---

## 1 · אימות

כל נתיב API דורש:

```http
Authorization: Bearer <supabase-jwt>
Content-Type: application/json
```

ה-JWT הוא ה-access token של Supabase Auth. השרת מאמת אותו מול שרת ה-Auth
(`getUser`), ואז דורש **חברות במוקד** — `is_console_agent()`, שמחייב גם חברות
בצוות הפלטפורמה.

| קוד | מתי |
|---|---|
| `401` | אין Bearer, טוקן לא תקף, או לא נציג מוקד |
| `403` | נציג מוקד — אבל חסרה ההרשאה הספציפית לפעולה |

**כל התשובות `Cache-Control: no-store`.**

### 1.1 הרשאות

הרשאה נדרשת **לכל נתיב בנפרד**. הרשימה שלכם מגיעה ב-`console_me.permissions`
(מערך מחרוזות). **גדרו את ה-UI לפיה** — אל תרנדרו פקד שיחזיר 403.

| מפתח | מה הוא פותח |
|---|---|
| `manage_voice` | פקודות בשיחה חיה, ניתוק, חיוג יזום |
| `campaigns.runstate` | השהיה והחייה של קמפיין |
| `view_customer_data` | טלפוני אורחים (אחרת `phone` יחזור `null`) |

---

## 2 · מה שהאפליקציה קוראת

כל אלה **ווים לקריאה בלבד**, נגישים דרך PostgREST עם אותו JWT. הם מסוננים
בשרת ב-`is_console_agent()` — אין צורך לסנן לפי משתמש.

### `console_me` — הנציג עצמו

```
user_id · display_name · vox_username · platform_role · platform_rank · permissions
```

`vox_username` — הזהות ל-SDK, או `null` אם לא הוקצתה. ראו §5.
`permissions` — `text[]`, מפתחות ההרשאה.

### `console_events`

```
event_id · event_name · event_type · event_date · has_campaign
```

### `console_campaigns`

```
id · event_id · status · enabled · start_at · close_at · max_contacts · created_at · updated_at
```

**`status` הוא מקור האמת.** `enabled` נגזר ממנו (`status = 'active'`) ונשמר
לתאימות לאחור בלבד — אל תבנו עליו לוגיקה חדשה.

ערכי `status`: `draft` · `pending_approval` · `approved` · `scheduled` ·
`active` · `paused` · `closed` · `awaiting_invoice` · `billed` · `paid` ·
`cancelled`.

### `console_event_guests` — **רשימת האורחים לחיוג**

```
guest_id · event_id · guest_name · dialable · phone · rsvp_status · has_active_campaign
```

- `dialable` — יש טלפון **וגם** לא ביקש הסרה
- `phone` — `null` בלי `view_customer_data`
- `has_active_campaign` — משקף את גייט ה-409 של נתיב החיוג

**זה הווי לרשימת האורחים.** לא `console_campaign_targets`.

### `console_campaign_targets` — יעדי קמפיין (לא אורחים)

```
id · event_id · campaign_id · contact_id · status · current_step_index
next_run_at · reached_at · reached_channel · stop_reason · guest_name · phone
```

מציג רק אנשי קשר **שנכנסו לקמפיין**. אירוע שקמפיינו לא הופעל יחזיר אפס שורות —
זה נכון ולא באג.

### `console_rsvp_results`

```
id · event_id · guest_id · guest_name · attending · adults · kids · note · created_at
```

### `console_call_analysis`

```
call_attempt_id · event_id · call_successful · status · score · call_duration_secs
termination_reason · el_eval · rsvp_status · adults · children · analysis_at
```

---

## 3 · מה שהאפליקציה כותבת ישירות

**שתי טבלאות בלבד**, בלי route:

### `agent_status`

```
agent_id · status · updated_at
```

`upsert` על **השורה של הנציג עצמו** בלבד. אפשר גם דרך `POST /api/agents/status`.

### `console_call_feed`

```
call_attempt_id · event_id · campaign_id · direction · kind · status
handled_by · agent_id · rsvp_digit · finish_reason · call_duration_sec
callback_iso · created_at · updated_at
takeover_claimed_at · takeover_request_id · participation_state
```

הרשאה: `SELECT` + `UPDATE`. **מותר לעדכן רק `handled_by` / `agent_id`** —
בעלות על השתלטות.

**⚠️ שלוש העמודות האחרונות נוספו ב-20.7 וה-DTO שלכם לא קורא אותן.** הן שדות
התיאום שמונעים ששני נציגים יתפסו את אותה שיחה. **כל מימוש האזנה חייב אותן.**

**כל השאר קריאה בלבד.** מצב קמפיין לעולם לא נהפך מלקוח — הוא צמוד לחיוב.

---

## 4 · Realtime

שלוש טבלאות מפורסמות ב-`supabase_realtime`:

```
agent_status · console_call_feed · human_agent_call_legs
```

`console_call_feed` הוא ערוץ פיד השיחות החי.

---

## 5 · זהות ה-SDK

הזהות **פר-נציג**, מוקצית אוטומטית בשיוך נציג במסך הניהול.

| רכיב | ערך |
|---|---|
| שם קצר | `console_me.vox_username`, למשל `agent_1bbe74dc-5721-48e9-9092-fd9e3c6e6b21` |
| אפליקציה | `kalfa-rsvp` |
| חשבון | `kalfarsvp` |

```
מלא = `${vox_username}@kalfa-rsvp.kalfarsvp.voximplant.com`
```

### רצף ההתחברות

```
1. Client.connect()
2. requestOneTimeLoginKey( שם קצר )            → login_key
3. POST /api/agents/sdk-auth { one_time_key }   → { hash }      ❌ טרם נבנה
4. loginWithOneTimeKey( שם מלא , hash)          → AuthResult
```

**שלב 2 מקבל את הקצר, שלב 4 את המלא.** הפורמט ההפוך נכשל באימות בלי הסבר —
זו הטעות הקלה ביותר כאן.

**MAU:** כל התחברות נספרת (1,000 חינם/חודש). שמרו סשן; אל תתחברו בכל פתיחה.

`vox_username = null` פירושו שהנציג לא הוקצה — אל תנסו להתחבר.

---

## 6 · נתיבי API

### 6.1 `POST /api/agents/status` — זמינות

הרשאה: אין (חברות במוקד מספיקה)

```json
{ "status": "ready" | "not_ready" | "dnd" }
→ 200 { "ok": true, "status": "ready" }
```

`in_call` **אינו מתקבל** — הוא מנוהל בשרת. `400` על ערך אחר.

### 6.2 `POST /api/calls/{callAttemptId}/agent-command` — הנחיית הסוכן ✅

הרשאה: `manage_voice`

```json
{ "command": "contextual_update", "text": "..." }   לחישה שלא קוטעת
{ "command": "user_message",      "text": "..." }   מזריק תור, קוטע
{ "command": "clear_buffer" }                        barge-in
{ "command": "close_agent" }                         סוגר את רגל ה-AI
```

הגוף **שטוח** — `text` ברמה העליונה, לא תחת `payload`. אורך עד 1000 תווים.

```json
→ 202 { "delivered": true, "applied": "pending", "command": "...", "request_id": "uuid" }
```

**`202` אינו "בוצע".**

| שדה | משמעות |
|---|---|
| `delivered: true` | הפקודה הגיעה לסשן החי |
| `applied: "pending"` | **לא ידוע** אם המודל פעל לפיה |

בשתי פקודות הטקסט `applied` יישאר `pending` **לתמיד** — ElevenLabs לא מחזיר
אישור. הניסוח הנכון בממשק: *"נשלח לסוכן"*, לא *"הסוכן ביצע"*.

שגיאות: `400` פקודה לא תקינה · `404` שיחה לא נמצאה · `409` השיחה אינה פעילה ·
`413` גוף גדול מדי · `502` לא נמסר.

**כל פקודה נרשמת** — מי, מתי, איזו שיחה, מה נאמר, האם נמסר.

### 6.3 `POST /api/calls/{callAttemptId}/end` — ניתוק ✅

הרשאה: `manage_voice`

```json
{}  →  202 { "delivered": true, "request_id": "uuid" }
```

שגיאות: `404` · `409` השיחה אינה פעילה · `502`.

**מנתק שיחה חיה עם אורח.** דרשו אישור מהמשתמש לפני.

### 6.4 `POST /api/events/{eventId}/outreach-call` — חיוג יזום ✅

הרשאה: `manage_voice`

```json
{ "guest_id": "<uuid>" }
→ 202 { "status": "accepted", "dispatch_id": "uuid", "event_id": "uuid" }
```

**`202` = נכנס לתור, לא "מחייג".** כל הגייטים — הסכמה, DNC, כבר-נוצר-קשר,
אירוע פעיל, יתרה — נבדקים **בעובד**, אחרי התשובה. שיחה עשויה להידחות בשקט.
הציגו *"הבקשה נקלטה"*.

| קוד | סיבה |
|---|---|
| `400` | `eventId` אינו UUID, או גוף לא תקין |
| `404` | האורח לא נמצא באירוע |
| `409` | אין קמפיין פעיל / יותר מאחד |
| `422` | לאורח אין מספר חיוג |
| `502` | הוספה לתור נכשלה |

**⚠️ שני תיקונים נדרשים אצלכם:** `event_id` נשלח כמחרוזת קשיחה
`"default-event"` — חייב UUID; וה-JSON נבנה בשרשור מחרוזות עם הטלפון בפנים —
השתמשו בסריאלייזר.

### 6.5 `POST /api/campaigns/{id}/status` — השהיה והחייה ✅

הרשאה: **`campaigns.runstate`** (לא `manage_voice`)

```json
{ "action": "activate" | "pause" }
→ 200 { "ok": true, "status": "paused" | "active" }
```

**ההיקף מצומצם בכוונה:**

```
active  → paused     ✅
paused  → active     ✅ החייה בלבד
approved/scheduled → active    ❌ 409 — הפעלה ראשונה היא של בעל האירוע באתר
```

**הציגו "הפעל" רק כאשר `status === 'paused'`**, ו-"השהה" רק כאשר `'active'`.

`409` מחזיר טקסט עברי אמיתי — *"להפעלת הקמפיין נדרשת תפיסת מסגרת מאושרת"*,
*"האירוע כבר חלף"*. **הציגו אותו כמו שהוא**, אל תחליפו בהודעה כללית.

### 6.6 ❌ טרם נבנו

```
POST /api/agents/sdk-auth              { one_time_key } → { hash }
POST /api/calls/{id}/monitor|takeover  { mode: "monitor" | "takeover" }
```

`monitor`/`takeover` חסומים גם מאחורי Conference ב-VoxEngine שלא נבנה.
**ותיקון למפרט שלכם:** `Conference.add()` **אינו מקבל `AgentsClient`** —
מימוש לפיו ייצר קוד שמתקמפל ולא עובד. הצירוף ייעשה ב-`VoxEngine.callUser({username})`.

---

## 7 · `human_agent_call_legs` — רגל האזנה ❌

הטבלה קיימת, ריקה, ואף אחד לא כותב אליה. תתמלא כשהאזנה תיבנה.

```
id · call_attempt_id · agent_id · request_id · mode · status
vox_sdk_call_id · vox_leg_call_id · device_id
requested_at · connected_at · disconnected_at · failure_code · metadata
```

`mode ∈ {monitor, takeover}` · `status ∈ {requested, dialing, ringing,
connected, cancelled, failed, disconnected}`

מהאפליקציה יגיעו: `request_id`, `mode`, `vox_sdk_call_id`, `device_id`.
השאר בשרת.

---

## 8 · באגים פתוחים בצד האפליקציה

1. **`saveRsvpResult` ריקה** — המסך אוסף תשובה ולא כותב כלום. אין ואף פעם לא
   יהיה route לכך; תוצאות RSVP שייכות לצינור ה-client-tools של ElevenLabs.
   **השביתו את הטופס.**
2. **`"default-event"` קשיח** בחיוג — ראו §6.4.
3. **`exhausted` לא מתורגם** בכרטיס אורח.
4. **אירוע שנמחק נשאר מוצג** — אין invalidation. רעננו את הרשימה במלואה.
5. **`console_call_feed`** — שלוש עמודות התיאום לא נקראות.

---

## 9 · כלל אחד מעל הכל

**אל תרנדרו פקד שאין מאחוריו backend.**

זה כבר גרם לתקלה: כפתור "הפעל קמפיין" לא הגיב, המשתמש עבר לאתר והשהה קמפיין
ידנית כדי "לאלץ סנכרון" — והקמפיין נתקע במצב שלא ניתן היה לחזור ממנו.
"לא נבנה" הפך ל"שבור" בידיו.

מה שמסומן ❌ — הסתירו או השביתו עם הסבר.
