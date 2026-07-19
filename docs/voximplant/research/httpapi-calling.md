# Voximplant Management API — httpapi-calling research notes

Group: httpapi-calling · Depth: DEEP (every in-scope page fetched via getDoc API)
Scope: references.httpapi.{calllists, scenarios, rules, history, phonenumbers, queues, callerids, outboundtestnumbers}
Base URL pattern for all methods: `https://api.voximplant.com/platform_api/<MethodName>/` (GET or POST; auth = account_id + api_key, or service-account JWT bearer header as in the docs' `token.sh` examples). All timestamps UTC unless a `timezone` param is given, format `YYYY-MM-DD HH:mm:ss`.

NOTE: this file was written to the plan-file path because plan mode was active during this session and forbade creating `vox-research/httpapi-calling.md`. Content is the complete intended deliverable.

---

## 1. CallLists (12 methods) — FOCUS AREA, full coverage

What it covers: server-side outbound dialing campaigns driven by CSV files. Each CSV row = a "task" (one callee). The platform runs the routing rule's scenario per task, handles attempts/retries/pacing; the scenario reports the outcome back (result_data). Complements StartScenarios for bulk campaigns.

### CreateCallList — the campaign starter
- Required: `rule_id`, `name` (≤255 chars, no `/` `\`), `priority` (0…2^31, 0 = highest), `max_simultaneous`, `num_attempts` (min 1, **max 5**), `file_content` (send CSV as request body or multipart — NOT via URL: "network devices tend to drop HTTP requests with large headers").
- Optional: `delimiter` (default `;`), `encoding` (default UTF-8), `escape`, `interval_seconds` (seconds between attempts, default 0), `list_custom_data`, `reference_ip` (geo-pick server), `server_location` (higher priority than reference_ip; values from getServerLocations), `task_priority_strategy` = `first_attempts` (default) | `repeated_attempts`.
- Magic CSV columns (per-row scheduling controls):
  - `__start_execution_time` — daily window start, UTC+0 `HH:mm:ss`
  - `__end_execution_time` — daily window stop, UTC+0 `HH:mm:ss`
  - `__start_at` — UNIX timestamp; if absent processing starts immediately
  - `__task_uuid` — caller-supplied task UUID, ≤40 chars, latin/digits/hyphen/colon, unique within list
  - Per-record custom call schedule also supported (`call_schedule` JSON — see Call lists guide).
- IMPORTANT limit: account balance must be ≥ 1 USD or processing does not start / stops immediately.
- Returns: `{result, list_id, batch_id (UUID), count}`.
- Example essence: `curl --data-binary '@callList.csv' -H 'Content-type: text/csv' '…/CreateCallList/?account_id=…&rule_id=1&priority=1&max_simultaneous=2&num_attempts=2&name=callList'`

### AppendToCallList
- Adds tasks to an existing list: `list_id` (or list_name), `file_content` (body/multipart), `delimiter`/`encoding`/`escape`. Returns new `batch_id` + `count`. Each append = its own batch UUID (useful for late-added guests).

### GetCallLists
- Filters: `list_id` (intlist or 'all'), `name`, `is_active`, `from_date`/`to_date` (UTC), `application_id`, `type_list` (AUTOMATIC | MANUAL), paging `count`/`offset`. Returns CallListType[] + count + total_count.
- CallListType: list_id, list_name, rule_id, priority, max_simultaneous, num_attempts, interval_seconds, dt_submit, dt_complete, task_priority_strategy, `status` ∈ {In progress, Completed, Canceled}.

### GetCallListDetails — per-task status export
- Params: `list_id` (REQ), `batch_id` filter, `count`/`offset`, `output` = **csv (default) | json | xls**, `delimiter`, `encoding`.
- Returns CallListDetailType[]: task_id, task_uuid, list_id, status/status_id, attempts_left, custom_data, result_data (scenario-reported result or runtime error), last_attempt, start/finish_execution_time, call_schedule.
- **Task status enum**: 0=New, 1=In progress, 2=Processed, 3=Error, 4=Canceled.

### Task/lifecycle control
- **EditCallList**: change list_id's priority, name (≤255), num_attempts (≥1), max_simultaneous (≥1), interval_seconds (≥0), start_at (`yyyy-MM-dd HH:mm:ss`), server_location (bad value → error 496), ip_address, list_custom_data, task_priority_strategy. Nonexistent list → error 251.
- **EditCallListTask**: per-task edit by task_id or task_uuid: attempts_left, start_at (next attempt time), custom_data, call_schedule (JSON), min/max_execution_time (daily window HH:mm:ss, must specify both).
- **EditCallListTasksPriority**: `tasks` = JSON array of {task_id|task_uuid, task_priority}; per-task results array.
- **CancelCallListTask**: cancel up to **1000** tasks by `tasks_ids` or `tasks_uuids` (semicolon-separated); per-task result incl. error_msg.
- **CancelCallListBatch**: cancel all tasks with given `batch_ids` (semicolon-separated UUIDs).
- **StopCallListProcessing** / **RecoverCallList**: pause / resume a whole list (recover returns count_recovery of restored tasks).
- **DeleteCallList**: delete list by ID.
- Roles allowed: Owner/Admin/Developer/"Call list manager" (a dedicated role exists for campaign ops).

KALFA relevance: CallLists IS the managed campaign dialer KALFA is evaluating — replaces self-built pg-boss pacing: per-guest CSV rows with custom_data (guest token / RSVP ctx), attempt caps (≤5), daily calling windows (__start/__end_execution_time — align to Israeli legal calling hours), priorities, pause/resume, and GetCallListDetails(output=json) for per-guest reconciliation feeding per-reached-contact billing. Caveats: custom_data per row rides in CSV (no 200-byte cap documented here, unlike script_custom_data), balance ≥ $1 gate, statuses Processed vs Error map cleanly to "reached"/"not reached" only if the scenario writes result_data deliberately.

---

## 2. Scenarios (8 methods) — incl. StartScenarios FOCUS

What it covers: CRUD for VoxEngine JS scenarios + starting sessions via API.

- **AddScenario**: `scenario_name` (REQ, <30 chars), `scenario_script` (**<128 KB**, POST, x-www-form-urlencoded UTF-8), optional bind to application/rule (`rewrite` to overwrite). Unbound scenarios cannot be executed. Omitting application → goes to Shared folder (available to all apps).
- **SetScenarioInfo**: edit name/body by scenario_id or required_scenario_name (same 30-char / 128 KB limits, POST).
- **DelScenario**: by id list or name list; 'all' deletes everything.
- **GetScenarios**: filter by app, scenario_id/name (name filter is substring + case-insensitive); `with_script=true` requires scenario_id. Returns ScenarioInfoType {scenario_id, scenario_name, scenario_script, modified, parent}.
- **BindScenario**: bind/unbind scenario list ↔ rule (`bind` bool). Scenario and rule must be in the same application.
- **ReorderScenarios**: order of scenarios attached to one rule (execution order).
- **StartScenarios** (roles incl. CallsSMS):
  - Params: `rule_id` (REQ — rule must have the scenario attached), `application_id`/`application_name`, `user_id`/`user_name` (run as user), `script_custom_data`, `reference_ip`, `server_location` (higher priority than reference_ip; values via getServerLocations).
  - `script_custom_data`: string, accessible in scenario via `VoxEngine.customData()`; "Use the application/x-www-form-urlencoded content type with UTF-8 encoding". Doc explicitly recommends **POST with data in the `custom_data` field of the request body** for custom data (avoids URL-length issues). NOTE: the ~200-byte practical cap KALFA measured is NOT stated on this page — the page's only stated limits are below.
  - **Limit: max 200 concurrent HTTP requests to StartScenarios → HTTP 429 Too Many Requests** until active requests drain.
  - Returns: `result`, `call_session_history_id` (paste into GetCallHistory `call_session_history_id` to fetch the session result), `media_session_access_url` + `media_session_access_secure_url` (fire HTTP(S) at it → `AppEvents.HttpRequest` inside the running scenario — mid-call control channel: stop scenario, push data).
- **StartConference**: same shape + `conference_name` (<50 chars) for video conference sessions; audio conferences should use StartScenarios.

KALFA relevance: StartScenarios is KALFA's current trigger (voximplant-bridge). Confirmed hooks: POST-body custom_data recommendation, 429 back-pressure at 200 concurrent starts (KALFA's queue should throttle + retry-on-429), call_session_history_id as the reconciliation join key, and media_session_access_secure_url as an alternative in-call push channel (could replace part of the ctx polling — e.g., push "owner says cancel" into a live call). AddScenario/SetScenarioInfo = deploy path used by voxengine-ci (128 KB script cap).

---

## 3. Rules (5 methods)

What it covers: routing rules that map an inbound/started call to scenarios via regex pattern over the dialed identity.

- **AddRule**: `rule_name` (REQ, <100), `rule_pattern` (REQ, regex, <64 KB), `rule_pattern_exclude` (opt), app id/name, scenario list, `video_conference` flag, `bind_key_id` (bind a service account to the rule — management-api guide).
- **SetRuleInfo**: edit same fields by rule_id.
- **GetRules**: filter by app, rule_id/name, `template` (test which rule matches a number, e.g. template=74951234567), `with_scenarios`, `attached_key_id`; returns RuleInfoType {rule_id, rule_name, rule_pattern(+exclude), scenarios[], modified, video_conference}.
- **DelRule**, **ReorderRules** (order matters — first matching rule wins; rules must be in one application).
- RuleInfoType includes bound ScenarioInfoType list.

KALFA relevance: KALFA only needs one outbound rule (pattern `.*`) whose rule_id feeds StartScenarios/CreateCallList; GetRules `template=<+972…>` is a handy sanity check that a number routes to the intended scenario; `bind_key_id` lets KALFA scope its service account key to just that rule (least privilege).

---

## 4. History (11 methods) — reconciliation FOCUS

What it covers: post-hoc querying of call sessions, money movements, and account audit; sync (paged JSON) + async (CSV report) variants.

- **GetCallHistory** (sync): REQ `from_date`,`to_date`; filters: `call_session_history_id` (intlist, **≤1000 IDs**), `call_session_history_custom_data` (filter by custom_data!), `application_id`/name, `rule_name` (needs app), `local_number`/`remote_number`/`remote_number_list`, `user_id`, `child_account_id`; flags `with_calls`, `with_records`, `with_other_resources`, `with_total_count` (omit to speed up), `desc_order`, `timezone` ('auto' = account tz). Paging: `count` ≤1000, `offset` ≤10000 (deep pagination is capped — use async for big pulls).
  - Returns CallSessionInfoType[]: call_session_history_id, custom_data, duration, start_date, finish_reason ∈ {Normal termination, Insufficient funds, Internal error (billing timeout), Terminated administratively, JS session error, Timeout}, log_file_url (**log retention 1 month**), records[], calls[] (CallInfoType: call_id, remote_number, incoming, `successful` bool, duration, cost, start_time, record_url, end_reason, transaction_id, custom_data).
- **GetBriefCallHistory** (async-only, CSV): lighter columns, same filters, REQ `output=csv`.
- **GetCallHistoryAsync**: same filters as sync, no count/offset; returns `history_report_id`.
- **GetHistoryReports**: list report jobs + status; `history_type` ∈ {calls, calls_brief, transactions, audit, call_list, transactions_on_hold} (note: `call_list` reports exist), `is_completed` filter. Returns HistoryReportType {history_report_id, created/completed, file_name/file_size, download_size (gzipped), format=csv, store_until (expiry date), filters (saved query), calculated_data}.
- **DownloadHistoryReport**: `history_report_id` → raw file; may come **gzipped — use curl --compressed**.
- **GetTransactionHistory** (+Async): money movements; REQ from/to date; `transaction_type` list (resource_charge, subscription_charge, card_payment, gift_revoke, money_distribution, …), `is_uncommitted` (on-hold), count ≤1000 / offset ≤10000. Returns TransactionInfoType[].
- **GetAuditLog** (+Async, Owner role only): account-change audit; filter by command list (`filtered_cmd=BindSkill;AddSkill…`), IP, admin user, `advanced_filters` (relation id e.g. phone number / application_id).
- **GetACDHistory**: ACD (queue) session history — only relevant if ACD used.
- **DeleteRecord**: remove a call record + transcription files by record_id/record_url (privacy deletions).

KALFA relevance: reconciliation recipe confirmed — store `call_session_history_id` returned by StartScenarios, then batch GetCallHistory with `call_session_history_id=<ids;…>` (≤1000/req) or filter by `call_session_history_custom_data`; per-call `successful`, duration, cost, end_reason drive per-reached-contact billing truth; finish_reason catches platform-side failures (Insufficient funds!). Async CSV + GetHistoryReports/DownloadHistoryReport (--compressed) for nightly bulk jobs; log_file_url only lives 1 month — pull logs promptly for disputes; DeleteRecord supports GDPR/privacy-style guest deletion of recordings.

---

## 5. PhoneNumbers (15 methods)

What it covers: buy/manage virtual numbers: browse inventory (country → state → region → category), attach (purchase), bind to app/rule, deactivate, reports.

- Purchase flow: GetPhoneNumberCategories (`country_code`, locale EN/RU, sandbox flag) → GetPhoneNumberRegions / GetPhoneNumberCountryStates / GetActualPhoneNumberRegion → GetNewPhoneNumbers (browse stock, `phone_number_mask`) → **AttachPhoneNumber** (`country_code`, `phone_category_name`, `phone_region_id` REQ; `phone_number` list or `phone_count`; `regulation_address_id` for countries needing verification). Purchasing reserves next month's subscription fee + taxes.
- **BindPhoneNumberToApplication**: phone ↔ application (+optional rule_id), `bind` true/false.
- **GetPhoneNumbers**: rich filters (activation_status ACTIVE/ACTIVATING/DEACTIVATED/PROVISIONING/AWAITING_…, verification_status REQUIRED/IN_PROGRESS/VERIFIED, is_bound_to_application, canceled, deactivated, renewal-date ranges, order_by) → AttachedPhoneInfoType[].
- **DeactivatePhoneNumber** (Owner role): stop renewal.
- **SetPhoneNumberInfo**: per-number `incoming_sms_callback_url`.
- **IsAccountPhoneNumber**: check `phone_number` (E.164 **without +**) belongs to account.
- Async report trio: GetPhoneNumbersAsync → GetPhoneNumberReports (report_type phone_numbers | phone_numbers_awaiting_configuration) → DownloadPhoneNumberReport (gzip, --compressed).

KALFA relevance: needed only when KALFA buys an Israeli (+972) caller number instead of verified CallerID; note IL numbers may require regulation_address verification and monthly-fee reservation; after purchase must BindPhoneNumberToApplication to the calling app. IsAccountPhoneNumber is a cheap guard in config validation.

---

## 6. Queues (9 methods) — legacy ACD

What it covers: classic ACD operator queues (predecessor of SmartQueue): AddQueue / SetQueueInfo (max_queue_size, max_waiting_time (minutes), acd_queue_priority 0=highest, service_probability 0.5–1.0, average_service_time, auto_binding by skills), DelQueue, GetQueues (with_skills, with_operatorcount), BindUserToQueue (users/queues must share the application), GetACDState (live queue state), and statistics: GetACDOperatorStatistics / GetACDOperatorStatusStatistics (statuses OFFLINE/ONLINE/READY/BANNED/IN_SERVICE/AFTER_SERVICE…) / GetACDQueueStatistics — all with day/hour aggregation, grouping by user, abbreviated-key JSON option.

KALFA relevance: not needed for outbound AI RSVP calls (no human operators); only relevant if KALFA ever adds "transfer to human/owner" escalation — and then SmartQueue (separate section) is the modern choice, not this legacy ACD.

---

## 7. CallerIDs (2 methods in scope)

What it covers: management of verified caller IDs (using your own existing number as outbound CLI).
- **GetCallerIDs**: filters callerid_id/number/active, order_by caller_number|verified_until → CallerIDInfoType {callerid_id, callerid_number, active, verified_until (date — verification EXPIRES), code_entering_attempts_left, verification_call_attempts_left}.
- **DelCallerID**: by id or number; "you cannot delete a CID permanently (the antispam defence)".
- NOTE: the folder exposes only Get/Del here; Add/Activate/Verify callerID methods are not in this folder's children (verification counters surface via the info type). Adding/verifying is done via Control Panel or other sections.
- Roles: Owner, Admin only.

KALFA relevance: cheapest route to calling from KALFA's real Israeli number without renting a DID — but `verified_until` means re-verification is periodic; monitor it (alerting) or calls will lose the CLI.

---

## 8. OutboundTestNumbers (5 methods)

What it covers: free-tier testing — one personal phone number allowed for outbound test calls.
- **AddOutboundTestPhoneNumber** (`phone_number` E.164; only ONE allowed — delete first to replace) → **VerifyOutboundTestPhoneNumber** (platform calls you and *pronounces a code*; **5 attempts/day, 100 total, ≥1 min between attempts**; returns daily_attempts_left) → **ActivateOutboundTestPhoneNumber** (`verification_code`) → **GetOutboundTestPhoneNumbers** (is_verified, country_code) / **DelOutboundTestPhoneNumber**.

KALFA relevance: dev/QA convenience for the low-balance sandbox account: verify the developer's own +972 mobile and test scenarios without buying a number or upgrading; mind the 5/day verification budget.

---

## Supporting structures fetched (out-of-scope prefix, pulled for completeness)
- CallListType, CallListDetailType (status enums above), HistoryReportType, RuleInfoType, ScenarioInfoType, CallerIDInfoType, OutboundTestPhonenumberInfoType, CallSessionInfoType, CallInfoType.

## Cross-cutting gotchas
- List params are semicolon-separated; many accept literal 'all'.
- POST + x-www-form-urlencoded UTF-8 for anything long (scripts, custom data); never put file_content/scripts in the URL.
- Sync history paging caps: count ≤1000, offset ≤10000 → use *Async + report download for exports; reports gzip (curl --compressed) and expire (store_until).
- StartScenarios concurrency 200 → 429; CreateCallList requires balance ≥ $1; num_attempts ≤5; CancelCallListTask ≤1000 tasks/call.
- session log URL retention: 1 month.
- Roles matter: a scoped service account for KALFA should carry Developer + Call list manager + CallsSMS-adjacent roles; Audit log is Owner-only; CallerID mgmt is Owner/Admin.

---

## INVENTORY (every page in scope; title — public URL path under https://voximplant.com/docs/)

Folders (8):
1. CallLists — references/httpapi/calllists
2. Scenarios — references/httpapi/scenarios
3. Rules — references/httpapi/rules
4. History — references/httpapi/history
5. PhoneNumbers — references/httpapi/phonenumbers
6. Queues — references/httpapi/queues
7. CallerIDs — references/httpapi/callerids
8. OutboundTestNumbers — references/httpapi/outboundtestnumbers

CallLists methods (12): AppendToCallList · CancelCallListBatch · CancelCallListTask · CreateCallList · DeleteCallList · EditCallList · EditCallListTask · EditCallListTasksPriority · GetCallListDetails · GetCallLists · RecoverCallList · StopCallListProcessing

Scenarios methods (8): AddScenario · BindScenario · DelScenario · GetScenarios · ReorderScenarios · SetScenarioInfo · StartConference · StartScenarios

Rules methods (5): AddRule · DelRule · GetRules · ReorderRules · SetRuleInfo

History methods (11): DeleteRecord · DownloadHistoryReport · GetACDHistory · GetAuditLog · GetAuditLogAsync · GetBriefCallHistory · GetCallHistory · GetCallHistoryAsync · GetHistoryReports · GetTransactionHistory · GetTransactionHistoryAsync

PhoneNumbers methods (15): AttachPhoneNumber · BindPhoneNumberToApplication · DeactivatePhoneNumber · DownloadPhoneNumberReport · GetAccountPhoneNumberCountries · GetActualPhoneNumberRegion · GetNewPhoneNumbers · GetPhoneNumberCategories · GetPhoneNumberCountryStates · GetPhoneNumberRegions · GetPhoneNumberReports · GetPhoneNumbers · GetPhoneNumbersAsync · IsAccountPhoneNumber · SetPhoneNumberInfo

Queues methods (9): AddQueue · BindUserToQueue · DelQueue · GetACDOperatorStatistics · GetACDOperatorStatusStatistics · GetACDQueueStatistics · GetACDState · GetQueues · SetQueueInfo

CallerIDs methods (2): DelCallerID · GetCallerIDs

OutboundTestNumbers methods (5): ActivateOutboundTestPhoneNumber · AddOutboundTestPhoneNumber · DelOutboundTestPhoneNumber · GetOutboundTestPhoneNumbers · VerifyOutboundTestPhoneNumber

Total: 75 pages (8 folders + 67 methods). All 75 fetched and read. Bonus: 9 structure pages (references/httpapi/structure/*) fetched for response-type detail.
