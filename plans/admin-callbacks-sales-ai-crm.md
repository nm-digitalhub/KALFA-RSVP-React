# תוכנית: CRM קטן לשיחות AI מכירות בתוך `/admin/callbacks`

## מטרה

להרחיב את מסך האדמין של בקשות החזרה כך שישמש גם כ-CRM קטן לשיחות AI מכירות.

המסך צריך לאפשר להבין במהירות:

- מי הליד.
- האם סוכן AI מכירות התקשר.
- האם השיחה הצליחה או נכשלה.
- האם דיבר בן אדם או כנראה משיבון.
- מה ציון ElevenLabs.
- כמה זמן השיחה נמשכה.
- כמה credits היא עלתה.
- למה השיחה הסתיימה.
- מה ה-evaluation של ElevenLabs.
- האם צריך טיפול המשך.

---

## מה כבר קיים

### מסכים קיימים

- `/admin/callbacks`
  - קובץ: `src/app/(admin)/admin/callbacks/page.tsx`
  - מציג רשימת בקשות חזרה.

- `/admin/callbacks/[id]`
  - קובץ: `src/app/(admin)/admin/callbacks/[id]/page.tsx`
  - מציג פרטי בקשת חזרה אחת.

- `/admin/calendar`
  - קובץ: `src/app/(admin)/admin/calendar/page.tsx`
  - מציג יומן Exchange אדמיני.
  - כבר יודע לזהות appointment שמקושר ל-callback ולהציג פאנל callback בדיאלוג האירוע.

### שכבת נתונים קיימת

- קובץ: `src/lib/data/admin/callbacks.ts`
- כרגע קורא בעיקר מ-`callback_requests`.
- עדיין לא מחבר למסך את `sales_call_attempts` או `call_analysis`.
- כבר כולל `getCallbackRequestByCalendarItem(calendarItemId)`, שמחבר appointment ביומן אל `callback_requests.calendar_item_id`.

### חיבור קיים בין callback ליומן

כבר קיים היום חיבור עובד בין בקשת callback לבין יומן Exchange:

```sql
callback_requests.calendar_item_id = Exchange appointment id
```

הזרימה הקיימת:

1. `/admin/calendar` פותח appointment מתוך Exchange.
2. `getMyExchangeCalendarEvent()` קורא את פרטי האירוע.
3. אם למשתמש יש `view_customer_data`, הפונקציה קוראת:

```ts
getCallbackRequestByCalendarItem(appointmentId)
```

4. הפונקציה מחפשת ב-`callback_requests` לפי:

```ts
.eq('calendar_item_id', calendarItemId)
```

5. אם נמצאה בקשת callback, היא נשלחת ל-client בתור `detail.callback`.
6. `EventEditDialog` מציג `CallbackPanel` עם טלפון, נושא, הודעה, מספר ניסיון וקישור ל-`/admin/callbacks/[id]`.

לכן החיבור הבא שצריך להוסיף אינו `callback -> calendar`.
החיבור הזה כבר קיים.

החיבור שחסר ל-CRM המכירות הוא:

```txt
callback/calendar callback panel -> sales_call_attempts -> call_analysis
```

ובנפרד ממנו חסרה גם שמירת analysis במסלול המכירות:

```txt
ElevenLabs sales post-call webhook -> call_analysis
```

### אימות מול תיעוד ElevenLabs Agents + Voximplant

נבדק תיעוד רשמי של ElevenLabs Agents ושל Voximplant ElevenLabs Agents integration.

המסקנה הארכיטקטונית:

```txt
Voximplant = שכבת טלפוניה / PSTN / VoxEngine runtime
ElevenLabs Agents = מנוע שיחה / WebSocket / tools / analysis
Next.js = orchestration, persistence, CRM, webhooks
```

כלומר: אין לבנות את CRM המכירות כאילו השיחה מתחילה מתוך React SDK או מתוך Next.js.
השיחה מתחילה ב-Voximplant, מתחברת ל-ElevenLabs בזמן אמת, ואז חוזרת ל-Next.js דרך callbacks/tools/webhooks.

הזרימה הנכונה לפי התיעוד והקוד המקומי:

```txt
callback_requests
  -> sales-call-dispatch
  -> Voximplant scenario
  -> ElevenLabs.createAgentsClient()
  -> VoxEngine.sendMediaBetween(call, agent)
  -> ElevenLabs conversation_id
  -> Voximplant terminal callback
  -> sales_call_attempts.el_conversation_id
  -> ElevenLabs post-call webhook
  -> call_analysis
  -> admin CRM
```

נקודות תיעוד שמגשרות פערים:

| נושא | תיעוד | התאמה בקוד |
|---|---|---|
| יצירת client | Voximplant יוצר `ElevenLabs.createAgentsClient()` מתוך VoxEngine | קיים ב-`SalesCloseAgent.voxengine.js` |
| גישור אודיו | Voximplant משתמש ב-`VoxEngine.sendMediaBetween(call, agentsClient)` | קיים בתרחיש |
| conversation id | ElevenLabs שולח `conversation_initiation_metadata` עם `conversation_id` | התרחיש שומר ל-`state.elConversationId` |
| dynamic variables | נשלחות בתחילת השיחה כ-`conversation_initiation_client_data` | התרחיש קורא `conversationInitiationClientData({ dynamic_variables })` |
| client tools | ElevenLabs שולח `client_tool_call`, והלקוח מחזיר `client_tool_result` | התרחיש מנתב לכל `/api/voximplant/sls/tool/*` |
| tool result | `client_tool_result.result` צריך להיות string | התרחיש עושה stringify לפני `agent.clientToolResult()` |
| post-call webhook | מתאים לשמירה durable אחרי שהשיחה וה-analysis הסתיימו | קיים webhook sales, אבל עדיין לא שומר `call_analysis` |
| idempotency | webhook retries צריכים להיות idempotent לפי `conversation_id` | `call_analysis` מתאים ל-upsert לפי `(provider, conversation_id)` |

מקורות תיעוד שנבדקו:

- ElevenLabs WebSocket / Agent WebSockets:
  - `https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets`
  - `https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket`
- ElevenLabs Dynamic Variables:
  - `https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables`
- ElevenLabs Client Events:
  - `https://elevenlabs.io/docs/eleven-agents/customization/events/client-events`
- ElevenLabs Webhooks:
  - `https://elevenlabs.io/docs/eleven-api/resources/webhooks`
- ElevenLabs OpenTelemetry Traces:
  - `https://elevenlabs.io/docs/eleven-agents/customization/opentelemetry-traces`
