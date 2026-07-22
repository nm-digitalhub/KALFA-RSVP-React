# פרמטרים שהאפליקציה צריכה — התחברות SDK והאזנה

> 2026-07-22. כל ערך כאן נשלף מהפלטפורמה או מה-DB החי. מה שעדיין לא נבנה
> מסומן ❌ — הוא ברשימה כדי שתדעו מה יגיע, לא כדי לבנות מולו עכשיו.

---

## חלק א׳ — התחברות (מה שיש היום)

### א.1 הזהות

הזהות **פר-נציג**, לא משותפת. היא מוקצית אוטומטית בשיוך נציג, וקיימת עכשיו:

| רכיב | ערך | מקור |
|---|---|---|
| שם קצר | `agent_1bbe74dc-5721-48e9-9092-fd9e3c6e6b21` | `console_me.vox_username` |
| אפליקציה | `kalfa-rsvp` | קבוע לחשבון |
| חשבון | `kalfarsvp` | קבוע לחשבון |
| Voximplant user_id | `11167270` | מידע בלבד — לא בשימוש בקוד |

**שני פורמטים, ואי אפשר להחליף ביניהם:**

```
קצר   agent_1bbe74dc-5721-48e9-9092-fd9e3c6e6b21
מלא   agent_1bbe74dc-5721-48e9-9092-fd9e3c6e6b21@kalfa-rsvp.kalfarsvp.voximplant.com
```

`console_me.vox_username` מחזיק את ה**קצר** — זו הצורה שהשרת צריך ל-hash, וזו היחידה שאנחנו יודעים בוודאות שהפלטפורמה מחזיקה. את המלא האפליקציה **מרכיבה**:

```
`${vox_username}@kalfa-rsvp.kalfarsvp.voximplant.com`
```

### א.2 רצף ההתחברות

```
1. Client.connect()
2. requestOneTimeLoginKey(  שם קצר  )        → login_key
3. POST /api/agents/sdk-auth { one_time_key } → { hash }       ✅ נבנה (b77f274)
4. loginWithOneTimeKey(  שם מלא  , hash)      → AuthResult
```

**שלב 3 קיים ופרוס.** ההתחברות פתוחה מקצה לקצה בצד שלנו.

**שלב 2 מקבל את הקצר, שלב 4 את המלא.** זו הטעות הקלה ביותר לעשות כאן: אותו רצף עם הפורמט ההפוך נכשל באימות בלי לומר למה.

### א.3 מה ששלב 3 יחזיר

```
POST /api/agents/sdk-auth
Authorization: Bearer <supabase-jwt>
{ "one_time_key": "<מה ש-requestOneTimeLoginKey החזיר>" }

→ 200 { "hash": "<32 hex>" }
```

**שם המשתמש לא נשלח בגוף** — השרת מזהה את הנציג מה-JWT וקורא את שמו בעצמו. אחרת נציג א׳ יכול לבקש hash של נציג ב׳.

**התדירות חשובה:** כל התחברות נספרת כ-MAU אצל Voximplant (1,000 חינם לחודש). אל תתחברו בכל פתיחת אפליקציה — שמרו את הסשן ובדקו אותו לפני שאתם מבקשים מפתח חדש.

---

## חלק ב׳ — האזנה (מה שעוד לא נבנה)

### ב.1 הנתיב

```
POST /api/calls/{callAttemptId}/monitor        ✅ נבנה, חסום מאחורי flag
{ "mode": "monitor" | "takeover" }
```

הנתיב, ההרשאה (`manage_voice`), רישום הרגל ומעטפת הפקודה נבנו. הסכמה מוגדרת
ב-`agent-console.ts` (`attachModeSchema`). הוא מחזיר `503` כל עוד
`app_settings.monitor_enabled` = OFF — כלומר עד שהתסריט יישא את מטפל הוועידה
וזה יאומת חי. ראו `monitor-scenario-topology.md`.

