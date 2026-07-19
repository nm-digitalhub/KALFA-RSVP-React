# תוכנית יישום — אוטומציות Voximplant + ElevenLabs (פריטים 1→5)

**סטטוס:** DRAFT לאישור — **אומת אמפירית מלא 2026-07-19** (2 סוכני-מומחה: משיכות API חיות + קריאת קוד + docs corpus). כל פריט סומן VERIFIED / OPEN / BLOCKED לפי בדיקה חיה, לא זיכרון.

---

## 0. הקשר ומטרה

לסגור נקודות עיוורון תפעוליות (כשלים שקטים) ואת לולאת ה-QA/חיוב של סוכן ה-AI, על גבי תשתית voice-ops הקיימת — בלי לשכפל. חמישה פריטים בסדר ערך/מאמץ עולה.

## 1. עקרונות משותפים (רף האיכות — [[plan-quality-bar-voice-ops]])

- **נרמול metadata-only**: כל payload חיצוני → loose schema + נורמלייזר טהור. **תמלילים/PII/מספרי כרטיס/מספרי CallerID לעולם לא ל-UI**.
- **מוטציות ב-`src/lib/voximplant/mutations.ts`** בלבד (CallList), לעולם לא ב-CLI (guard test קיים מקבע זאת).
- **Slack דרך `sendSlackAlert`** הקיים (קטגוריות `errors`/`send_health`/`campaign_billing`/`security`) — בלי קטגוריה חדשה; dedupe 60ש' לפי level|title|source (+`callback_id`/`conversation_id` כמפתח idempotency).
- **Webhooks**: fail-closed rate-limit + אימות HMAC/hash (constant-time) + persist-then-process + **200-always אחרי השערים**.
- **SSRF מוקשח** לכל הורדה (reuse `log-download.ts`).
- שערים: `tsc` + `lint` + build + בדיקות ממוקדות פר שלב; deploy dark-safe בסוף כל שלב.

---

## פריט 1 — הרחבת account-callback → Slack  ✅ VERIFIED (feasible, additive)
**מאמץ: נמוך · ערך: גבוה (כשלים שקטים)**

ה-route `src/app/api/voximplant/account-callback/[token]/route.ts` **אינו מסתעף לפי `type`** [VERIFIED] — כל POST מאומת מטופל כ-poke (stamp + verified balance pull, 200-always). המעטפת היא `{callbacks: AccountCallback[]}` בלבד (אין `account_id` ברמת-על; הוא בכל פריט). ה-`type` snake_case **שווה לשם ה-data-property** [VERIFIED live: getDoc].

### נקודת ההרחבה (מדויקת)
ב-route שורה ~75 תוצאת הנורמלייזר **מושלכת** (`normalizeAccountCallbackEnvelope(envelope);` — הערך לא נלכד). התיקון: `const { events } = normalize…` → קריאה ל-`alertForAccountCallbacks(events)` בין שלב 4 ל-5. **`min_balance` מוחרג מה-switch** — כבר מכוסה ע"י ה-verified balance pull; אחרת התראה כפולה.