- Voximplant ElevenLabs Agents Client / examples:
  - `https://voximplant.com/docs/voice-ai/elevenlabs/realtime-client`
  - `https://voximplant.com/docs/voice-ai/elevenlabs/agents-client`

השלכות לתוכנית:

1. לא נדרש כרגע ElevenLabs initiation webhook.
   - הסיבה: Voximplant כבר מעביר dynamic variables בעצמו.

2. לא נדרש React/Browser SDK במסכי האדמין.
   - ה-CRM הוא read/write admin UI מעל DB ו-webhooks, לא client שיחה.

3. `conversation_id` הוא מפתח החיבור המרכזי.
   - לכן אסור לבנות את החיבור לפי שם/טלפון/זמן בלבד.

4. post-call webhook הוא המקור הנכון ל-analysis:
   - score
   - success/failure
   - duration
   - cost
   - turns
   - evaluation
   - data collection

5. עבור “היסטוריית פעולות” מלאה יש שתי רמות:
   - JSON post-call transcript יכול להספיק לחילוץ tool calls אחרי שיחה, אם מחליטים לשמור metadata בלבד.
   - OpenTelemetry/monitoring מתאים יותר ל-timeline מפורט או live dashboard, אבל זה שלב מתקדם ולא נדרש ל-MVP.

6. מכיוון ש-Voximplant הוא ה-runtime, כל פעולה בזמן אמת צריכה להישאר במסלולי:

```txt
/api/voximplant/sls/tool/*
```

ולא לעבור למסלול ElevenLabs server tools חדש בלי החלטה מפורשת.

### טבלאות רלוונטיות קיימות

- `callback_requests`
  - פרטי הליד: שם, טלפון, נושא, הערה, סטטוס, outcome, תזמון.

- `sales_call_attempts`
  - ניסיון שיחת AI מכירות.
  - מקושר ל-callback דרך `callback_request_id`.

- `call_analysis`
  - ניתוח ElevenLabs לשיחה.
  - כולל success, score, status, reason, duration, cost, turns, evaluation וכו'.

### הבהרה חשובה

אין טבלה חיה בשם:

```sql
public.call_analysis_turn_counters
```

זה שם של migration.

בפועל השדות האלה נמצאים בטבלה:

```sql
public.call_analysis
```

השדות שנוספו שם:

```sql
agent_turns
user_turns
```

---

## בדיקת `call_analysis` בפועל דרך Supabase CLI

בדיקה בוצעה מול הפרויקט המקושר עם:

```bash
supabase db query --linked
```

הממצאים החיים:

- קיימת טבלה `public.call_analysis`.
- קיימות 26 רשומות.
- כל הרשומות הן `provider = elevenlabs`.
- קיימים 26 `conversation_id` ייחודיים.
- קיימים 4 סוכנים שונים לפי `agent_id`.
- טווח נתונים:
  - ראשון: `2026-07-19`
  - אחרון: `2026-08-31`

### קישוריות

- 17 רשומות מקושרות ל-`call_attempt_id`.
- 17 רשומות מקושרות ל-`event_id`.
- 9 רשומות אינן מקושרות ל-`call_attempt_id`.
- 9 רשומות אינן מקושרות ל-`event_id`.
- כל 5 הרשומות מאוגוסט 2026 אינן מקושרות ל-`call_attempt_id`.

### קשר ל-`sales_call_attempts`

בנתונים החיים:

- יש ניסיון מכירות אחד ב-`sales_call_attempts`.
- לניסיון הזה יש `el_conversation_id`.
- אין לו כרגע התאמה ב-`call_analysis.conversation_id`.
- אין ל-`call_analysis` כרגע FK ל-`sales_call_attempts` או ל-`callback_requests`.
- ל-`call_analysis` יש FK קיימים רק ל-`call_attempts` ול-`events`.

מסקנה: ה-UI חייב להציג מצב תקין של ניסיון שיחת מכירות בלי analysis עדיין.

מסקנה נוספת: כדי שסוכן AI מכירות באמת "יתעד את השיחות" ב-CRM, לא מספיק לבנות UI.
צריך גם לוודא שה-post-call analysis של sales נשמר ל-`call_analysis`.

### תוצאות שיחה

`call_successful` בפועל:

| ערך | כמות |
|---|---:|
| `success` | 21 |
| `failure` | 5 |

`status` בפועל:

| ערך | כמות |
|---|---:|
| `done` | 26 |

כרגע אין בדאטה החי `failed` או `unknown`, אבל ה-UI עדיין צריך לתמוך בהם כי זה החוזה של הנרמול.

### ציונים

- `el_call_score` קיים ב-24 מתוך 26 רשומות.
- מינימום: 50.
- ממוצע: 94.27.
- מקסימום: 100.
- `overall_score` לא נראה בשימוש בפועל כרגע.

### משך ועלות

- `call_duration_secs` קיים בכל 26 הרשומות.
- משך ממוצע: 85.96 שניות.
- טווח משך: 13 עד 532 שניות.
- `cost_credits` קיים בכל 26 הרשומות.
- עלות ממוצעת: 818.46 credits.
- טווח עלות: 51 עד 4014 credits.

### Turns ומשיבון

- 12 רשומות עם `agent_turns`/`user_turns` כ-`NULL`.
- 13 רשומות עם `user_turns > 0`, כלומר הייתה מעורבות לקוח.
- 1 רשומה עם `user_turns = 0` ו-`agent_turns > 0`, כלומר candidate טוב למשיבון / אין מעורבות לקוח.

חשוב: `NULL` הוא "לא נמדד", לא אפס.

### Evaluation ו-data collection

- `el_eval` קיים ב-24 מתוך 26 רשומות.
- `el_data` קיים ב-20 מתוך 26 רשומות.
- `rsvp_persisted` כמעט תמיד לא ניתן להערכה:
  - `true`: 1
  - `false`: 1
  - `NULL`: 24

קריטריונים שנמצאו בפועל ב-`el_eval`:

- `stayed_on_task`
- `dnc_honored`
- `rsvp_captured`
- `headcount_correct`
- `pricing_grounded`
- `legal_disclosure_delivered`
- `whatsapp_consent_asked`
- `terminal_outcome_recorded`
- `discount_trigger_respected`
- `no_false_close`
- `no_fabricated_reschedule_time`
- `opt_out_honored`
- `outcome_reached`

### אבטחה ו-RLS

המצב החי של `call_analysis`:

- RLS פעיל.
- grants:
  - `postgres`: מלא.
  - `service_role`: מלא.
  - `authenticated`: `SELECT` בלבד.
  - אין grant ל-`anon`.
