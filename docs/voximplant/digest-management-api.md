# Voximplant Management API — Digest מאוחד (pillar: management-api)

מקורות: איחוד מלא של שתי קבוצות המחקר —
- httpapi-platform (221 עמודים בהיקף, 27 נקראו לעומק + מלאי מלא): `/var/www/vhosts/kalfa.me/.claude/plans/floofy-cooking-thompson-agent-af4277610ee6ed71b.md`
- httpapi-calling (75 עמודים, כולם נקראו): `/var/www/vhosts/kalfa.me/.claude/plans/floofy-cooking-thompson-agent-aa8ddb04438c79915.md`

הערה תפעולית: הקובץ נכתב לנתיב ה-plan כי plan mode פעיל בסשן (כתיבה ל-scratchpad חסומה); היעד המקורי היה `vox-research/digest-management-api.md`. ה-digest הזה מחליף את קריאת ה-notes הגולמיים.

תיעוד חי: `https://voximplant.com/docs/references/httpapi/<section>` (נשלף 2026-07-19 דרך getDoc API).

---

## מפת קטגוריות מלאה של ה-pillar

| קטגוריה | # methods | ליבה | רלוונטיות ל-KALFA |
|---|---|---|---|
| Structure + Errors | 199 structs + 458 קודי שגיאה | פורמט בקשות, auth, טיפוסים | בסיס לכל client |
| Accounts | 15 | חשבון, יתרה, callbacks | גבוהה (ניטור יתרה) |
| Applications | 4 | CRUD אפליקציות | בינונית (קריאה) |
| Users | 4 | SDK/SIP endpoints | נמוכה |
| RoleSystem | 16 | service accounts, מפתחות JWT, roles | גבוהה |
| Secrets | 5 | secret store ברמת אפליקציה | גבוהה |
| KeyValueStorage | 5 | KV משותף עם VoxEngine | גבוהה |
| SMS | 5 | P2P + A2P SMS | נמוכה-בינונית |
| Scenarios | 8 | CRUD תרחישים + StartScenarios | קריטית |
| Rules | 5 | routing rules (regex) | גבוהה |
| CallLists | 12 | חייגן קמפיינים מנוהל (CSV) | קריטית (בהערכה) |
| History | 11 | היסטוריית שיחות/כספים/audit | קריטית (billing) |
| PhoneNumbers | 15 | רכישת מספרים וירטואליים | עתידית |
| CallerIDs | 2 | אימות מספר קיים כ-CLI | גבוהה (חלופה זולה) |
| OutboundTestNumbers | 5 | מספר בדיקה אישי בחינם | גבוהה (dev/QA) |
| Queues (ACDv1) | 9 | תורי operators ישנים | לא רלוונטי (legacy) |
| Skills (ACDv1) | 5 | כישורי operators ישנים | לא רלוונטי (legacy) |
| SmartQueue (ACDv2) | 21 | omnichannel queueing | רק אם תתווסף העברה לאדם |
| AuthorizedIPs | 4 | allow/deny IP ל-API | hardening זול |
| PSTNBlacklist | 4 | חסימת שיחות נכנסות | לא DNC יוצא! |
| DialogflowCredentials | 5 | מפתחות Google Dialogflow | לא רלוונטי (Groq) |
| Invoices | 2 | חשבוניות USD/EUR | נמוכה |
| PushCredentials | 5 | APNS/FCM ל-SDK | לא רלוונטי |
| RecordStorages | 1 | מיקומי אחסון הקלטות | אם נשמרות הקלטות |
| RegulationAddress | 6 | KYC לרכישת מספרים | רק בקניית מספר IL |
| SIPRegistration / SIPWhiteList | 5+4 | SIP חיצוני | לא רלוונטי |
| WABPhoneNumbers | 4 | מספרי WhatsApp Business בצד Voximplant | לא רלוונטי (Meta ישיר) |

---

## מבנה בקשות, Auth ופורמט תגובות

- Endpoint בסיס: `https://api.voximplant.com/platform_api/<MethodName>/` — GET או POST עם פרמטרים URL-encoded; רשימות IDs מופרדות ב-`;` (מקודד `%3B`). ל-`GetAccountInfo` יש `api_address` פר-חשבון.
- שני מצבי auth:
  1. Legacy: `account_id` + `api_key` (או שם/אימייל + סיסמה) ישירות ב-query string.
  2. **Service-account JWT** (המומלץ): header בסגנון `Authorization: Bearer <JWT>` חתום ב-private key שמונפק ב-`CreateKey` (RoleSystem). כל הדוגמאות בתיעוד משתמשות בזה (`token.sh`).