### ב.2 שדות התיאום — קריטי, וזה קיים כבר עכשיו

`console_call_feed` קיבל שלוש עמודות ב-20.7 שה-DTO שלכם **לא קורא**:

```
takeover_claimed_at    מתי נתפסה
takeover_request_id    מזהה הבקשה שתפסה
participation_state    מצב ההשתתפות
```

**בלעדיהן שני נציגים יתפסו את אותה שיחה.** הן נבנו בדיוק למניעת זה. כל מימוש האזנה חייב לקרוא ולכתוב אותן.

בנוסף: `agent_id` ו-`handled_by` — בעלות, ואלה **מותרים לכתיבה ישירה מהאפליקציה**.

### ב.3 מחזור החיים של רגל האזנה

`human_agent_call_legs` היא הטבלה שתתעד את הנוכחות. היא ריקה היום ואף אחד לא כותב אליה. השדות שהאפליקציה תצטרך לספק:

| שדה | מי מספק |
|---|---|
| `request_id` | האפליקציה — מזהה הבקשה, לקורלציה |
| `mode` | `monitor` \| `takeover` |
| `vox_sdk_call_id` | האפליקציה, מה-SDK |
| `device_id` | האפליקציה |
| `status` | השרת: `requested → dialing → ringing → connected → disconnected` (או `cancelled`/`failed`) |
| `connected_at` / `disconnected_at` | השרת |
| `failure_code` | השרת |

### ב.4 החוליה החסרה שאינה בצד שלכם

```
משתמש ב-Voximplant     ✅ קיים
sdk-auth               ✅ נבנה (b77f274)
monitor/takeover route ✅ נבנה, חסום מאחורי monitor_enabled
Conference ב-VoxEngine ⛔ החוליה האחרונה — מתועדת ב-monitor-scenario-topology.md,
                          מחכה לאימות חי לפני הדלקת ה-flag
```

**ותיקון למפרט שלכם:** `Conference.add()` **אינו מקבל `AgentsClient`**. מימוש לפי המפרט הנוכחי ייצר קוד שמתקמפל ולא עובד. הצירוף ייעשה ב-`VoxEngine.callUser({ username })` — ולכן הזהות פר-נציג, כי אי אפשר לכוון לנציג שתפס שיחה בזהות משותפת.

---

## חלק ג׳ — מה שכבר עובד ולא דורש SDK כלל

לפני שמשקיעים בהאזנה, שווה לדעת שהיכולת הזו קיימת ומחכה:

```
POST /api/calls/{callAttemptId}/agent-command
{ "command": "contextual_update", "text": "..." }
→ 202 { delivered: true, applied: "pending", command, request_id }
```

הנציג מנחה את סוכן ה-AI בזמן שיחה חיה, האורח לא שומע דבר. **בלי התחברות, בלי משתמש, בלי MAU.**

`202` אינו "בוצע": `applied: "pending"` יישאר pending לנצח בשתי פקודות הטקסט — ElevenLabs לא מחזיר אישור. הניסוח הנכון בממשק: *"נשלח לסוכן"*.

כל פקודה נרשמת ב-`console_agent_commands` — מי, מתי, איזו שיחה, מה נאמר, האם נמסר.

---

## סיכום: מה חסר למי

| | צד שלנו | צד שלכם |
|---|---|---|
| התחברות SDK | `sdk-auth` ✅ | הרכבת FQDN, שמירת סשן |
| האזנה | route ✅ (חסום מאחורי flag); Conference בתסריט ⛔ | שדות התיאום, DTO |
| לחישה | ✅ מוכן | כפתור בלבד |

**החוליה האחרונה בהאזנה היא מטפל הוועידה בתסריט** — מתועד 1:1 ב-
`monitor-scenario-topology.md`, ומחכה לאימות על שיחה חיה לפני שמדליקים את
`monitor_enabled`. `sdk-auth` וההתחברות כבר פתוחים; הלחישה לא חוסמת בכלום.