- קיימת policy חיה אחת:
  - `call_analysis_owner_select`
  - משתמשת ב-`can_access_event(event_id, 'campaigns', 'view')`.

הערה חשובה: ה-comment של הטבלה מזכיר גם admin select דרך `has_role`, אבל בבדיקה החיה נמצאה רק policy אחת. לכן מסך אדמין שצריך לראות את הנתונים בצורה תפעולית צריך להמשיך לקרוא דרך server-side DAL עם `service_role`, כמו `src/lib/data/admin/callbacks.ts`, ולא להסתמך על קריאת client/RLS ישירה.

---

## חיבור הנתונים

החיבור העיקרי בין ניסיון שיחת מכירות לבין ניתוח ElevenLabs:

```sql
sales_call_attempts.el_conversation_id = call_analysis.conversation_id
```

צריך לתמוך גם במצב שבו:

- יש `sales_call_attempts`
- אבל עדיין אין `call_analysis`

זה מצב שקיים כבר עכשיו בנתונים החיים.

### ממצאי קריאת קוד — 2026-09-01

#### Graph / Exchange Calendar

- `src/lib/microsoft/graph-client.ts`
  - בונה Graph client כללי עם `ClientCertificateCredential`.
  - מיועד להיות client מרכזי ל-Microsoft Graph.

- `src/lib/exchange-ews/graph-impl.ts`
  - הוא מימוש היומן בפועל מול Microsoft Graph.
  - כרגע יש בו בנייה פנימית של Graph client, בדומה ל-`src/lib/microsoft/graph-client.ts`.
  - זו כפילות שכדאי לרשום כחוב טכני, אבל היא לא חוסמת את CRM המכירות.

- `src/lib/exchange-ews/calendar-provider.ts`
  - שכבת abstraction מעל Graph.
  - שאר הקוד אמור לדבר עם `calendarProvider`, לא ישירות עם Graph.

- `src/app/api/webhooks/microsoft-graph/route.ts`
  - webhook נכנס מ-Microsoft Graph.
  - לפי הקוד, זה webhook של mail intake (`graph_mail`), לא webhook של יומן callbacks.
  - לכן אין לבנות עליו CRM שיחות; היומן נקרא דרך `calendarProvider`.

#### חיבור callback ↔ יומן

- `src/lib/data/callback-scheduling.ts`
  - `scheduleCallbackAppointment()` קוראת זמינות מהיומן, יוצרת appointment, ואז כותבת:
    - `callback_requests.calendar_item_id`
    - `callback_requests.exchange_connection_id`
    - `callback_requests.scheduled_at`
    - `callback_requests.status = 'scheduled'`
  - `runCallbackSchedulingSweep()` כבר מפעיל גם enqueue לשיחת AI מכירות עבור `topic = 'מכירות'`.
  - `reconcileCallbacksWithCalendar()` מטפל במחיקה/הזזה של appointment ביומן ומעדכן את DB/jobs בהתאם.

- `src/lib/callbacks/calendar-item.ts`
  - בונה deterministic calendar item מתוך שדות DB בלבד.
  - כולל subject, body HTML, `tel:` link, קטגוריה, reminder, private sensitivity.
  - אין כאן תוכן שמודל AI מכתיב לתוך היומן.

- `src/lib/data/exchange-connections.ts`
  - `getMyExchangeCalendarEvent()` קורא appointment ואז, אם יש הרשאת `view_customer_data`, מצרף callback לפי:

```ts
getCallbackRequestByCalendarItem(appointmentId)
```

- `src/app/(admin)/admin/calendar/event-edit-dialog.tsx`
  - `CallbackPanel` כבר מציג callback בתוך דיאלוג האירוע:
    - טלפון לחיוג
    - נושא
    - הודעה
    - זמן קבלה
    - ניסיון הבא
    - קישור ל-`/admin/callbacks/[id]`

מסקנה: לא צריך לבנות חיבור חדש בין callback ליומן.
צריך להעשיר את אותו callback DTO ב-summary קטן של sales AI.

#### מסלול AI מכירות

- `src/lib/data/sales-call-dispatch.ts`
  - `enqueueSalesCallDispatch()` מופעל רק עבור `topic = 'מכירות'`.
  - `dispatchSalesCall()` קורא את `callback_requests`, בודק gates, יוצר `sales_call_attempts`, ומפעיל Voximplant.

- `src/lib/data/sales-call-attempts.ts`
  - טבלת bookkeeping של שיחות AI מכירות.
  - מקושרת ל-`callback_requests` דרך `callback_request_id`.
  - שומרת `el_conversation_id` כשהוא מגיע מ-Voximplant.
  - כוללת `outcome_recorded_at` כ-claim guard כדי למנוע כתיבת outcome כפולה.
  - אסור לשלוף/להציג `access_token`.

- `src/app/api/voximplant/sls/ctx/[token]/route.ts`
  - מחזיר לסוכן המכירות context מינימלי בתחילת השיחה.
  - כולל `prospect_name`, `note_text`, פרטי חברה, ו-`kalfa_attempt_token`.

- `src/app/api/voximplant/sls/cb/[token]/route.ts`
  - מסמן `dispatch_status = concluded`.
  - שומר `el_conversation_id` לתוך `sales_call_attempts`.
  - אם Voximplant מדווח שלא הייתה שיחה אמיתית (`no_answer` / `no_response` / `failed`) הוא כותב `call_outcome = no_answer` דרך `applyCallOutcome()`.

- `src/app/api/voximplant/sls/tool/signup-link/[token]/route.ts`
  - הכלי `send_signup_link`.
  - אם WhatsApp או SMS התקבלו לשליחה, הוא claim-guarded וכותב `call_outcome = completed`.
  - שומר bookkeeping של WhatsApp ב-`sales_call_attempts`.

- `src/app/api/voximplant/sls/tool/log-outcome/[token]/route.ts`
  - הכלי `log_outcome`.
  - כותב outcomes לא-success כמו `needs_followup`.
  - ממפה `escalated_to_human` ל-`needs_followup`.

- `src/app/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id/route.ts`
  - webhook post-call ייעודי ל-sales persona.
  - כיום הוא לא שומר `call_analysis`.
  - הוא רק משתמש ב-`conversation_id` כדי למצוא `sales_call_attempts` ולסגור attempt תקוע כ-`needs_followup`.
  - בקוד יש הערה מפורשת שזה היה מחוץ ל-scope:

```txt
this does NOT call storeCallAnalysis
```

מסקנה: זה הפער המרכזי לפני CRM מכירות אמיתי.

