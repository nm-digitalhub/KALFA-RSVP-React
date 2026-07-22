# טופולוגיית התסריט להאזנה / השתלטות (monitor / takeover)

> **מקור: מדריך המפקח הרשמי של Voximplant** — `guides.contact-center.supervisors`
> (נשלף חי 2026-07-22). כל בלוק קוד כאן הוא **העתק 1:1** מהמדריך, ואחריו
> המיפוי למשתני תסריט ה-RSVP שלנו. **אין לכתוב את הקוד הזה לתוך
> `RSVPAgent.voxengine.js` החי לפני אימות בשיחה חיה** (ראו §5).

המסמך הזה הוא החוליה שחסרה כדי להדליק את `app_settings.monitor_enabled`. הבאק-אנד
(`POST /api/calls/{id}/monitor`, רגל האזנה, מעטפת הפקודה) כבר נבנה וחסום מאחורי
ה-flag; מה שנשאר הוא להטמיע את הטופולוגיה הזו בתסריט **ולאמת אותה על שיחה
חיה** לפני שמעבירים את ה-flag ל-ON.

---

## 1 · למה בכלל מיקסר, ולא ניתוב מדיה ישיר

ב-`RSVPAgent.voxengine.js` הגשר הנוכחי בין האורח לבין ה-AI הוא:

```js
VoxEngine.sendMediaBetween(call, agent); // guest ↔ ElevenLabs AgentsClient
```

אי אפשר להוסיף מאזין לתוך הצינור הזה בניתוב ישיר, כי **Call מקבל רק זרם אודיו
אחד** — זרם נכנס חדש מחליף את הקודם (מתועד ב-`Call.sendMediaTo`, אומת חי
2026-07-22). מאזין שצריך לשמוע גם את האורח וגם את ה-AI **חייב מיקסר**. המדריך
פותר זאת ב-`VoxEngine.createConference()` — מיקסר תוך-תסריטי שלא דורש דגל "video
conference" ב-rule (בניגוד ל-`Conference.add()`, שכן דורש, ושגם אינו מקבל
`AgentsClient` — לכן המפרט המקורי של האפליקציה שגוי בנקודה הזו).

---

## 2 · הקוד המקורי מהמדריך (1:1)

המדריך משתמש בשלושה משתנים: `operatorCall`, `clientCall`, `supervisorCall`.
שמות אלה הם קוד המקור **כפי שהוא**; המיפוי שלנו ב-§3.

**דרישת מודול (פעם אחת בראש התסריט):**

```js
require(Modules.Conference);

let conf;
```

**יצירת שיחת המפקח + נסיגה בטוחה אם הוא נופל:**

```js
// create a supervisor call
const supervisorCall = VoxEngine.callUser('username', 'call-center');

// process the disconnecting of the supervisor's call
// if the supervisor disconnects, the agent and the client continue talking
supervisorCall.addEventListener(CallEvents.Disconnected, () => {
  VoxEngine.sendMediaBetween(operatorCall, clientCall);
  VoxEngine.destroyConference(conf);
});

// process the failure of the supervisor's call
// if the supervisor's call fails for any reason, the agent and the client continue talking
supervisorCall.addEventListener(CallEvents.Failed, () => {
  VoxEngine.sendMediaBetween(operatorCall, clientCall);
  VoxEngine.destroyConference(conf);
});

// create a conference instance
conf = VoxEngine.createConference();
```

**מצב Supervision — האזנה בלבד** (המפקח שומע את הסוכן ואת הלקוח, אף אחד לא שומע
את המפקח):

```js
operatorCall.sendMediaTo(conf);
clientCall.sendMediaTo(conf);
conf.sendMediaTo(supervisorCall);
VoxEngine.sendMediaBetween(operatorCall, clientCall);
```

**מצב Whispering — לחישה** (המפקח והסוכן שומעים זה את זה + את הלקוח; הלקוח שומע
רק את הסוכן):

```js
VoxEngine.sendMediaBetween(operatorCall, conf);
VoxEngine.sendMediaBetween(supervisorCall, conf);
clientCall.sendMediaTo(conf);
operatorCall.sendMediaTo(clientCall);
```

**מצב Conference — ועידה מלאה** (שלושתם שומעים זה את זה):

```js
VoxEngine.sendMediaBetween(operatorCall, conf);
VoxEngine.sendMediaBetween(supervisorCall, conf);
VoxEngine.sendMediaBetween(clientCall, conf);
```

> להחלפת מצב — פשוט להריץ שוב את קוד המצב הרצוי. לניתוק המפקח — לסיים את
> `supervisorCall` (המאזין ל-`Disconnected` יחזיר את הצמד לניתוב הישיר ויהרוס את
> הוועידה).

---

## 3 · המיפוי לתסריט ה-RSVP שלנו

| משתנה במדריך | אצלנו | מה זה |
|---|---|---|
| `clientCall` | `call` | רגל ה-PSTN היוצאת אל האורח |
| `operatorCall` | `agent` | ה-`ElevenLabs.AgentsClient` — ה-AI. הוא `VoxMediaUnit` מלא, כך ש-`sendMediaTo` / `sendMediaBetween` חלים עליו בדיוק כמו על Call (אומת מול הטייפינגס). |
| `supervisorCall` | `supervisorCall` | הנציג האנושי, מחויג ב-`VoxEngine.callUser(vox_username, callerid)`. |

`vox_username` מגיע **בתוך מעטפת הפקודה** מהבאק-אנד, לא מומצא בתסריט:

```
{ command: 'attach', request_id, call_attempt_id,
  payload: { vox_username, mode: 'monitor' | 'takeover' } }
```