- תגובות: JSON — או `result` (לרוב `result: 1` + אובייקטים typed), או `{"error": {code, msg}}` (struct `API_Error`).
- Pagination אחיד ברשימות: `count` + `offset`, מוחזרים `count`, `total_count`, `result[]`.
- **כל method מתעד roles מורשים** (Owner / Admin / Developer / Supervisor / User manager / **Call list manager** / Accountant / Payer / Support / CallsSMS) — זה מה שמגדיר מה מפתח scoped יכול לקרוא. שגיאת role חסר: 104 FORBIDDEN_COMMAND.
- Timestamps: UTC, פורמט `YYYY-MM-DD HH:mm:ss`, אלא אם ניתן פרמטר `timezone` ('auto' = אזור הזמן של החשבון).
- כלל אצבע רשמי: כל דבר ארוך (scripts, custom data, file_content) — **POST עם body בפורמט x-www-form-urlencoded UTF-8**, לעולם לא ב-URL ("network devices tend to drop HTTP requests with large headers").

---

## RoleSystem — service accounts ומפתחות API (16 methods)

- **CreateKey** מחזיר `KeyInfo` כולל `private_key` — **מוצג פעם אחת בלבד**; אפשר לצרף roles בהרשאות מינימום. ניהול: GetKeys / UpdateKey / DeleteKey / Set/Get/RemoveKeyRoles.
- Subusers (לוגינים אנושיים, Owner-only): AddSubUser / GetSubUsers / SetSubUserInfo / DelSubUser + ניהול roles שלהם.
- קטלוג roles: GetRoles / GetRoleGroups. **`role_id` ו-`role_name` הם mutually exclusive** (שגיאה 449).
- מגבלות: 437 MAX_NUMBER_OF_KEYS_EXCEEDED, 438 MAX_NUMBER_OF_SUB_USERS_EXCEEDED, 435 INVALID_ROLE_SET.
- היגיינת JWT — קודי שגיאה ייעודיים: **447** INVALID_TOKEN_FORMAT, **454** INVALID_TOKEN_TTL (יש TTL מקסימלי נאכף), **455** TOKEN_ISSUED_IN_FUTURE, **456** TOKEN_EXPIRED.
- אפשר לקשור מפתח ל-rule ספציפי דרך `bind_key_id` ב-AddRule / `attached_key_id` ב-GetRules — scoping של service account לרול אחד בלבד.

## Secrets — secret store ברמת אפליקציה (5 methods)

- AddSecret (name+value פר-אפליקציה), GetSecrets (ערכים ממוסכים), **GetSecretValue** (קריאה מפורשת חזרה), SetSecretInfo (רוטציה/שינוי שם), DelSecret.
- Scenarios של VoxEngine יכולים לקרוא secrets של האפליקציה — המקום הפלטפורמי הנכון למפתחות LLM/TTS.

## KeyValueStorage — KV משותף עם VoxEngine (5 methods)

- SetKeyValueItem (key+value, `ttl?` בשניות / `expires_at?`), GetKeyValueItem, GetKeyValueItems (חיפוש לפי prefix), GetKeyValueKeys, DelKeyValueItem. Roles: Owner/Admin/Developer.
- מפתחות ייחודיים פר-אפליקציה; מוחזר `KeyValueItems {key, value, expires_at}`.
- **זה אותו storage ש-VoxEngine קורא/כותב in-scenario (ApplicationStorage)** — ערוץ העברת context דו-כיווני בין ה-backend לתרחיש.
- gotcha: מגבלות גודל value/מספר items **לא מתועדות בצד ה-HTTP API** (כנראה בתיעוד ApplicationStorage של VoxEngine — pillar אחר).

## Accounts + מנגנון Callbacks (15 methods)

- **GetAccountInfo** (`return_live_balance?`) → AccountInfoType + יתרה חיה + `api_address`.
- **SetAccountInfo** מגדיר בין השאר `callback_url` + `callback_salt` — יעד webhooks לכ-**40 סוגי `*Callback`** מתועדים (envelope `AccountCallback`): **MinBalanceCallback**, CardPaymentCallback, TranscriptionCompleteCallback, InboundSmsCallback, JSFailCallback, CallHistoryReportCallback ועוד; וכן `send_js_error`, `store_inbound_sms`/`store_outbound_sms`.
- ניהול child accounts (resellers): AddAccount / CloneAccount / SetChildAccountInfo / GetChildrenAccounts.
- מחירים ותוכניות: ChangeAccountPlan, GetAccountPlans, GetAvailablePlans, GetResourcePrice, GetSubscriptionPrice, GetCurrencyRate, GetMoneyAmountToCharge.