#### תרחיש Voximplant וקונפיג ElevenLabs של סוכן המכירות

נבדקו גם:

- `voxfiles/scenarios/src/SalesCloseAgent.voxengine.js`
- `voxfiles/scenarios/dist/SalesCloseAgent.voxengine.js`
- `agent_configs/KALFA-Sales-Close.json`

בדיקת `diff -q` בין `src` ל-`dist` לא החזירה הבדל, כלומר קובץ המקור משקף את גרסת התרחיש המופצת כרגע.

ממצאים:

- התרחיש מיועד במפורש ל-`callback_requests` עם `topic = 'מכירות'`.
- הסוכן הוא `עומר`, דרך ElevenLabs agent:

```txt
agent_4101m0my2f2kf4qvhegat60wrgtn
```

- התרחיש מקבל מ-`customData` את:
  - `to`
  - `from`
  - `tok`
  - `u`
- התרחיש קורא context לפני חיוג:

```txt
GET {u}/api/voximplant/sls/ctx/{tok}
```

- התרחיש שולח terminal callback:

```txt
POST {u}/api/voximplant/sls/cb/{tok}
```

- התרחיש מעביר כל tool call אל:

```txt
POST {u}/api/voximplant/sls/tool/{name}/{tok}
```

- התרחיש מאזין ל-`ConversationInitiationMetadata` ושומר `conversation_id` לתוך `state.elConversationId`.
- כאשר נשלח terminal callback, אם יש `state.elConversationId`, הוא מצורף כ-`el_conversation_id`.
- התרחיש מזהה `voicemail_detection` דרך AgentToolResponse ומסמן `voicemailDetected = true`.
- במקרה כזה `terminalStatus()` מחזיר `no_answer`.

המשמעות ל-CRM:

- יש כבר נתיב אמין יחסית לקישור:

```txt
sales_call_attempts.el_conversation_id -> call_analysis.conversation_id
```

- אם `el_conversation_id` לא הגיע, עדיין אפשר להציג ניסיון שיחה מתוך `sales_call_attempts`, אבל אי אפשר לחבר אותו ל-`call_analysis`.
- זיהוי משיבון צריך להסתמך על שני מקורות:
  - בזמן אמת: `voicemail_detection` גורם ל-`no_answer`.
  - אחרי analysis: `user_turns = 0` ו-`agent_turns > 0` הוא סימן תפעולי טוב למשיבון / אין מעורבות לקוח.

כלי הלקוח שקיימים בפועל בקונפיג ובתרחיש:

| כלי | מקור CRM אפשרי |
|---|---|
| `get_pricing` | פעולה שניתן לרשום בהיסטוריה אם מוסיפים logging |
| `apply_discount_tier` | התנגדות מחיר / הנחה, כרגע אין persistence מפורט מלבד data collection |
| `send_signup_link` | כותב `completed` ושומר bookkeeping ב-`sales_call_attempts` |
| `escalate_to_human` | יוצר `contact_messages` / Slack queue, לא live transfer אמיתי ב-v1 |
| `log_outcome` | כותב outcome שאינו הצלחה: `needs_followup` / `closed` / `escalated_to_human` שממופה ל-`needs_followup` |
| `mark_dnc` | כותב ל-`call_dnc_list` |
| `notify_owner` | יוצר `contact_messages` |
| `schedule_callback` | מפעיל reschedule של callback קיים |

נקודת דיוק חשובה לגבי “שנה מועד”:

- בתרחיש עצמו `schedule_callback` יכול לשלוח `callback_when_text` וגם `callback_iso`.
- בצד השרת, `processSalesScheduleCallback()` מחזיר `ok:false` אם אין `callback_iso` עתידי ותקין.
- לכן מסך “שנה מועד” בר ביצוע, אבל חייב לשמור datetime ממשי.
- טקסט חופשי לבד אינו מספיק לתזמון שיחה חוזרת.

Evaluation בקונפיג של סוכן המכירות:

| criterion id | משמעות למסך |
|---|---|
| `terminal_outcome_recorded` | האם השיחה הסתיימה בתוצאה תקפה |
| `legal_disclosure_delivered` | האם הגילוי המשפטי נמסר לפני מחויבות |
| `whatsapp_consent_asked` | האם ניתנה הסכמת WhatsApp לפני שליחה עם consent |
| `pricing_grounded` | האם כל מחיר נאמר רק אחרי tool |
| `discount_trigger_respected` | האם הנחה ניתנה רק אחרי התנגדות מחיר |
| `no_false_close` | האם לא נאמרה סגירה לפני אישור אמיתי |
| `dnc_honored` | האם בקשת הסרה כובדה |
| `stayed_on_task` | האם הסוכן נשאר בתחום ולא בדה עובדות |

Data collection בקונפיג של סוכן המכירות:

| שדה | סוג | שימוש CRM |
|---|---|---|
| `call_outcome` | string | תוצאה מילולית/עסקית של השיחה |
| `event_type` | string | סוג האירוע שהוזכר |
| `estimated_guest_count` | integer | הערכת כמות אורחים |
| `whatsapp_consent` | boolean | האם ניתנה הסכמה לשליחה ב-WhatsApp |
| `objection_reason` | string | התנגדות מחיר, אם הייתה |

מסקנה: המסכים שתוכננו ברי ביצוע ברמת התצוגה, אבל “היסטוריית פעולות” מלאה דורשת החלטת מימוש נוספת: האם להציג היסטוריה מורכבת מטבלאות קיימות בלבד, או להוסיף logging ייעודי לכלי המכירות.

#### בדיקת DB חיה — ספירות רלוונטיות

- `callback_requests`: 6 שורות.
- `callback_requests` עם `topic = 'מכירות'`: 4 שורות.
- `callback_requests` עם `calendar_item_id`: 1 שורה.
- `callback_requests` עם `topic = 'מכירות'` וגם `calendar_item_id`: 0 שורות כרגע.
- `sales_call_attempts`: 1 שורה.
- `sales_call_attempts` עם `callback_request_id`: 1.
- `sales_call_attempts` עם `el_conversation_id`: 1.
- `sales_call_attempts` עם `outcome_recorded_at`: 1.
- `call_analysis`: 26 שורות.
- התאמות בין `sales_call_attempts.el_conversation_id` לבין `call_analysis.conversation_id`: 0.

---

## שדות CRM להצגה

### פרטי לקוח

מקור: `callback_requests`

- `full_name`
- `phone`
- `topic`
- `note`
- `status`
- `call_outcome`
- `scheduled_at`
- `created_at`
- `attempt_count`
- `consecutive_no_answer_count`