מיפוי שני המצבים שלנו על מצבי המדריך:

| mode אצלנו | מצב במדריך | סמנטיקה |
|---|---|---|
| `monitor`  | **Supervision** | הנציג שומע אורח + AI; איש לא שומע אותו. `conf.sendMediaTo(supervisorCall)` בלבד. |
| `takeover` | **Conference**  | ועידה מלאה — הנציג מדבר ונשמע ע"י האורח וה-AI. אם רוצים שהנציג **יחליף** את ה-AI לגמרי, זו פעולה נפרדת: `close_agent` (קיים כבר ב-`AGENT_COMMANDS`) ואז האורח נשאר עם הנציג במיקסר. |

מצב **Whispering** אינו ממופה לאף mode בקונסולה כרגע — הוא מתועד כאן כי הוא זמין
בחינם באותה טופולוגיה, אם ירצו בעתיד "לחישה לסוכן האנושי".

> **החלטת בעלים פתוחה (לאימות החי):** האם `takeover` פירושו ועידה של שלושה
> (המיפוי לעיל), או החלפה מלאה של ה-AI (אורח↔נציג בלבד, סגירת ה-WS של ה-AI)?
> ברירת המחדל במפרט הזה היא **ועידה** — הנאמנה למדריך 1:1 והבטוחה יותר (ה-AI לא
> נעלם באמצע). החלפה מלאה נבנית כ-`takeover` + `close_agent`, לא כמצב טופולוגי
> שלישי. יש לאשר לפני האימות.

---

## 4 · טיפול ב-`attach` / `detach` בתסריט (מפרט, לא קוד להדבקה)

התסריט כבר מקבל פקודות דרך `AppEvents.HttpRequest` (כך מטופלות היום
`contextual_update` / `user_message` / `clear_buffer` / `close_agent` /
`call_end`). מוסיפים שני ענפים:

1. **`attach`** — `payload = { vox_username, mode }`
   1. `conf = VoxEngine.createConference();`
   2. `supervisorCall = VoxEngine.callUser(vox_username, <callerid>);`
   3. לרשום מאזיני `Disconnected`/`Failed` על `supervisorCall` **כמו במדריך 1:1**
      (החזרת `sendMediaBetween(agent, call)` + `destroyConference(conf)`).
   4. על `CallEvents.Connected` של `supervisorCall` — להריץ את קוד המצב לפי
      `mode` (Supervision ל-`monitor`, Conference ל-`takeover`).
   5. לדווח את התקדמות הרגל חזרה ל-cb endpoint (מחוץ-לפס), עם `request_id`:
      `dialing → ringing → connected` (ו-`disconnected`/`failed` בהתאמה) — כדי
      שהבאק-אנד יעדכן את שורת `human_agent_call_legs` שכבר נוצרה במצב `requested`.

2. **`detach`** — לסיים את `supervisorCall`. המאזין `Disconnected` שכבר רשום
   מחזיר את ה-AI↔אורח לניתוב ישיר והורס את הוועידה. אין קוד ניתוק נפרד.

**קורלציה:** `request_id` שבמעטפת הוא אותו `request_id` שהבאק-אנד יצר בשורת
הרגל (`createRequestedLeg`). כל דיווח סטטוס חוזר חייב לשאת אותו, אחרת אי אפשר
לקשר רגל לשיחה.

---

## 5 · פרוטוקול האימות לפני הדלקת ה-flag

זהו התנאי היחיד שנותר להעברת `monitor_enabled` ל-ON. אין לדלג עליו — קונסולה
שמראה "מאזין" בזמן שהנציג שקט בפועל היא בדיוק סוג השקר שכל שכבת הקונסולה נבנתה
למנוע.

1. לפרוס את התסריט המעודכן **רק** דרך `voxengine-ci upload` אל `RSVPAgent`
   (application `kalfa-rsvp`, rule `OutCallAgent`) — לא PATCH ידני, לא עריכת
   `agent_configs/*.json` ביד.
2. להריץ שיחת בדיקה חיה אמיתית (אורח בפועל / קו בדיקה מאושר).
3. לחייג `attach` עם `mode:'monitor'` מזהות SDK מוקצית אמיתית ולוודא, **מתוך
   אודיו השיחה המוקלט** (לא מהתמליל של הסוכן — הוא מסתיר באגים):
   - הנציג שומע גם את האורח וגם את ה-AI;
   - האורח **אינו** שומע את הנציג;
   - סגירת רגל הנציג באמצע השיחה משאירה את האורח וה-AI ממשיכים ללא הפרעה
     (מאזין ה-`Disconnected`).
4. לחזור עם `mode:'takeover'` ולאמת את הכיוון הדו-כיווני לפי ההחלטה ב-§3.
5. לוודא ש-`human_agent_call_legs` עברה `requested → dialing → ringing →
   connected → disconnected`, ושה-`request_id` תואם לאורך כל הדרך.

רק אחרי ש-1–5 עוברים ומאושרים — להעביר את `monitor_enabled` ל-`true`. עד אז
הנתיב מחזיר `503` ביושר.

---

## 6 · הפניות

- מדריך המקור: `voximplant.com/api/v2/getDoc?fqdn=guides.contact-center.supervisors`
- מודול הוועידה: `docs/references/voxengine/conference`
- הבאק-אנד: `src/app/api/calls/[callAttemptId]/monitor/route.ts`,
  `src/lib/data/console-monitor.ts`, `attachModeSchema` + `SESSION_COMMANDS`
  ב-`src/lib/validation/agent-console.ts`
- חוזה האפליקציה: `docs/voice-agent/app-integration-reference.md` §6.7