## Applications & Users

- Applications (4): AddApplication, DelApplication, **GetApplications** (`with_rules?`, `with_scenarios?` — snapshot בקריאה אחת של כל חיווט app→rule→scenario), SetApplicationInfo (`secure_record_storage?`).
- Users (4): AddUser / DelUser / GetUsers / SetUserInfo — users הם SDK/SIP endpoints בתוך אפליקציה; **לא נדרשים ל-outbound PSTN טהור**.

---

## Scenarios + StartScenarios (8 methods)

- **AddScenario / SetScenarioInfo**: `scenario_name` < 30 תווים, `scenario_script` < **128 KB**, ב-POST. תרחיש **חייב להיות קשור ל-rule** כדי לרוץ; ללא application → נכנס ל-Shared folder (זמין לכל האפליקציות). זה נתיב ה-deploy של voxengine-ci.
- DelScenario (רשימה או 'all'), GetScenarios (סינון שם = substring, case-insensitive; `with_script=true` דורש scenario_id), BindScenario (bind/unbind רשימת תרחישים ↔ rule, אותה אפליקציה), ReorderScenarios (סדר ריצה בתוך rule).
- **StartScenarios** (roles כולל CallsSMS):
  - פרמטרים: `rule_id` (חובה, ה-rule חייב תרחיש מקושר), `application_id/name`, `user_id/name`, `script_custom_data`, `reference_ip`, `server_location` (עדיף על reference_ip).
  - `script_custom_data` נקרא בתרחיש דרך `VoxEngine.customData()`; ההמלצה הרשמית: **POST עם השדה `custom_data` ב-body** (x-www-form-urlencoded UTF-8). **המגבלה של ~200 bytes ש-KALFA מדדה אינה מתועדת** — אמפירית בלבד.
  - **מגבלה קשיחה: 200 בקשות HTTP מקביליות ל-StartScenarios → HTTP 429** עד שהבקשות הפעילות מתנקזות.
  - מחזיר: `call_session_history_id` (**מפתח ה-join לרקונסיליאציה** מול GetCallHistory) + `media_session_access_secure_url` — **פגיעת HTTP(S) ב-URL הזה מרימה `AppEvents.HttpRequest` בתוך התרחיש החי** = ערוץ שליטה/דחיפה mid-call (עצירת תרחיש, דחיפת נתונים).
- StartConference: אותו מבנה + `conference_name` (< 50) לוידאו; לשמע רגיל משתמשים ב-StartScenarios.

## Rules — routing (5 methods)

- **AddRule**: `rule_name` (< 100), `rule_pattern` (regex, < **64 KB**), `rule_pattern_exclude`, רשימת scenarios, `video_conference`, `bind_key_id` (קשירת service account ל-rule).
- SetRuleInfo, DelRule, **ReorderRules** (הסדר קובע — ה-rule הראשון שמתאים מנצח), **GetRules** עם `template=<מספר>` — בדיקת sanity לאיזה rule מספר נתון ינותב (+`with_scenarios`, `attached_key_id`).

## CallLists — חייגן קמפיינים מנוהל (12 methods)

קמפיין outbound מנוהל-פלטפורמה מונע CSV: כל שורה = task (נמען אחד); הפלטפורמה מריצה את התרחיש של ה-rule פר-task, מנהלת ניסיונות/קצב; התרחיש מדווח תוצאה חזרה (`result_data`).