---

## שדות שיחת AI מכירות

מקור: `sales_call_attempts`

- `dispatch_status`
- `scheduled_at_snapshot`
- `created_at`
- `updated_at`
- `vox_call_session_history_id`
- `finish_reason`
- `call_duration_sec`
- `el_conversation_id`
- `outcome_recorded_at`
- `signup_completed_at`
- `wa_delivery_status`
- `wa_delivery_error_code`
- `wa_status_at`

אסור להציג או לשלוף למסך:

```sql
access_token
```

---

## שדות ElevenLabs Analysis

מקור: `call_analysis`

- `call_successful`
- `el_call_score`
- `status`
- `termination_reason`
- `call_duration_secs`
- `cost_credits`
- `agent_turns`
- `user_turns`
- `el_eval`
- `analysis_at`
- `agent_id`

שמות למסך:

| שדה במסך | שדה DB |
|---|---|
| `callSuccessful` | `call_analysis.call_successful` |
| `callSuccessScore` | `call_analysis.el_call_score` |
| `status` | `call_analysis.status` |
| `terminationReason` | `call_analysis.termination_reason` |
| `callDurationSecs` | `call_analysis.call_duration_secs` |
| `costCredits` | `call_analysis.cost_credits` |
| `agentTurns` | `call_analysis.agent_turns` |
| `userTurns` | `call_analysis.user_turns` |
| `evaluation` | `call_analysis.el_eval` |
| `analysisAt` | `call_analysis.analysis_at` |
| `agentId` | `call_analysis.agent_id` |

---

## כלל זיהוי משיבון

צריך לחשב שדה נגזר:

```ts
likelyVoicemail
```

הכללים:

```ts
if (userTurns === 0 && agentTurns > 0) {
  likelyVoicemail = true;
}
```

```ts
if (userTurns === null || agentTurns === null) {
  likelyVoicemail = null;
}
```

```ts
if (userTurns > 0) {
  likelyVoicemail = false;
}
```

חשוב:

```md
userTurns = null
```

לא אומר 0.

הוא אומר:

```md
לא נמדד / לא ידוע
```

---

## DTO מוצע

```ts
type SalesCallCrmSummary = {
  attemptId: string;
  callbackRequestId: string;
  dispatchStatus: string;
  attemptCreatedAt: string;
  attemptUpdatedAt: string;
  scheduledAtSnapshot: string;
  finishReason: string | null;
  voxCallSessionHistoryId: string | null;
  elConversationId: string | null;
  outcomeRecordedAt: string | null;
  signupCompletedAt: string | null;

  hasAnalysis: boolean;

  callSuccessful: 'success' | 'failure' | 'unknown';
  callSuccessScore: number | null;
  status: 'done' | 'failed' | 'unknown';

  terminationReason: string | null;
  callDurationSecs: number | null;
  costCredits: number | null;

  agentTurns: number | null;
  userTurns: number | null;
  likelyVoicemail: boolean | null;

  evaluation: Record<string, string> | null;
  dataCollection: {
    callOutcome?: string | null;
    eventType?: string | null;
    estimatedGuestCount?: number | null;
    whatsappConsent?: boolean | null;
    objectionReason?: string | null;
  } | null;
  analysisAt: string | null;
  agentId: string | null;
};
```

---

## שינויי איסוף נתונים — חובה לפני UI מלא

ה-CRM לא צריך רק להציג שדות; הוא צריך לוודא ששיחות מכירה עתידיות אכן מקבלות `call_analysis`.

כרגע:

- `/api/elevenlabs/rsvp/update` שומר analysis דרך `storeCallAnalysis()`.
- `/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id` לא שומר analysis.
- `sales_call_attempts.el_conversation_id` כן נשמר דרך `/api/voximplant/sls/cb/[token]`.
- לכן אפשר לקשר analysis לשיחת מכירה לפי:

```sql
sales_call_attempts.el_conversation_id = call_analysis.conversation_id
```

אבל זה יעבוד רק אם רשומת `call_analysis` קיימת.

### שלב מומלץ ללא שינוי schema

בשלב ראשון לא לשנות סכימה.

לעדכן את webhook המכירות:

```txt
src/app/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id/route.ts
```

כך שאחרי `normalizeCallAnalysisWebhook()` הוא יבצע גם שמירה metadata-only ל-`call_analysis`.

דרישות מהתיעוד:

- לאמת את ה-header:

```txt
elevenlabs-signature
```

לפני parsing עסקי או כתיבה ל-DB.

- לקרוא את ה-raw body לחתימה. לא לאמת חתימה על JSON שעבר parse/stringify.
- להחזיר `200` במהירות אחרי קבלה תקינה.
- להחזיר `2xx` על אירועים חתומים אבל לא רלוונטיים, כדי לא לגרום failure מיותר.
- להיות idempotent, כי retry של ElevenLabs שולח payload זהה.
- להשתמש ב-`conversation_id` כמפתח dedupe/join.
- לא לשמור transcript מלא או audio ב-MVP.

סוגי events לפי עמוד ה-Webhooks הכללי:

| event type | רלוונטיות ל-CRM מכירות |
|---|---|
| `post_call_transcription` | כן. זה האירוע שנשלח אחרי ששיחת Agents הסתיימה וה-analysis הושלם |
| `voice_removal_notice` | לא רלוונטי |
| `voice_removal_notice_withdrawn` | לא רלוונטי |
| `voice_removed` | לא רלוונטי |

הערה חשובה: בעמוד הזה `post_call_audio` ו-`call_initiation_failure` לא מופיעים כסוגים כלליים.
הם עשויים להופיע בהקשרי Agents/product settings אחרים, אבל במסלול ה-CRM הנוכחי צריך להכיר רק ב-`post_call_transcription` כ-event שמייצר `call_analysis`.

שדות top-level שמגיעים ב-webhook:

| שדה | שימוש |
|---|---|
| `type` | סיווג האירוע |
| `data` | payload האירוע |
| `event_timestamp` | זמן האירוע מצד ElevenLabs |

מבנה `data` ב-`post_call_transcription` כולל:

| שדה | שימוש CRM |
|---|---|
| `agent_id` | נשמר כ-`agent_id` |
| `conversation_id` | מפתח dedupe וקישור |
| `status` | נשמר כ-status |
| `transcript` | לא נשמר במלואו ב-MVP; אפשר להשתמש בו רק לחישוב turns/tool metadata אם צריך |
| `metadata.call_duration_secs` | נשמר כ-duration |
| `metadata.cost` | נשמר כ-cost credits |
| `metadata.termination_reason` | נשמר כסיבת סיום |
| `analysis.evaluation_criteria_results` | נשמר כמפת evaluation בלי rationale |
| `analysis.data_collection_results` | נשמר כשדות data collection מובנים |
| `analysis.call_successful` | נשמר כ-success/failure/unknown |
| `analysis.transcript_summary` | לא נשמר ב-MVP |
| `conversation_initiation_client_data.dynamic_variables` | לא נשמר ב-MVP |