### מפת type→התראה (ערכי `type` מדויקים — **תוקנו מול getDoc החי**)
| `type` (הערך במעטפת) | קטגוריה | רמה | שדות metadata (ללא PII) |
|---|---|---|---|
| `js_fail` | `errors` | **error** | **ריק** (טקסט השגיאה בלוגים המאובטחים, לא ב-payload) |
| `expiring_callerid` ⚠️(לא `caller_id`) | `send_health` | **warn**→error סמוך לפקיעה | `callerids[]` (המספרים שלנו — **רק count**), `expiration_date` |
| `card_payment_failed` | `campaign_billing` | **error** | ריק (ללא PAN) |
| `card_expired` | `campaign_billing` | **warn** | ריק (ללא PAN) |
| `card_expires_in_month` | `campaign_billing` | **info** | ריק |
| `next_charge_alert` | `campaign_billing` | **warn** | `insufficient_funds_amount`, `required_money` |
| `expiring_agreement` | `send_health` | **warn** | `expiration_date`, `until_expiration` (ימים) |
| `expired_agreement` | `send_health` | **error** | `document_ids[]` (count) |
| `call_history_report` | `send_health` | **info** (warn אם `success=false`) | `history_report_id`, `order_date`, `success` |
| `expiring_certificates` / `expired_certificates` / `sip_registration_fail` | — | **info/count-only** | **לא רלוונטי ל-KALFA** (Apple VOIP / SIP צד-ג') |
| `min_balance` | — | — | **מוחרג — כבר מטופל** |

### תיקונים load-bearing (חוסמי קוד copy-ready)
1. **איות**: `expiring_caller_id`→`expiring_callerid`; `expiring_certificate`→`expiring_certificates`; ענף "cert expired"→`expired_certificates` (ה-`certificate_expired` **deprecated+ריק**); SMS נכנס→`sms_inbound`.
2. תעודות + `sip_registration_fail` — **לא רלוונטי** ל-KALFA (PSTN בלבד) → info/count-only, לא warn/error.
3. `min_balance` **מוחרג** מה-switch.
4. הנורמלייזר `normalizeAccountCallbackEnvelope` **כבר** פולט `events:[{type,callbackId}]` לכל type — **אין צורך בשינוי** כדי לנתב לפי type. הרחבה *אופציונלית*: `detail` metadata-only (הסקלרים לעיל + counts של מערכים, לעולם לא המספרים/גופי התעודות/תוכן SMS).

### אימות
יחידה: מיפוי כל type + type לא-מוכר + החרגת min_balance. חי (deploy): curl פר-type + `js_fail` אמיתי ע"י הזרקת שגיאה זמנית לתרחיש בדיקה.

---

## פריט 2 — ElevenLabs post-call webhook + transcript/analysis  ⚠️ VERIFIED חלקית — **קדם-תנאי ארכיטקטוני**
**מאמץ: בינוני · ערך: גבוה (QA + חיוב) — מותנה**

### ⚠️ ממצא מהותי (חוסם ערך, לא היתכנות)
**ElevenLabs ConvAI אינו במסלול השיחות החי** [VERIFIED]: כל 14 השיחות הן preview/SDK/signed-url (`metadata.phone_call=null`, `direction=null`, source `react_sdk`/`unknown`). מסלול השיחה החי הוא **Voximplant Branch B (call.say + Groq)**, לא ElevenLabs. לכן פריט 2 מניב ערך **רק** אם/כאשר ElevenLabs ConvAI ייכנס למסלול החיוג האמיתי (החלטת מוצר — לא בתוכנית הזו). עד אז הוא QA לסביבת ה-preview בלבד.

### 2.1 Webhook + HMAC  ✅ VERIFIED
- `GET /v1/workspace/webhooks`→200; קיים webhook `→ https://kalfa.me/api/elevenlabs/rsvp/update` (`auth_type=hmac`). **⚠️ ה-route הזה לא קיים ברפו** (grep ריק) ו-`GET /v1/convai/settings` מחזיר **`post_call_webhook_id: null`** → **ה-post-call webhook לא מחווט כלל**. חיווט = הצבת `post_call_webhook_id` (dashboard/PATCH).
- **HMAC (סכמה מדויקת [VERIFIED docs])**: header **`ElevenLabs-Signature`** בפורמט **`t=<unix>,v0=<hmac_hex>`**; **HMAC-SHA256** על המחרוזת **`{t}.{rawBody}`** (timestamp, נקודה, גוף גולמי). אימות freshness של ה-timestamp. אימות: `crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`)` + `safeTokenEqual` מול `v0`.
- **הסוד**: נוצר **פעם אחת** ביצירת ה-webhook, **לא ניתן למשיכה** דרך API (405 על per-webhook GET) → אדמין חייב לייצר בפאנל ולהדביק ל-config (`app_settings`/env). **סוגר את ה-OPEN "להשיג secret".**

### 2.2 Conversation detail  ✅ VERIFIED (+ efficiency win)
- **שורות ה-LIST כבר נושאות את סיכום ה-analysis** פר-שיחה (`call_successful`, `call_success_score`, `call_summary_title`, `transcript_summary`, `sentiment_analysis`, `message_count`, `call_duration_secs`, `termination_reason`, `tool_names`) — **אין צורך בקריאה פר-שיחה** ל-metadata באצווה (התוכנית פספסה זאת).
- Detail paths [VERIFIED]: `transcript[]` (turns עם role/message/time_in_call_secs), `analysis.call_successful="success"`, `analysis.transcript_summary`, `analysis.call_summary_title`, `has_audio`, `metadata.{start_time_unix_secs,call_duration_secs,cost,termination_reason,main_language}`.
- **⚠️ caveat**: `call_success_score`/`evaluation_criteria_results`/`data_collection_results` **ריקים** כי בקונפיג הסוכן `evaluation.criteria=[]`, `data_collection={}`, `sentiment_analysis.enabled=false`. הנורמלייזר יתייחס אליהם כ-optional. `call_successful`/`transcript_summary`/`call_summary_title` מאוכלסים תמיד.

### 2.3 קישור conversation→call_attempt  🔴 BLOCKED
`conversation_initiation_client_data.dynamic_variables` מכיל **רק** `event_name/guest_name/event_date/event_venue` — **אין שום מזהה KALFA** (לא token/attempt/event/guest) [VERIFIED]. הקונפיג מצהיר בדיוק את 4 אלה. → **חייבים להזריק dynamic variable מותאם בתחילת השיחה** (למשל `kalfa_attempt_token` אטום פר-ניסיון): (1) להוסיף placeholder ל-`dynamic_variable_placeholders`; (2) המפעיל (signed-url/batch/bridge) להעביר אותו. הוא חוזר ב-detail וב-webhook payload. עד אז — fallback לאחסון לפי `conversation_id` בלבד.

**מסקנה פריט 2**: היתכנות טכנית מלאה; **הערך מותנה** בהכנסת ElevenLabs למסלול החי + הזרקת מזהה. אם לא — לדחות/להריץ כ-QA preview בלבד.

---

## פריט 3 — התראת מכסה ElevenLabs 80%/95%  ✅ VERIFIED (עם caveat מפתח)
**מאמץ: נמוך · ערך: בינוני**

- `GET /v1/user/subscription` [VERIFIED live]: `tier=creator`, `character_count=9860`, `character_limit=350071` (**2.8%** → אין התראה, תקין), `next_character_count_reset_unix=1785110999`. שדות הצריכה כבר בקוד (`elevenlabs-status.ts` ש' 193–195).
- **⚠️ caveat מפתח**: העובד רק עם **מפתח ה-DB** (`app_settings.elevenlabs_api_key`, יש לו `user_read`). מפתח ה-**env** (`.env.local`) מחזיר **401 missing `user_read`**. ה-resolver הוא DB-first → עובד היום, אך אם ינוקה מפתח ה-DB, ה-fallback ל-env יחזיר null בשקט (fail-safe בולע 401) → ההתראה תהפוך ל-no-op שקט. **המלצה**: (א) להעניק `user_read` גם למפתח ה-env, **או** (ב) שבדיקת המכסה תאשש non-null ותתריע על "מכסה לא ניתנת לקריאה".

### קבצים
`evaluateQuotaAlert({count,limit})` טהור (כמו `evaluateBalanceAlert`) + `runElevenLabsQuotaCheck()` fail-safe (config-gated) → `sendSlackAlert('send_health')` + תור `elevenlabs-quota-check` cron `0 */6 * * *`.

---

## פריט 4 — זיהוי drift בקונפיג הסוכן  ✅ VERIFIED (in-sync כרגע)
**מאמץ: נמוך · ערך: בינוני**

- `GET /v1/convai/agents/{id}` [VERIFIED]: `version_id=agtvrsn_3401kxks7kxef5fb8bjbv1086jxc` **תואם ל-`agents.json`** (deployed==registered). כל השדות הקנוניים **in-sync** מול `agent_configs/KALFA-RSVP-Preview.json`.
- **⚠️ canonicalization gotcha**: אם משווים **שמות** כלים מ-`prompt.tools[].name` — החי מציג 4 (`end_call` נוסף) והקובץ 3 (`end_call` יושב ב-`built_in_tools`) → **false-positive drift**. **תיקון**: להשוות `sorted(tool_ids)` (זהים), או למזג `tools[].name`+`built_in_tools.*`. להחריג מה-hash מפתחות live-only (`version_id/metadata/access_info/phone_numbers/whatsapp_accounts/procedures/branch_id/...`).
- **נתיבים קנוניים ל-hash**: `name`, `conversation_config.agent.language`, `…agent.first_message`, `…agent.prompt.prompt`, `…prompt.llm`, `…prompt.temperature`, `conversation_config.tts.voice_id`, `…tts.model_id`, `sorted(tool_ids)`.

### קבצים
`detectAgentDrift()` ב-`elevenlabs-status.ts` → `{inSync, changedFields[]}` (שמות שדות בלבד) + Badge בדשבורד + cron אופציונלי → Slack (`errors`, warn) על סטייה.

---

## פריט 5 — CallList כחייגן קמפיינים  ✅ VERIFIED (params/enums/contract + balance/rule_id חיים)
**מאמץ: גבוה · ערך: גבוה (ארכיטקטוני) — פרויקט בפני עצמו**

### מוטציות (ב-`mutations.ts`, לא CLI) — params [VERIFIED httpapi-calling.md]
- **CreateCallList** — חובה: `rule_id`, `name` (≤255, ללא `/\`), `priority` (0=גבוה ביותר), `max_simultaneous`, `num_attempts` (**1–5**), `file_content` (**CSV בגוף/multipart — לא URL**). אופציונלי: `delimiter`(`;`), `encoding`(UTF-8), `interval_seconds`, `list_custom_data`, `task_priority_strategy`. מחזיר `{list_id, batch_id, count}`.
- **AppendToCallList** (`list_id`+`file_content`→`batch_id` חדש), **EditCallList**, **CancelCallListTask** (≤1000 לפי `tasks_ids`/`tasks_uuids`), **StopCallListProcessing**/**RecoverCallList**, **GetCallListDetails** (`output=json`; status **0=New 1=InProgress 2=Processed 3=Error 4=Canceled** — תואם `VOX_CALL_LIST_TASK_STATUS` הקיים).
- **custom_data פר-שורה**: כל שורת CSV → JSON string ל-`VoxEngine.customData()` → `JSON.parse`. **עוקף את תקרת 200-הבתים של `script_custom_data`** (אין תקרה *מתועדת* על custom_data ברשימה — לא "בלתי מוגבל"). עמודות תזמון: `__start_execution_time`/`__end_execution_time` (**UTC HH:mm:ss**), `__start_at`, `__task_uuid`.
- **תעבורה**: `voxRequest` כבר שולח `x-www-form-urlencoded` בגוף (לא URL) → `file_content` רוכב כשדה body ללא שינוי transport.

### חוזה תרחיש (השער המרכזי) [VERIFIED vox-ref-callflow.md]
`CallList.reportResult(result, cb)` = הצלחה + `result_data` + עצירת ניסיונות. `CallList.reportError(err, cb)` = ניסיון כושל → retry לפי `num_attempts`. **GOTCHA קריטי (verbatim)**: יציאה **בלי** reportResult/reportError → המשימה **מסומנת מוצלחת בשקט ללא retry**. כל ענף טרמינלי (busy/no-answer/crash/timeout/Disconnected) **חייב** לדווח. זמין גם `requestNextAttempt` ("תתקשר אליי מאוחר יותר"/schedule_callback).

### בדיקות חיות [VERIFIED]
- `account`: יתרה **$5.143017**, `active=true` (≥$1 ✓).
- `rules --application-id 11107202`: **`rule_id=1494311`** (`OutCall`, `.*`) → תרחיש **`RSVP` #907512** — זמין ל-CreateCallList.
- `call-lists`: עובד, **0 רשימות** (slate נקי).

### שלבים
1. מוטציות + CSV builder + טבלת `vox_call_lists` (campaign_id→list_id, batch_ids, status). יתרה≥$1 gate. **בלי חיוג** (יצירה מאחורי flag).
2. **redeploy** התרחיש עם `reportResult/reportError` בכל יציאה (מצטמד ל-Branch B; התרחיש כיום רץ תחת StartScenarios, לא CallList — זה השער).
3. חיווט ללייפסייקל: חלונות UTC (המרה מ-Asia/Jerusalem), `AppendToCallList` לאורחים מאוחרים, `CancelCallListTask` כשענו ב-WhatsApp.
4. `GetCallListDetails(json)` → per-reached billing.

---

## רצף ביצוע כולל (מדורג)

| שלב | פריט | סטטוס אימות | תלות | שער | עצירה בטוחה |
|---|---|---|---|---|---|
| A | **1** callback | ✅ **DEPLOYED beta 2026-07-19** | קיים | 1702 tests+tsc+lint+build ✓; route חי (404 dark-safe smoke) | כן |
| B | **3** מכסה | ✅ **COMMITTED d8a9e5a** (pending deploy) | קיים | 1712 tests+tsc+lint+worker-esbuild ✓; קובץ ייעודי elevenlabs-quota.ts (מראה voximplant-balance.ts) | כן |
| C | **4** drift | ✅ VERIFIED (in-sync) | קיים | fixtures + tool_ids canonicalize | כן |
| D | **2** webhook+analysis | ✅ **DEPLOYED + WIRED + e2e-verified** (42df383) | migration + wire | signed POST→200+row (PII-free), bad-sig→401, public path→401, post_call_webhook_id=beta | כן |
| E | **5** CallList | ✅ VERIFIED | migration + redeploy | staged §5 | כן (flag + pg-boss fallback) |

**המלצת סדר**: A→B→C זול/מהיר וללא תלות (יום). E פרויקט נפרד מוכן. **D לדחות** עד החלטת מוצר על מסלול ElevenLabs (כרגע לא בשרשרת החיה).

## תוצאות אימות אמפירי (2026-07-19) — סיכום
| תת-פריט | סטטוס | ממצא מפתח |
|---|---|---|
| 1 קטלוג callback + route + normalizer | ✅ VERIFIED | route מקבל הכל; 3 תיקוני איות; min_balance מוחרג |
| 2.1 webhook+HMAC | ✅ VERIFIED | `ElevenLabs-Signature: t=,v0=` HMAC-SHA256 על `{t}.{body}`; secret create-once; **לא מחווט (post_call_webhook_id=null)** |
| 2.2 conversation detail | ✅ VERIFIED | list rows כבר נושאים analysis (efficiency); score/criteria ריקים (disabled בקונפיג) |
| 2.3 link→call_attempt | 🔴 BLOCKED | אין מזהה KALFA; **ElevenLabs לא במסלול החי**; חייבים inject token |
| 3 quota | ✅ VERIFIED | 9860/350071 creator; **רק מפתח DB (env חסר user_read)** |
| 4 drift | ✅ VERIFIED in-sync | version_id תואם agents.json; gotcha: השווה tool_ids |
| 5 CallList | ✅ VERIFIED | rule_id 1494311, balance $5.14, num_attempts≤5, CSV body, report-contract |

## טיפול ב-⚠️ — אימות עמוק וסגירה (2026-07-19)

אימות אמפירי מעמיק (2 סוכנים: getDoc חי + קוד ה-SDK הרשמי + probes) של כל סימוני ה-⚠️, וסגירה בקוד היכן שאפשר:

| ⚠️ | פריט | טיפול | סטטוס |
|---|---|---|---|
| איות `expiring_callerid`/`certificates` | 1 | 12 סוגי ה-`type` אומתו **מדויק** מול getDoc; אין silent-miss | ✅ סגור |
| caveat: list כמערך או מחרוזת | 1 | `countMaybeList` — `callerid_count`/`document_count` מתאכלסים בשני המקרים (Voximplant מטייפ list כסקלר) | ✅ סגור בקוד+בדיקה |
| **פער כיסוי שהתגלה** | 1 | הוספת `account_is_frozen` (error — הקפאה עוצרת הכל, לא מכוסה ב-balance pull), `account_is_unfrozen` (info), `reset_account_password_request` (security) | ✅ סגור בקוד+בדיקה |
| caveat מפתח quota | 3 | ההתראה "לא ניתן לקריאה" קיימת; הוספתי **נתיב תיקון** מפורש ל-detail (הענק user_read / הגדר DB key) | ✅ סגור בקוד; פעולת פאנל (הענקת user_read ל-env) = נותרה למשתמש |
| HMAC scheme | 2 | `verifyElevenLabsWebhook` — סכמה מאומתת מקוד ה-SDK: `t=,v0=`, HMAC-SHA256 על `{t}.{body}`, 30 דק' חד-צדדי, `v0=` בהשוואה, timing-safe. משתמש ב-`ELEVENLABS_WEBHOOK` | ✅ ה-verifier סגור בקוד+8 בדיקות; ה-**route** = שלב הבא (ר' OPEN) |
| קישור conversation→attempt | 2 | אומת סופית: **אין** מזהה KALFA ב-dynamic_variables (רק 4 placeholders); כל 14 non-telephony | ⚠️ דורש הזרקת `kalfa_attempt_token` בתחילת שיחה (החלטת מוצר) |
| שדות analysis ריקים | 2 | אומת: `evaluation_criteria/data_collection/sentiment` ריקים כי מכובים בקונפיג; `call_success_score` null ב-13/14 (לא 14/14) — optional | ⚠️ למלא criteria בקונפיג הסוכן כדי לאכלס |
| webhook לא מחווט + route חסר | 2 | אומת: `post_call_webhook_id=null`, 2 webhooks רשומים (kalfa.me+beta.kalfa.me), אירועים שסומנו = voice_removal+STT (**לא** post_call_transcription), route לא קיים ברפו | ⚠️ חיווט + בניית route (שלב הבא) |
| drift canonicalization | 4 | `canonicalizeAgent`+`compareAgentCanonical` — משווה `sorted(tool_ids)` (לא tools[].name), מחריג מפתחות live-only; false-positive של `end_call` נמנע by design | ✅ סגור בקוד+בדיקה (IO/דשבורד = שלב C) |

**סיכום:** 5 מתוך 8 ה-⚠️ **נסגרו בקוד** (commit נפרד) עם בדיקות. 3 הנותרות שייכות כולן ל-**פריט 2** ותלויות בהחלטת המוצר (ElevenLabs במסלול החי) + חיווט חיצוני — לא ניתנות לסגירה חד-צדדית בקוד.

## סגירת 2 הנקודות הפתוחות (2026-07-19)

מחקר תיעוד (ElevenLabs personalization + קורפוס Voximplant `vox-ref-ai-providers`) + יישום:

**נקודה 1 — קישור conversation→call_attempt: ✅ סגורה ומאומתת e2e (KALFA-side, DEPLOYED 8e37a1e).**
- וקטור מאומת: `conversation_initiation_client_data.dynamic_variables.kalfa_attempt_token` — אחיד בכל דרכי-ההתחלה (SDK/WebSocket/outbound/batch), חוזר ב-webhook.
- מיגרציה `20260719162804`: `call_attempts.el_correlation_nonce` (partial-unique) — nonce **לא-מסמיך** (לא access_token — מניעת הדלפת bearer, precedent Branch B).
- נורמלייזר קורא **רק** את ה-token שלנו (guest vars נזרקים); DAL linker פותר token→call_attempt→ממלא `call_attempt_id`+`event_id`+`linked_at` (best-effort, orphan on miss).
- placeholder נוסף ל-IaC (`agent_configs`). אימות חי: webhook חתום עם token → שורה מקושרת נכון (event_id תואם), PII=0, נוקה.

**נקודה 2 — ElevenLabs במסלול החי: ⚠️ מגודרת (החלטת מוצר + שערים חיצוניים).** הארכיטקטורה מאומתת מהתיעוד; היישום דורש החלטות + שערים שאי-אפשר לסגור חד-צדדית:
- **מסלול A (מומלץ) — Voximplant bridge**: `ElevenLabs.AgentsClient` (createAgentsClient{agentId,xiApiKey,includeConversationId}) + `VoxEngine.sendMediaBetween(call,client)`. Voximplant נשאר המחייג (מספר/consent/חיוב), ElevenLabs המוח; ה-nonce עובר ב-`conversationInitiationClientData({dynamic_variables})`; xi-api-key דרך ctx (precedent Groq). דורש rewrite+deploy תרחיש (voxengine-ci).
- **מסלול B — ElevenLabs native outbound**: `POST /v1/convai/twilio/outbound-call` או `/sip-trunk/outbound-call` או `/batch-calling/submit`. דורש מספר מיובא (Twilio חדש, או SIP trunk לשימוש-חוזר במספר Voximplant — טעון אימות voximplant-engineer).
- **שערים לכל המסלולים**: (1) החלטת טלפוניה (A/B), (2) שער consent/משפטי [[voximplant-b1-consent-plan]] לשיחות אמת, (3) אימות איכות קול עברי (ElevenLabs), (4) deploy תרחיש/מספר, (5) go לשיחת בדיקה מבוקרת. סגירה e2e אפשרית דרך שיחת בדיקה למספר הבעלים (עוקף שער consent-לאורחים).

## OPEN שנותרו (החלטות, לא אימות)
- **מוצר**: האם/מתי ElevenLabs ConvAI נכנס למסלול החיוג החי (שער הערך של פריט 2).
- **תפעול**: הענקת `user_read` למפתח env (פריט 3) · יצירת+הדבקת ה-HMAC secret של ElevenLabs (פריט 2) · redeploy התרחיש עם חוזה report (פריט 5).