- **CreateCallList**: חובה `rule_id`, `name` (≤255, בלי `/` `\`), `priority` (0 = הגבוה ביותר), `max_simultaneous`, `num_attempts` (**מקס 5**), `file_content` (CSV ב-body/multipart — לא ב-URL). אופציונלי: `delimiter` (ברירת מחדל `;`), `encoding` (UTF-8), `interval_seconds` בין ניסיונות, `list_custom_data`, `server_location`, `task_priority_strategy` = `first_attempts` (ברירת מחדל) | `repeated_attempts`. מחזיר `list_id` + `batch_id` (UUID) + `count`.
- **עמודות CSV "קסומות"** פר-שורה: `__start_execution_time` / `__end_execution_time` (חלון קריאה יומי, UTC+0 `HH:mm:ss`), `__start_at` (UNIX ts; בלעדיו מתחיל מיד), `__task_uuid` (≤40 תווים, ייחודי ברשימה), וגם `call_schedule` JSON פר-רשומה.
- **AppendToCallList**: הוספת tasks לרשימה קיימת — כל append מקבל `batch_id` חדש (מתאים לאורחים שנוספו מאוחר).
- **GetCallLists**: סינון list_id/'all', name, is_active, טווח תאריכים, application_id, type_list (AUTOMATIC|MANUAL). סטטוס רשימה ∈ {In progress, Completed, Canceled}.
- **GetCallListDetails**: `output` = csv (ברירת מחדל) | **json** | xls; מחזיר פר-task: task_id, task_uuid, **status (0=New, 1=In progress, 2=Processed, 3=Error, 4=Canceled)**, attempts_left, custom_data, **result_data** (מה שהתרחיש דיווח או שגיאת runtime), last_attempt, חלונות ביצוע.
- שליטה: EditCallList (פרמטרי רשימה; רשימה לא קיימת → 251, server_location שגוי → 496), EditCallListTask (לפי task_id/uuid: attempts_left, start_at, custom_data, call_schedule, חלון יומי min+max יחד), EditCallListTasksPriority (JSON array), **CancelCallListTask** (עד **1000** tasks לקריאה), CancelCallListBatch, **StopCallListProcessing / RecoverCallList** (השהיה/חידוש רשימה שלמה), DeleteCallList.
- **מגבלה קריטית: יתרה חייבת להיות ≥ $1 USD** אחרת העיבוד לא מתחיל / נעצר מיד.
- Roles: Owner/Admin/Developer/**Call list manager** (role ייעודי לתפעול קמפיינים בלבד).

## History — רקונסיליאציה וחיוב (11 methods)

- **GetCallHistory** (sync): חובה `from_date`/`to_date`; סינון לפי **`call_session_history_id` (רשימה, ≤1000 IDs)** או **`call_session_history_custom_data`**, application, rule_name, מספרים, user; דגלים `with_calls`, `with_records`, `with_total_count` (להשמיט = מהיר יותר), `desc_order`, `timezone`. **Paging: `count` ≤ 1000, `offset` ≤ 10000** — לעומק יותר חייבים async.
  - מחזיר `CallSessionInfoType[]`: call_session_history_id, custom_data, duration, start_date, **`finish_reason` ∈ {Normal termination, Insufficient funds, Internal error (billing timeout), Terminated administratively, JS session error, Timeout}**, `log_file_url` (**retention: חודש אחד בלבד**), records[], calls[] — כל `CallInfoType`: call_id, remote_number, incoming, **`successful` (bool), duration, cost, end_reason**, record_url, transaction_id, custom_data.
- ייצוא bulk: GetCallHistoryAsync / GetBriefCallHistory (csv בלבד) / GetTransactionHistoryAsync / GetAuditLogAsync → **GetHistoryReports** (`history_type` ∈ {calls, calls_brief, transactions, audit, **call_list**, transactions_on_hold}; לכל report יש `store_until` — פג תוקף) → **DownloadHistoryReport** (קובץ gzip — `curl --compressed`).
- GetTransactionHistory (+Async): תנועות כספים (`transaction_type`: resource_charge, subscription_charge, card_payment…, `is_uncommitted` = on-hold).
- **GetAuditLog** (+Async, **Owner בלבד**): audit של שינויי חשבון — סינון לפי פקודות, IP, admin, `advanced_filters`.
- **DeleteRecord**: מחיקת הקלטה + transcription לפי record_id/record_url — מחיקות פרטיות.

## PhoneNumbers — רכישת מספרים (15 methods)

- זרימת רכישה: GetPhoneNumberCategories → GetPhoneNumberRegions / CountryStates → GetNewPhoneNumbers (מלאי, `phone_number_mask`) → **AttachPhoneNumber** (ייתכן `regulation_address_id` למדינות מפוקחות; **הרכישה שומרת מראש את דמי המנוי של החודש הבא + מסים**) → **BindPhoneNumberToApplication** (+rule_id אופציונלי).
- GetPhoneNumbers (activation_status, verification_status, is_bound_to_application…), DeactivatePhoneNumber (Owner), SetPhoneNumberInfo (`incoming_sms_callback_url` פר-מספר), **IsAccountPhoneNumber** (E.164 **בלי +**) — בדיקת שייכות זולה.
- דוחות async: GetPhoneNumbersAsync → GetPhoneNumberReports → DownloadPhoneNumberReport (gzip).

## CallerIDs — CLI ממספר קיים (2 methods בתיעוד)

- **GetCallerIDs** → CallerIDInfoType: callerid_number, active, **`verified_until` (האימות פג!)**, code_entering_attempts_left, verification_call_attempts_left.
- **DelCallerID** — "you cannot delete a CID permanently (the antispam defence)".
- gotcha תיעודי: methods של Add/Verify/Activate CallerID **לא קיימים בסעיף הזה** — האימות כנראה מנוהל דרך Control Panel. Roles: Owner/Admin בלבד.

## OutboundTestNumbers — בדיקות בחינם (5 methods)

- **מספר בדיקה אישי אחד בלבד**: AddOutboundTestPhoneNumber (E.164; להחלפה יש למחוק קודם) → VerifyOutboundTestPhoneNumber (הפלטפורמה מתקשרת **ומקריאה קוד**; **5 ניסיונות/יום, 100 סה"כ, ≥ דקה בין ניסיונות**) → ActivateOutboundTestPhoneNumber (`verification_code`) → GetOutboundTestPhoneNumbers / DelOutboundTestPhoneNumber.

## SMS (5 methods)

- **SendSmsMessage** (P2P): המקור חייב להיות מספר שנרכש ב-Voximplant, תומך SMS (is_sms_supported) ועם ControlSms מופעל. מחזיר message_id + fragments_count.
- **A2PSendSms**: batch (`dst_numbers` מופרד `;`), **דורש SenderID שמותקן דרך support**. Role: CallsSMS. מחזיר SmsTransaction[] + FailedSms[].
- ControlSms פר-מספר; GetSmsHistory / A2PGetSmsHistory (`output` csv). SMS נכנס מגיע כ-InboundSmsCallback ל-callback_url.
- שגיאות SMS: 385 SENDING_SMS_ERROR, 386 SMS_DISABLED_FOR_NUMBER, 509 A2P_SMS_DISABLED, 528 NOT_SUPPORT_SMS.

## SmartQueue (ACDv2) מול Queues/Skills (ACDv1 legacy)

- **SmartQueue (21 methods)** — ACDv2 omnichannel: SQ_AddQueue / SQ_SetQueueInfo (אסטרטגיות בחירת agent/task, גודל תור, המתנה מקס), SQ_Bind/UnbindAgent, SQ_Bind/UnbindSkill, SQ_GetAgents/Queues/Skills, מיפוי סטטוסים מותאמים; דיווח מפוצל: GetSmartQueueRealtimeMetrics (חלון 30 דק'), GetSmartQueueDayHistory (יומיים), RequestSmartQueueHistory (טווח חופשי), GetSQState.
- **Queues (9) + Skills (5) — ACDv1 ישן**: התיעוד עצמו מסמן אותם כ-ACDv1-only; לא להשתמש לחדש.

## סעיפים נוספים (platform)

- **AuthorizedIPs (4)**: Add/Del/Get/CheckAuthorizedAccountIP — allow/deny IP לגישת Management API (מגבלת כמות: שגיאה 323).
- **PSTNBlacklist (4)**: חוסם **רק שיחות נכנסות** למספרים שנרכשו — **אינו מנגנון DNC לשיחות יוצאות**.
- **DialogflowCredentials (5)**: מפתחות Google Dialogflow פר-אפליקציה — לא רלוונטי (KALFA על Groq bridge).
- **Invoices (2)**: GetAccountInvoices (חשבונות USD/EUR) + DownloadInvoice.
- **PushCredentials (5)**: APNS/FCM/Huawei ל-SDK mobile — לא רלוונטי.
- **RecordStorages (1)**: GetRecordStorages — היכן נוחתות הקלטות.
- **RegulationAddress (6)**: קישור כתובת KYC למספרים מפוקחים — רלוונטי רק בקניית מספר IL.
- **SIPRegistration (5) / SIPWhiteList (4)**: אינטגרציית SIP חיצונית — לא רלוונטי.
- **WABPhoneNumbers (4)**: מספרי WhatsApp Business קשורים ל-app+rule עם `voice_password` — מעניין (voice ל-WhatsApp בצד Voximplant) אך KALFA עובדת מול Meta ישירות.

---

## שגיאות ומגבלות רוחביות (gotchas)

- **Rate limiting**: 340 RATE_LIMIT_EXCEED (ה-Management API מוגבל קצב), **515 SAME_OPERATION_LIMIT** (אותה פעולה מהר מדי), 512 מגבלת שינויי פרמטרים. חובה backoff.
- **JWT**: 447 / 454 (TTL מעל המקסימום) / 455 / 456 (פג) — לטפל ב-456 עם re-mint אוטומטי.
- כלליות: 100 AUTHORIZATION_FAILED, 101 INVALID_ARGUMENTS, 103 UNKNOWN_COMMAND, 104 FORBIDDEN_COMMAND (role חסר).
- מגבלות משאבים: 108 אפליקציות, 109 users, 314 concurrent resources, 418/419 מספר scenarios, 411 contacts, 323 IPs, 373 PSTN blacklist, 437/438 מפתחות/subusers.
- **StartScenarios: 200 concurrent → 429**; **CreateCallList: יתרה ≥ $1**; `num_attempts` ≤ 5; CancelCallListTask ≤ 1000; GetCallHistory: IDs ≤ 1000, count ≤ 1000, offset ≤ 10000.
- `log_file_url` של session נשמר **חודש בלבד**; דוחות async פגים (`store_until`) ומגיעים gzip (`curl --compressed`).
- רשימות פרמטרים מופרדות `;`; הרבה methods מקבלים 'all'.
- כל תוכן ארוך — POST body בלבד (x-www-form-urlencoded UTF-8), לא URL.
- **המגבלה של ~200 bytes ל-`script_custom_data` אינה מתועדת בשום מקום** — ממצא אמפירי של KALFA בלבד; גם ל-custom_data של call-list rows אין מגבלת גודל מתועדת.
- מגבלות גודל של KeyValueStorage לא מתועדות בצד HTTP API (לבדוק בתיעוד VoxEngine ApplicationStorage).

## פערים ידועים במחקר

- שתי קבוצות המחקר רצו ב-plan mode — ה-notes נכתבו לקובצי plan במקום ל-`vox-research/`; אין raw-page cache לקבוצת platform.
- הנרטיב הרשמי של auth/request-format יושב במדריך getting-started/managementapi (מחוץ להיקף) — פרטי ה-auth הוסקו מדוגמאות ומקודי שגיאה.
- 194 מתוך 199 עמודי Structure לא נשלפו (הוקלטו במלאי); dump מלא של 458 השגיאות נשמר ב-`/var/www/vhosts/kalfa.me/.claude/projects/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/tool-results/be6tugb9p.txt`.
- אימות CallerID (Add/Verify/Activate) לא נמצא בתיעוד ה-HTTP API — כנראה Control-Panel בלבד; לא ניתן לאשש מההיקף הזה.

---

## רלוונטיות ל-KALFA (מאוחד ומנוקה מכפילויות)

### ארכיטקטורת auth ו-client
1. **`src/lib/voximplant/client.ts` צריך מפתח service-account ייעודי מ-CreateKey עם roles בהרשאות מינימום** (Developer + Call list manager; CallsSMS רק אם יידרש), במקום credentials של החשבון הראשי. לטפל ב-456 TOKEN_EXPIRED עם re-mint, לכבד את מגבלת ה-TTL (454), ו-backoff על 340/515 — רלוונטי גם ל-stuck-call reconciler.
2. **`bind_key_id` על ה-rule** מאפשר לצמצם את המפתח לרול ה-outbound היחיד של KALFA (pattern `.*`).
3. **AuthorizedIPs** — לנעוץ את גישת ה-API ל-IP של שרת IONOS: hardening זול.

### עקיפת מגבלת 200-byte של script_custom_data
4. **KeyValueStorage הוא הפתרון הפלטפורמי**: כתיבת context מלא של השיחה תחת key קצר ב-SetKeyValueItem (עם TTL לניקוי אוטומטי) לפני StartScenarios; מעבירים רק את ה-key; התרחיש קורא דרך ApplicationStorage — חלופה מלאה או משלימה ל-ctx HTTP callback.
5. לחלופין/במקביל: ההמלצה הרשמית היא POST עם `custom_data` ב-body — שווה לאמת מחדש את תקרת ה-200-byte בערוץ הזה, כי היא לא מתועדת.

### ניהול מפתחות LLM/TTS
6. **Secrets API הוא הבית הנכון למפתח Groq (ובעתיד ElevenLabs)** — מוציא אותו מהגשה דרך ctx endpoint, נותן נתיב רוטציה נקי לרמדיאציית המפתח שדלף, ושומר אותו מחוץ ל-call history.

### CallLists כתחליף ל-pacing העצמי
7. **CallLists יכול להחליף את מנגנון הקצב מבוסס pg-boss**: שורת CSV פר-אורח עם custom_data (ללא תקרת גודל מתועדת), `num_attempts` ≤ 5, `interval_seconds`, `max_simultaneous`, עדיפויות, **חלונות קריאה יומיים (`__start/__end_execution_time`) שממופים לשעות החוקיות בישראל** (זהירות: UTC+0), pause/resume פר-קמפיין (Stop/Recover), ו-AppendToCallList לאורחים שנוספו מאוחר (פותר את בעיית ה-late-added guests ברמת החיוג).
8. **GetCallListDetails(output=json)** נותן סטטוס פר-אורח לדשבורד הבעלים בלי state צד-KALFA לכל ניסיון; אבל מיפוי Processed/Error ל"הושג/לא הושג" אמין רק אם התרחיש כותב `result_data` בכוונה.
9. **שער היתרה: ≥ $1 או שהקמפיין נעצר** — עם $2.88 הנוכחיים זה גבול מסוכן; חייב ניטור.

### רקונסיליאציה לחיוב פר-הושג
10. מתכון מאושש: לשמור את `call_session_history_id` שמוחזר מ-StartScenarios (או result_data של call list) → batch **GetCallHistory** לפי רשימת IDs (≤1000 לבקשה) או לפי `call_session_history_custom_data` → **`CallInfoType.successful` + duration + cost + end_reason הם אמת החיוב**; `finish_reason='Insufficient funds'` תופס כשל פלטפורמה. ל-bulk לילי: Async + GetHistoryReports + DownloadHistoryReport (--compressed).
11. **`log_file_url` נשמר חודש בלבד** — למשוך לוגים מיד למקרי מחלוקת חיוב.
12. **DeleteRecord** תומך במחיקת פרטיות של הקלטות/תמלולים פר-אורח; **GetAuditLog** (Owner) מכסה את דרישת ה-auditability של פעולות אדמין.

### ניטור תפעולי (Slack ops)
13. **GetAccountInfo(return_live_balance) + SetAccountInfo(callback_url) + MinBalanceCallback** = ניטור אוטומטי של שער היתרה, מתחבר ישירות לצינור התראות ה-Slack הקיים.
14. **שליטה mid-call**: `media_session_access_secure_url` המוחזר מ-StartScenarios הוא ערוץ לא מנוצל — ה-backend יכול לדחוף אירועים לשיחה חיה (ביטול/עדכון) במקום polling של ctx בלבד.
15. **throttle ל-StartScenarios**: התור של KALFA חייב להישאר מתחת ל-200 concurrent ולטפל ב-429 עם retry.

### מספרים ו-CLI
16. **CallerID מאומת פג תוקף (`verified_until`)** — אם KALFA מציגה מספר +972 משלה, להוסיף ניטור תפוגה להתראות; האימות עצמו כנראה דרך Control Panel (לא ב-API הזה).
17. חלופה: רכישת מספר IL דרך PhoneNumbers — כנראה דורש regulation_address, שומר מראש דמי חודש הבא, וחובה BindPhoneNumberToApplication.
18. **OutboundTestNumbers מתאים בדיוק ל-sandbox הנוכחי**: אימות מובייל +972 של המפתח לבדיקות outbound בחינם (5 ניסיונות אימות/יום).

### גבולות אחריות
19. **PSTN blacklist הוא inbound-only — חובת ה-DNC החוקית לשיחות AI יוצאות חייבת להישאר בשכבת האפליקציה של KALFA (mark_dnc)**, לא בפלטפורמה.
20. SMS של Voximplant לישראל דורש מספר רכוש/SenderID דרך support — **ExtrA נשארת ערוץ ה-SMS העדיף**; SmartQueue רלוונטי רק אם תתווסף העברה לנציג אנושי (ואז ACDv2, לא ה-Queues הישן); Dialogflow/SIP/Push — לא רלוונטיים.