Retry behavior לפי התיעוד:

| מצב HTTP | האם ElevenLabs עושה retry |
|---|---|
| `5xx` | כן |
| `429` | כן |
| `408` | כן |
| `4xx` כמו `400`, `401`, `403`, `404` | לא |

Retry schedule:

| ניסיון | delay |
|---|---|
| 1 | מיד |
| 2 | 30 שניות |
| 3 | 2 דקות |
| 4 | 8 דקות |
| 5 | 30 דקות |

יש jitter קטן עד 10%.

מגבלות/סיכונים מהתיעוד:

- retries כבויים כברירת מחדל וצריך לוודא שהם מופעלים עבור webhook המכירות.
- retries נתמכים כרגע רק עבור `post_call_transcription`.
- לכל webhook יש מגבלה של 100 retry jobs ממתינים.
- webhook יכול להיכבות אוטומטית אחרי 10 כשלים רצופים, אם מעולם לא הצליח או שההצלחה האחרונה הייתה לפני יותר מ-7 ימים.

השלכה מעשית:

- `401` על חתימה לא תקינה הוא נכון, כי אין טעם ב-retry.
- payload חתום אבל לא רלוונטי צריך לחזור `200`.
- כשל DB אמיתי בשמירת `call_analysis` צריך להחזיר `500`, כדי ש-ElevenLabs ינסה שוב.
- בגלל retry, השמירה חייבת להיות upsert/idempotent לפי:

```txt
provider + conversation_id
```

מה כן לשמור:

- `provider`
- `conversation_id`
- `agent_id`
- `call_successful`
- `status`
- `el_call_score`
- `termination_reason`
- `call_duration_secs`
- `cost_credits`
- `agent_turns`
- `user_turns`
- `el_eval`
- `el_data`
- `analysis_at`
- `received_at`

מה לא לשמור ב-MVP:

- transcript מלא.
- summary חופשי.
- audio.
- raw dynamic variables.
- תוכן tool parameters/results שמכיל PII או טקסט חופשי לא נחוץ.

אפשרויות מימוש:

1. להשתמש ב-`storeCallAnalysis(parsed.analysis)` כמו במסלול RSVP.
   - יתרון: reuse של normalizer ושל upsert idempotent לפי `(provider, conversation_id)`.
   - חיסרון: הפונקציה כרגע מחפשת link רק ב-`call_attempts`; בשיחת מכירות היא תשמור `call_attempt_id = null`.
   - זה עדיין מספיק ל-CRM אם ה-DAL מצטרף לפי `sales_call_attempts.el_conversation_id`.

2. לפצל את `storeCallAnalysis()` לשתי שכבות:
   - `buildCallAnalysisInsert(a)` — pure mapper.
   - `storeRsvpCallAnalysis(a)` — כולל lookup ל-`call_attempts` ו-`rsvp_persisted`.
   - `storeSalesCallAnalysis(a)` — שומר row לפי `conversation_id` בלי RSVP-specific lookup.
   - יתרון: יותר נקי סמנטית.
   - חיסרון: יותר שינוי קוד ובדיקות.

המלצה: להתחיל באפשרות 2 אם נוגעים בקוד, כי היא מפרידה במפורש RSVP מול Sales ומונעת בלבול עתידי.

הערה: לא להעביר את כלי המכירות ל-ElevenLabs server tools בשלב הזה.
הקוד הנוכחי עובד דרך Voximplant client tools, והשרת כבר מאבטח כל tool לפי token בנתיבי `/api/voximplant/sls/tool/*`.
שינוי מנגנון tools הוא שינוי ארכיטקטוני נפרד, לא חלק מ-CRM MVP.

### שלב עתידי עם שינוי schema

אם רוצים קישור DB מפורש ולא runtime join בלבד:

```sql
alter table public.call_analysis
add column sales_call_attempt_id uuid references public.sales_call_attempts(id) on delete set null;
```

ואז להוסיף index:

```sql
create index call_analysis_sales_call_attempt_idx
on public.call_analysis(sales_call_attempt_id);
```

לא לבצע את זה בשלב הראשון בלי החלטה מפורשת, כי כרגע אפשר לבנות CRM read-only על join לפי `conversation_id`.

---

## שינויי Data Layer

קובץ:

```txt
src/lib/data/admin/callbacks.ts
```

### להוסיף טיפוסים

- `SalesCallCrmSummary`
- `CallbackRequestWithSalesSummary`
- `CallbackRequestDetailWithSalesCalls`

### להרחיב את `listCallbackRequests`

הרשימה תחזיר לכל callback גם summary של ניסיון AI מכירות אחרון.

היא צריכה:

1. לקרוא callbacks כרגיל.
2. לקחת את כל ה-IDs של callbacks בעמוד.
3. לקרוא `sales_call_attempts` לפי `callback_request_id`.
4. לקרוא `call_analysis` לפי `el_conversation_id`.
5. לחבר בקוד.
6. להחזיר לכל callback את ניסיון המכירות האחרון, אם קיים.

הערת ביצועים:

- לא לעשות N+1.
- לקרוא attempts לכל callbacks בעמוד בשאילתה אחת.
- לקרוא analyses לכל `el_conversation_id` בשאילתה אחת.
- לבחור ניסיון אחרון לפי `created_at desc` או `scheduled_at_snapshot desc`.

### להרחיב את `getCallbackRequest`

דף הפרטים יחזיר את כל ניסיונות AI המכירות של אותו callback.

הוא צריך:

1. לקרוא callback אחד.
2. לקרוא את כל `sales_call_attempts` שלו.
3. לקרוא ניתוחים מ-`call_analysis`.
4. לחבר כל attempt ל-analysis שלו.
5. להחזיר מערך `salesCalls`.

ב-detail מותר להציג יותר מידע מאשר ברשימה:

- כל הניסיונות.
- כל ה-evaluation.
- מזהה agent.
- נתוני WhatsApp bookkeeping.

אבל עדיין לא להציג:

- `access_token`
- transcript
- summary חופשי
- dynamic variables מה-provider

### כלל אבטחה

לא לשלוף:

```sql
sales_call_attempts.access_token
```

### להרחיב את `getCallbackRequestByCalendarItem`

היומן כבר משתמש בפונקציה הזו כדי להציג callback בתוך `EventEditDialog`.

אם רוצים להציג summary קצר של AI מכירות גם בדיאלוג היומן, צריך להחזיר כאן גם summary מינימלי של ניסיון המכירות האחרון:

- `dispatchStatus`
- `hasAnalysis`
- `callSuccessful`
- `callSuccessScore`
- `callDurationSecs`
- `costCredits`
- `agentTurns`
- `userTurns`
- `likelyVoicemail`
- `analysisAt`

לא להחזיר בדיאלוג היומן את כל ה-evaluation, כדי לא להפוך את היומן למסך CRM מלא.

חשוב: לא להחליף את מנגנון הזיהוי הקיים של היומן.
היומן כבר מזהה callback לפי `calendar_item_id`.
ההרחבה צריכה לרכב על אותו DTO, לא לבצע חיפוש חדש לפי subject/body.

---

## שינויי UI ברשימת callbacks

קובץ:

```txt
src/app/(admin)/admin/callbacks/page.tsx
```

להוסיף לכל שורה אזור קטן בשם:

```md
AI מכירות
```

### אם אין ניסיון AI

להציג:

```md
טרם בוצעה שיחת AI
```

### אם יש ניסיון אבל אין ניתוח ElevenLabs

להציג:

```md
שיחת AI הסתיימה, ניתוח טרם התקבל
```

### אם יש ניתוח

להציג בקצרה:

- סטטוס dispatch.
- הצלחה / כישלון / לא ידוע.
- ציון.
- משך.
- עלות credits.
- אינדיקציה אם כנראה משיבון.

דוגמה:

```md
AI מכירות: הסתיימה · הצליחה · ציון 87 · 64 שניות · 12 credits
```

אם משיבון:

```md
כנראה משיבון
```

---

## שינויי UI ביומן Exchange

קבצים:

```txt
src/app/(admin)/admin/calendar/event-edit-dialog.tsx
src/lib/data/exchange-connections.ts
```

היומן כבר מזהה callback מקושר ומציג `CallbackPanel`.

העדכון המומלץ:

- להעשיר את `LinkedCallbackDTO` ב-summary קצר של שיחת AI מכירות אחרונה.
- להציג אותו בתוך `CallbackPanel` מתחת לפרטי הטלפון והנושא.
- לשמור את היומן כמסך תזמון ופעולה מהירה, לא כ-CRM מלא.

### מה להציג ביומן

ב-`CallbackPanel` להציג שורה קצרה:

```md
AI מכירות: הסתיימה · הצליחה · ציון 87 · 64 שניות
```

אם אין ניסיון AI:

```md
AI מכירות: טרם בוצעה שיחה
```

אם יש ניסיון אבל אין analysis:

```md
AI מכירות: השיחה נרשמה, ניתוח טרם התקבל
```

אם כנראה משיבון:

```md
כנראה משיבון
```

### מה לא להציג ביומן

לא להציג ביומן:

- טבלת evaluation מלאה.
- `agentId`.
- מזהי provider טכניים.
- פירוט מלא של כל הניסיונות.
- `access_token`.

הפרטים המלאים צריכים להישאר ב-`/admin/callbacks/[id]`.

---

## שינויי UI בדף פרטי callback

קובץ:

```txt
src/app/(admin)/admin/callbacks/[id]/page.tsx
```

להוסיף מקטע:

```md
## שיחות AI מכירות
```

לכל ניסיון להציג:

- מועד ניסיון.
- סטטוס dispatch.
- הצלחת שיחה.
- ציון.
- סטטוס ElevenLabs.
- סיבת סיום.
- משך שיחה.
- עלות credits.
- turns:
  - סוכן
  - לקוח
- אינדיקציית משיבון.
- evaluation.
- data collection:
  - תוצאת שיחה
  - סוג אירוע
  - כמות אורחים משוערת
  - הסכמת WhatsApp
  - התנגדות מחיר
- agentId.

### Evaluation

להציג כטבלה קטנה:

| קריטריון | תוצאה |
|---|---|
| `terminal_outcome_recorded` | עבר |
| `legal_disclosure_delivered` | עבר |
| `pricing_grounded` | נכשל |
| `no_false_close` | עבר |

בלי rationale ובלי טקסט חופשי.

### היסטוריית פעולות

אפשר להוסיף tab או מקטע:

```md
## היסטוריית פעולות
```

בשלב ראשון, ללא schema חדש, ניתן להרכיב timeline חלקי ממקורות קיימים:

| פעולה | מקור קיים | רמת ודאות |
|---|---|---|
| callback נוצר | `callback_requests.created_at` | גבוהה |
| callback תוזמן ביומן | `callback_requests.scheduled_at`, `calendar_item_id` | גבוהה |
| שיחת מכירות נוצרה | `sales_call_attempts.created_at` | גבוהה |
| שיחת מכירות הסתיימה | `sales_call_attempts.dispatch_status`, `updated_at` | בינונית |
| conversation id התקבל | `sales_call_attempts.el_conversation_id` | גבוהה |
| outcome נרשם | `callback_requests.call_outcome`, `sales_call_attempts.outcome_recorded_at` | גבוהה |
| קישור הרשמה נשלח | `sales_call_attempts` WhatsApp/SMS bookkeeping | בינונית-גבוהה |
| פנייה לנציג / notify owner | `contact_messages` | אפשרי, דורש התאמת מזהים/טלפון |
| DNC | `call_dnc_list` | אפשרי, לפי טלפון מנורמל |
| analysis התקבל | `call_analysis.received_at` / `analysis_at` | גבוהה |
| evaluation עבר/נכשל | `call_analysis.el_eval` | גבוהה |

מה לא קיים מספיק טוב כרגע:

- רישום מפורט לכל tool call של סוכן המכירות.
- timestamp נפרד לכל `get_pricing`, `apply_discount_tier`, `schedule_callback`, `notify_owner`.
- טבלת timeline ייעודית לפי `sales_call_attempt_id`.

לכן אם רוצים “היסטוריית פעולות” מלאה כמו בתמונות, יש שתי אפשרויות:

1. MVP — timeline מחושב מטבלאות קיימות בלבד.
   - מהיר יותר.
   - לא מציג כל tool call.
   - מספיק כדי להבין מצב ליד ושיחה.

2. Full CRM — להוסיף logging ייעודי לכלי מכירות.
   - למשל טבלה `sales_call_tool_events` או שימוש עקבי ב-`activity_log` עם meta מובנה.
   - מאפשר להציג כל פעולה בזמן אמת/אחרי שיחה.
   - דורש החלטת schema ובדיקות נוספות.

המלצה: MVP קודם. להוסיף full tool timeline רק אחרי שהצגת `call_analysis` עובדת.

---

## Labels בעברית

קובץ:

```txt
src/lib/data/admin/labels.ts
```

להוסיף פונקציות:

```ts
callAnalysisSuccessfulLabel(value: string | null): string
callAnalysisStatusLabel(value: string | null): string
salesDispatchStatusLabel(value: string): string
evaluationResultLabel(value: string): string
```

### תרגומים מוצעים

#### `call_successful`

| ערך | תצוגה |
|---|---|
| `success` | הצליחה |
| `failure` | נכשלה |
| `unknown` | לא ידוע |
| `null` | לא ידוע |

#### `call_analysis.status`

| ערך | תצוגה |
|---|---|
| `done` | הסתיים |
| `failed` | נכשל |
| `unknown` | לא ידוע |
| `null` | לא ידוע |

#### `dispatch_status`

| ערך | תצוגה |
|---|---|
| `queued` | בתור |
| `dialing` | מחייג |
| `in_progress` | בשיחה |
| `concluded` | הסתיימה |
| `failed_to_start` | נכשלה בהתחלה |
| `start_unknown` | מצב התחלה לא ידוע |

#### `evaluation`

| ערך | תצוגה |
|---|---|
| `success` | עבר |
| `failure` | נכשל |
| `unknown` | לא ידוע |

---

## בדיקות

קובץ:

```txt
src/lib/data/admin/callbacks.test.ts
```

להוסיף בדיקות עבור:

- `listCallbackRequests` עדיין דורש `view_customer_data`.
- `getCallbackRequest` עדיין דורש `view_customer_data`.
- לא נשלף `access_token`.
- callback בלי ניסיון AI חוזר תקין.
- ניסיון AI בלי `call_analysis` חוזר עם `hasAnalysis: false`.
- ניסיון AI עם analysis חוזר עם השדות הנכונים.
- `user_turns = 0` ו-`agent_turns > 0` מסמן `likelyVoicemail: true`.
- `user_turns = null` מסמן `likelyVoicemail: null`.
- `user_turns > 0` מסמן `likelyVoicemail: false`.

קובץ:

```txt
src/app/api/elevenlabs/rsvp-sales-call-dispatch/pcw_id/route.test.ts
```

להוסיף בדיקות עבור:

- webhook מכירות שומר metadata-only ל-`call_analysis`.
- webhook מכירות עדיין claim-guarded וסוגר attempt תקוע כ-`needs_followup`.
- replay של אותו `conversation_id` לא יוצר כפילות.
- אירוע חתום אבל לא רלוונטי מחזיר `200` בלי שמירה.
- payload מסוג `post_call_audio` לא נשמר.
- payload בלי `conversation_id` לא נשמר.
- payload מסוג `post_call_transcription` עם `conversation_id` שומר לפי upsert idempotent.
- שמירת analysis לא תלויה בכך שה-attempt עדיין unresolved.
- failure בשמירת analysis מחזיר `500`, כדי לאפשר retry של ElevenLabs.
- חתימה לא תקינה מחזירה `401` ולא יוצרת retry צפוי.
- payload חתום אבל לא רלוונטי מחזיר `200`.
- payload חתום עם JSON לא תקין מחזיר `200` או `400` לפי החלטה מודעת; ההמלצה היא `200` אם אין מה לתקן ב-retry.
- בדיקה שה-handler נשאר idempotent גם כשאותו payload מגיע שוב אחרי retry.
- אין שמירת transcript / summary / dynamic variables.
- אין מעבר למסלול ElevenLabs server tools; כלי המכירות נשארים דרך Voximplant.

קובץ:

```txt
src/lib/data/elevenlabs-analysis.test.ts
```

אם מפצלים את `storeCallAnalysis()`:

- לבדוק mapper משותף לשדות metadata.
- לבדוק שמסלול RSVP עדיין מקשר ל-`call_attempts`.
- לבדוק שמסלול Sales שומר row עם `conversation_id` גם בלי `call_attempt_id`.
- לבדוק ש-`rsvp_persisted` לא מחושב במסלול Sales.

---

## אימות אחרי יישום

להריץ:

```bash
npm test -- callbacks
```

להריץ בדיקת טיפוסים לפי הפקודה הקיימת בפרויקט, למשל:

```bash
npm run types:check
```

אם קיימת פקודת lint רלוונטית:

```bash
npm run lint
```

ולבדוק ידנית:

```txt
/admin/callbacks
/admin/callbacks/[id]
/admin/calendar
```

---

## סדר ביצוע מומלץ

1. לתקן/להשלים איסוף `call_analysis` במסלול webhook של AI מכירות.
2. לוודא שהשמירה idempotent לפי `(provider, conversation_id)`.
3. לשמור רק metadata נדרש: score, status, cost, turns, evaluation, data collection.
4. לוודא שאין שמירת transcript/audio/raw dynamic variables.
5. להוסיף בדיקות ל-webhook המכירות ולשמירת analysis.
6. להוסיף טיפוסים ו-helpers ב-`callbacks.ts`.
7. להוסיף labels בעברית ב-`labels.ts`.
8. להוסיף בדיקות data layer.
9. לעדכן את רשימת callbacks.
10. לעדכן את דף פרטי callback.
11. לעדכן את פאנל ה-callback הקיים ביומן עם summary קצר בלבד.
12. לבנות היסטוריית פעולות MVP ממקורות קיימים בלבד.
13. להריץ בדיקות.
14. לבדוק במסך שהמידע ברור ולא עמוס.

---

## החלטה מוצרית לפני יישום מלא

בשלב ראשון מומלץ לבנות CRM צפייה בלבד:

```md
Read-only CRM
```

כלומר:

- הצגת שיחות AI.
- הצגת score.
- הצגת משיבון.
- הצגת evaluation.
- הצגת מצב follow-up.
- שמירת post-call analysis של שיחות מכירה עתידיות.

לא להוסיף עדיין:

- עריכת סטטוס ליד חדשה.
- הערות CRM חדשות.
- pipeline מכירות.
- משימות follow-up.
- שינוי schema, אלא אם מתקבלת החלטה מפורשת להוסיף FK מ-`call_analysis` אל `sales_call_attempts`.

אחרי שהמסך מוכיח שהנתונים מועילים, אפשר להוסיף שכבת CRM אמיתית עם הערות, שלבים ומשימות.
