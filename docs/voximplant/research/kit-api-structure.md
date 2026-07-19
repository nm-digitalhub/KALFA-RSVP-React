# Voximplant Kit API — Postman Collection Research Notes (group: kit-api-structure)

Source: local file `kit-collection.json` (Postman collection v2.0, "Voximplant Kit API documentation", the collection behind https://kit-apidoc.voximplant.com/). 149 requests across 33 top-level folders.

NOTE: This is Voximplant **Kit** (the no-code contact-center product), a SEPARATE product from the Voximplant Platform (Management API + VoxEngine) KALFA currently uses. Different hosts, different tokens, different billing.

---

## 1. Platform-wide conventions

- **Format**: every method is `POST` (a couple of `GET` helpers), body `application/x-www-form-urlencoded` (file uploads: `multipart/form-data`). Responses are JSON `{ "success": true, "result": ... }`; lists add `"_meta": {totalCount, pageCount, currentPage, perPage}`.
- **Auth**: static **API token** generated in Kit UI (Administration > Security > API tokens), passed as `access_token` param (body or query) on every call + `domain` query param = account name. No JWT/OAuth.
- **Hosts** (3 distinct):
  - `{{host}}` = account API host, e.g. `kitapi-eu.voximplant.com` — main REST API (`/api/v2|v3|v4/...`).
  - `{{messaging-host}}` — bot-service messaging API.
  - `{{cti_host}}` = `kit-cti-<region>.voximplant.com` (regions: us, br, eu, kz, ru, ru2) — CTI server (makeCall/transferCall).
- **API versions coexist per-method**: v2 (callerid, outbound legacy, sip whitelist, some phone/scenario), v3 (most), v4 (history/searchCalls cursor search, messaging).
- **Completion codes** (field `completion_code` in callbacks/reports; only `Call_Answered` counts as Successful): `Call_Answered` (yes), and failures: `Other_Error`, `Temporary_Unavailable` (SIP 480), `Request_Terminated` (487), `AMD` (answering machine detected), `Invalid_Number` (404), `Call_Busy` (486), `No_Answer` (408/timeout), `Insufficient_Funds` (402), `Call_Was_Rejected` (603), `Restricted_By_DNC`, `Abandoned` (no agent after answer), `Lost_By_Agent`, `Missed_By_Scenario`, `No_Agents`, `System_Error`, `Call_Prohibited` (403).
- **Error convention**: HTTP 402 insufficient balance, 403 role/permission or feature disabled ("Contact center not enabled"), 404 entity not found, 422 validation / illegal status transition.

---

## 2. Full endpoint catalog (33 folders, 149 requests)

All URLs relative to `https://{{host}}` unless noted; every request also carries `?domain={{domain}}` and `access_token`.

### account (1)
- POST `/api/v3/account/getAccountInfo` — account name, currency, etc.

### agentCampaigns (12) — PDS campaigns (deep dive in §3)
createCampaign, deleteCampaign, searchCampaigns, updateCampaign, setCampaignStatus, setListStatus, searchContacts, appendContacts, searchCampaignLists, cancelContacts, addAttempts, getStat.

### agentStatus (4)
- POST `/api/v3/agentStatuses/searchStatuses|createStatus|updateStatus|deleteStatus` — CRUD for agent presence statuses (system + custom).

### bot-service (2) — deep dive in §8 (messaging-host)
sendTemplateMessage (WhatsApp HSM), sendMessage (bot message into chat).

### callback (4 requests + 16 documented event types) — deep dive in §5
create, update, search, delete + `Callbacks/` folder documenting the 16 event payloads.

### callerid (2)
- POST `/api/v2/callerid/searchCallerIDs` — list verified own Caller IDs.
- POST `/api/v2/callerid/deleteCallerID` — delete one.

### calls (2) — deep dive in §7
bindTags, bindTopics.

### campaigns - dialer 2.0 (9 + 5 status methods) — deep dive in §4
create, delete, search, update, pause, searchLists, searchContacts, appendContacts, createAgent, updateAgent, cancelContact, cancelLists, editCallListTasksPriority + subfolder "Methods to update campaign status": schedule, start, resume, stop, draft.

### cc (5) — contact-center admin
- POST `/api/v3/cc/agentStatHistory` (sortable, paged) — agent report.
- POST `/api/v3/cc/queueStatHistory` — queue report.
- POST `/api/v3/cc/updateSettings` — general CC settings.
- POST `/api/v3/cc/notify` — send notification to CC users.
- POST `/api/v3/cc/updateDialingSettings` — CC dialing settings.

### cti (2) — deep dive in §6 (cti_host)
makeCall, makeTransfer.

### dnc (4) — Do-Not-Call
- POST `/api/v3/dnc/addDncContacts` — add contact to a DNC list.
- POST `/api/v3/dnc/searchDncContacts` — list DNC contacts.
- POST `/api/v3/dnc/deleteDncContact` — remove.
- POST `/api/v3/dnc/searchDncList` — list DNC lists.

### helper (2)
- GET `/api/v2/helper/getListTimezones` — timezone list.
- GET `/api/v2/helper/getTimezonesByNumber` — timezones inferred from a phone number.

### history (4)
- POST `/api/v4/history/searchCalls` — cursor-based call search.
- POST `/api/v3/history/exportCallsHistoryReport` — async report → report ID.
- POST `/api/v3/history/searchStatuses` — user status transitions.
- POST `/api/v3/history/exportStatusHistoryReport` — async report → report ID.

### ip (1)
- POST `/api/v3/ip/searchWhitelist` — account API IP whitelist.

### media (3)
- POST `/api/v3/media/searchMedia | uploadMedia | deleteMedia` — media files (used for waiting music / record-notification audio).

### messaging (2)
- POST `/api/v4/messaging/getConversationHistory` — full chat history by session ID.
- POST `/api/v4/messaging/getListIncomingRequests` — list chat session IDs.

### outbound (7) — LEGACY dialer 1.0 (superseded by "campaigns - dialer 2.0")
- POST `/api/v3/outbound/appendToCampaign`, `/api/v3/outbound/initCampaign` (create), `/api/v3/outbound/pauseCampaign`; POST `/api/v2/outbound/deleteCampaign | resumeCampaign | stopCampaign | searchCampaigns`.

### phone (3)
- POST `/api/v3/phone/updateNumber | searchNumbers` (paged); POST `/api/v2/phone/removePhoneNumber`.

### queues (4)
- POST `/api/v3/queues/addQueue | searchQueues | deleteQueue | updateQueue`.

### realtime-metriсs (3) (note: folder name contains Cyrillic "с")
- POST `/api/v3/realtimeMetrics/getAgentsMetricsCalls | getAgentsGroupsMetricsCalls | getQueuesMetricsCalls` — live stats.

### report (9) — async report engine (export → getReportStatus → downloadReport)
- POST `/api/v3/report/exportAgentHistoryReport | downloadReport | getReportStatus | exportQueueHistoryReport | exportTagsReport | exportCampaignReport (automated campaigns) | exportDncList | exportAgentCampaignReport (PDS) | exportAgentCampaignAttemptsReport (per-attempt PDS)`.

### scenario (4)
- POST `/api/v3/scenario/runScenario` — run a Kit scenario (Kit's analog of StartScenarios).
- POST `/api/v3/scenario/searchScenarios` — list scenarios.
- POST `/api/v3/scenario/getScenarioVariables` — scenario variables.
- POST `/api/v2/scenario/getSipUri` — scenario SIP URI.

### sipNumber (4)
- POST `/api/v3/sipNumber/createSipNumber | updateSipNumber | deleteSipNumber | searchSipNumber` — external numbers bound to SIP trunks.

### sipTrunk (5)
- POST `/api/v3/sipTrunk/searchSipTrunk | createSipTrunk | updateSipTrunk | deleteSipTrunk | searchRemoteExtension`.

### sipWhitelist (4)
- POST `/api/v2/sip/createSipWhitelist | updateSipWhitelist | deleteSipWhitelist | searchSipWhitelist`.

### skills (4)
- POST `/api/v3/skills/addSkill | updateSkill | searchSkills | deleteSkill`.

### tags (4)
- POST `/api/v3/tags/addTag | searchTags | updateTag | deleteTag`.

### topics (4) / topicSets (4)
- POST `/api/v3/topics/createTopic | searchTopics | updateTopic | deleteTopic`; `/api/v3/topicSets/createTopicSet | searchTopicSets | updateTopicSet | deleteTopicSet` (topics nest up to 5 levels).

### user (1)
- POST `/api/v3/user/searchUsers` — list account users (agents).

### usergroup (4)
- POST `/api/v3/usergroup/addGroup | searchGroups | updateGroup | deleteGroup`.

### whatsappHsmTemplates (1)
- POST `/api/v3/whatsappHsmTemplates/search` — list approved WhatsApp HSM templates.

### wrapUpCodes (4)
- POST `/api/v3/wrapup/createWrapUpCodesSet | updateWrapUpCodesSet | searchWrapUpCodesSets | deleteWrapUpCodesSet`.

### bulkMessaging (12) — WhatsApp bulk campaigns (same lifecycle model as dialer 2.0)
- POST `/api/v3/bulkMessagingContacts/appendContacts`; `/api/v3/bulkMessaging/create | update | delete | search | schedule | start | pause | resume | complete | cancelLists | deleteLists`.

---

## 3. DEEP DIVE — agentCampaigns (PDS = Predictive Dialing System, agent-based)

Folder purpose: dialing campaigns that connect answered calls to human **agents**; dials ahead of agent availability. All POST `https://{{host}}/api/v3/agentCampaigns/<method>`.

### createCampaign
Key params (urlencoded): `access_token`*, `title`* (≤255), `folder_id`, one of `phone_number_id` | `caller_id` | `sip_number_id` | `phone_numbers` (JSON `{"phone_number_ids":[..],"caller_id_ids":[..]}`, rotated randomly, max 100), `date_start`/`date_end` (`YYYY-MM-DD HH:mm:ss`), `max_attempts` (1–5, default 1), `interval` (min, default 60), `working_time` (["12:00:00","16:00:00"], customer-local time via contact `UTC` field), `user_ids` (agents), `operator_priority_strategy` (MOST_QUALIFIED|LEAST_QUALIFIED|MAX_WAITING_TIME), `request_priority_strategy` (MAX_PRIORITY|MAX_WAITING_TIME), voicemail detection block (`voicemail_detection_enabled`, `voicemail_detection_model` = ru|kz|colombia|br|mx|ph|pe|us|cl|ru_experimental_vm|ru_experimental_human — **no Israel/he model**, `voicemail_detection_timeout_sec` 1–10, `voicemail_detection_timeout_continue_call`), `dial_up_time_sec`, after-service limit, outbound recording block (`can_outbound_record`, `outbound_record_notification_type` none|media|tts, storage `DEFAULT|SIXMONTHS|ONEYEAR|TWOYEARS|THREEYEARS`, tts_language/tts_voice/tts_text or media_id), `client_waiting_media_id`, `call_auto_answer`, `agents_can_decline_calls`, `region_enabled`+`region` (usa|europe|south_america|singapore|russia|kazakhstan), `mode` (predictive|progressive, default predictive), `wrap_up_codes_set_id`, `wrap_up_dnc_list_id`, `dnc_lists` (int array), `task_multiplier` (progressive pace, 1.0–25.0; 100 for >20 agents), `abandonment_rate` (predictive, 1–100, default 3).
Errors: 402 min balance; 403 role / "Contact center not enabled"; 404 folder; 422 validation.
Response 200: full campaign object `{id, title, status:"draft", mode, working_time, max_attempts, interval, phone_number_id, settings{voicemail_detection..., dial_up_time_sec, outbound_call_recording{...}}, queue{id, title, operator_priority_strategy, ...}, create_date, created_by, ...}`.

### updateCampaign — same param surface + `id`*; 403 for Supervisor without queue-editor permission.
### deleteCampaign — `id`*; 422 "Agent campaign is active" (must not be ongoing/paused). → `result: true`.
### searchCampaigns — filters `id, title, status (draft|ongoing|paused|completed|scheduled), folder_id` + include-flags `with_queue, with_campaign_lists, with_users, with_folder_name, with_wrap_up_codes_set, with_dnc_lists, with_supervisors, with_phone_numbers`, `page`; URL supports `sort=-id&per-page=50`. Response includes `timezone`, `dialing_started`, `use_tags/use_topics`, `task_multiplier`, `abandonment_rate`, nested `queue`.
### setCampaignStatus — `id`*, `status`* ∈ ongoing|paused|completed. Campaign statuses overall: draft, scheduled, ongoing, paused, completed. 402 if balance too low to go ongoing/scheduled.
### setListStatus — contact-list `id`*, `status`* ∈ ongoing|paused|canceled (list statuses seen: processing|ongoing|paused|completed).
### searchContacts — filters `id, campaign_id, campaign_list_id, phone, status (ongoing|success|failed|canceled), from, to`. Response contact: `{id, agent_campaign_list_id, agent_campaign_id, phone, timezone, status, max_attempts, current_attempt, custom_data{...}, last_attempt_date, cancel_*, callback_at}` + `_meta` paging.
### appendContacts — `campaign_id`*, `rows`* JSON array (max **5000**/request; each row requires `phone` + `UTC`, all rows must share the same field set; extra fields become `custom_data` available to the agent/scenario). Response: `{list_id, count, success_count, errors_count, fail_list}`. Creates/extends an API contact list (`is_from_api: true`).
### searchCampaignLists — filters `id, status, agent_campaign_id`. Response per list: file_name/file_size (for uploads), `call_item_count, call_ended, call_success, call_failed, cost, success_calls_duration, processing_status{processed, invalid_phone, invalid_timezone}`.
### cancelContacts — `campaign_id`*, `contact_ids`* array, `comment`. → true.
### addAttempts — `campaign_id`*, `contact_ids`*, `interval`*, `max_attempts`* — grant extra dial attempts to specific contacts. → true.
### getStat — no params beyond token. → `{draft, paused, ongoing, scheduled, completed, total}` counts.

---

## 4. DEEP DIVE — campaigns - dialer 2.0 (current-gen outbound campaigns: automated & agent)

Base `https://{{host}}/api/v3/campaigns/<method>`. Two campaign types share list/contact/status methods: **automated** (`create`/`update`; scenario-driven, no agents — the Kit analog of KALFA's AI-call use case) and **operator/agent** (`createAgent`/`updateAgent` — successor to agentCampaigns).

### create (automated campaign) — 16 params
- `access_token`*, `title`* (≤40 chars), `planned_date_start`/`planned_date_end`, `max_lines`* (1–3000, simultaneous lines), `scenario_id`* (Kit scenario = the campaign flow; from `scenario/searchScenarios`), `region`* (usa|europe|south_america|singapore|russia|kazakhstan — **no dedicated Israel/ME region**), `max_attempts`* (≤140, default 10), `dialing_strategy`* JSON array — per phone-type: `{"key":"phone1","name":"Mobile","interval_min":[],"max_attempts":1,"dial_up_time_sec":15}` (ordering of phone1/phone2..., per-number attempts, dial-up time, inter-attempt intervals), `working_time` (["11:35","19:00"], default 24/7), `folder_id`, `supervisors` `[{"supervisor_id":181,"permission":"viewer|editor"}]`, `dnc_list_ids`, `phone_numbers`* `{"phone_number_ids":[..],"caller_id_ids":[..]}` (rotated, max 500; sip numbers cannot mix with the other two), `timezone` (campaign tz), `task_priority_strategy` (first_attempts|repeated_attempts).
- Response: campaign `{id, status:"draft", vox_call_list_id, type:"automated", dialing_strategy[...], phone_numbers{...}, use_tags, use_topics, ..., queue:null}` — note **`vox_call_list_id`**: dialer 2.0 is built on a platform call list underneath, and running campaigns expose `call_list_session_id` (UUID).

### update — same surface, all optional + `id`*.
### createAgent / updateAgent — agent campaign with everything from §3 plus: `priority` (1–10 vs inbound queues), `mode` predictive|progressive, `predictive_mode` = `abandon_rate` | `agent_busy_factor` (+ `abandonment_rate` or `agent_busy_factor` value), `task_multiplier` (progressive), `agents_can_end_calls`, `client_waiting_media_enabled/_id`, `afterservice_time_limit_sec` (1–600), `use_tags/use_topics/topics_set_id`, `use_wrap_up_codes/wrap_up_codes_set_id/wrap_up_dnc_list_id`, `user_ids`, voicemail-detection and recording blocks. Errors add 404 for media/topic set/DNC/wrap-up/phone IDs/routing rule.
### search — filters: `ids`, `statuses` (["resume","draft","ongoing","paused","completed","scheduled"]), `from/to` (launched), `created_from/to`, `completed_from/to`, `folder_id`, `title`, `type` (["automated","operator"], default ["operator"] — **must pass ["automated"] to see automated campaigns**), include-flags `with_phone_numbers, with_dnc_lists, with_supervisors, with_users, with_queue, with_wrap_up_codes_set`. 422 on invalid filters.
### Status lifecycle subfolder ("Methods to update campaign status") — all take just `id` (token in query): 
- `schedule` (draft→scheduled; requires planned_date_start; 402 min balance), `start` (→ongoing, sets date_start + call_list_session_id), `resume` (paused→ongoing), `stop` (→completed, sets date_end), `draft` (revert to draft), plus top-level `pause` (→paused) and `delete`. 422 "Can not update status from {current} to X" for illegal transitions.
### searchLists — `campaign_id`* → lists with `is_from_api`, file info, `status`, `processing_status{processed, invalid_phone, invalid_timezone}`, `properties` (column mapping incl. timezone column), `tz_autodetection_enabled`, `always_autodetect_tz`, `on_autodetect_tz_error` ("exclude"), `default_timezone`, counts `total/completed/success/failed/canceled_contacts_count`.
### searchContacts — `list_id`*, `status` ∈ sent|ongoing|paused|cancelled|success|failed|duplicated (also "error" for invalid rows). Contact: `{id, phones{phone1:...}, variables[], status, attempts_count, max_attempts, task_uuid, task_priority}`.
### appendContacts — `campaign_id`*, `rows`* JSON (max 5000; keys `phone1`(+phone2...), `timezone`, optional `task_priority`; E.164 for PSTN, 8XXXXXXXXXX allowed for SIP). Response `{success_contacts, failed_contacts, total_contacts, invalid_phones, invalid_tz}`.
### cancelContact — `contact_ids`* (max **100**/request) → true. 
### cancelLists — `campaign_id`*, `list_ids`* → true (cancels all contacts in the lists).
### editCallListTasksPriority — `list_id`*, `tasks`* JSON `[{"task_uuid":"...","task_priority":1..250000}]` → `{changed_priority, already_succeed_tasks, already_failed_tasks, invalid_tasks}` — reprioritize queued contacts mid-campaign.

---

## 5. DEEP DIVE — callback (HTTP webhooks from Kit)

CRUD at `https://{{host}}/api/v3/callback/<create|update|search|delete>`.
- **Model**: subscription = `{name, url, salt, callbacks:[...types], is_enabled}`; max **5 endpoints per account**; Kit POSTs JSON `{"callbacks":[{"hash": md5(salt + domainName + callbackName), "type": <name>, <name>: <data>}]}` with `Content-Type: application/json`. Verify sender via the md5 hash. **Retries: up to 3 times at 5-minute intervals** on failure.
- create: `name`*, `url`*, `salt`*, `callbacks`* (JSON array of type names), `is_enabled`* → subscription object with `id`.
- update: `id`* + any fields. search: filters `id/name/url` → array. delete: `id`* → true.

### 16 documented callback event types (payload highlights)
1. `scenario_created` / 2. `scenario_updated` (published/renamed) / 3. `scenario_deleted` — `{callback_id, domain_name, scenario_id}`.
4. `caller_id_changed` — Caller ID activated/deactivated; full `caller_ids[]` incl. `verified_until`.
5. `numbers_changed` — number purchased/frozen/sync-changed/verification events; `phone_numbers[]` with renewal/verification fields.
6. `profile_email_updated` — profile data.
7. `new_calls` — **a call attempt is counted**; per call: `agent_campaign_id`, `agent_campaign_list_item_id`, `attempt_num`, `call_calls` (JSON string array of legs w/ call_id, cost, duration, successful, remote/local numbers), `call_cost`, `call_data` (the contact's custom variables incl. phone/UTC), `call_result_code`, **`completion_code`**, `datetime_start`, `dialing_time`, `duration`, `is_incoming`, `phone_a/phone_b`, `record_url`, `scenario_id`, `session_id`, `tags[]`. → Use `completion_code` to determine how the attempt ended (per-reached billing signal).
8. `call_assigned_to_agent` — agent answers; `{agent{...}, assign_type: queue_call|group_call|user_call|internal_call|transfer, call{IVR_RESULT_1..4, attempt_num, destination, result_code, session_id, ...}, variables{...}}`.
9. `wrap_up_code_set` — wrap-up code assigned; `{call_id, campaign_id, user_id, wrap_up_code{id,title,type,callback_at}}`.
10. `finished_call` — call ended (datetime_end set); full call record + `tags[]`, `topics[]`, `wrap_up_code`.
11. `call_finalized` — post-call activities done (after-service ended); adds `agent_campaign{...}`, `queue{...}`, `scenario{id,title,scenario_type}`, `completion_code` (e.g. "Call_Answered"), `comments[]`, `log_path` (voximplant log URL).
12. `chat_started` / 13. `chat_assigned_to_agent` / 14. `chat_closed` (closed_reason e.g. CLOSED_BY_AGENT) / 15. `chat_unassigned` / 16. `chat_transfer` — messaging-channel lifecycle with `conversation_uuid`, `incoming_request_id`, `channel_type` (e.g. telegram/whatsapp), `conversation_url`.

---

## 6. DEEP DIVE — cti (CTI server, host `kit-cti-<region>.voximplant.com`)

- **makeCall** — POST `https://{{cti_host}}/{{domain}}/makeCall`: `access_token`*, `number`* (destination), `user_id`* (the agent who originates), `callerid` (optional), `variables` (JSON). → `{success:true, result:true}`. Click-to-call on behalf of an agent (not scenario-driven).
- **makeTransfer** — POST `https://{{cti_host}}/transferCall?domain={{domain}}`: `user_id`*, `call_id`*, `transfer_type`* blind|attended, `direction_type`* sip|pstn|extension + one of `extension_transfer_data` `{"extension_number":"123"}` / `pstn_transfer_data` `{"number":"...","caller_id":"..."}` / `sip_transfer_data` `{"to":"sip:...","from":"sip:..."}`. → true.

## 7. DEEP DIVE — calls (post-call classification)

- **bindTags** — POST `/api/v3/calls/bindTags`: `call_id`*, `tags`* (int array of tag IDs) → true.
- **bindTopics** — POST `/api/v3/calls/bindTopics`: `call_id`*, `topics`* (int array; topics nest ≤5 levels within topic sets) → true.

## 8. DEEP DIVE — bot-service (messaging-host; outbound chat)

- **sendTemplateMessage** — POST `https://{{messaging-host}}/api/v3/botService/sendTemplateMessage`: initiate outbound WhatsApp conversation via approved HSM template. Params: `client_id`* (E.164 phone), `channel_id`* (WhatsApp channel, from channel-settings URL), `message_template_id`* (from whatsappHsmTemplates/search; approved only), `header_param_value`, `header_attachment_id` | `header_url`, `text_param_values` (JSON body variables; no `{{}}` in values), `button_url_param_value` (dynamic URL-button suffix), `user_id` (route reply to a user; else queue/function), `variables` (JSON, ≤20 pairs, name ≤20 chars, value ≤200 chars). **Rate limit: 10 req/s.** → `{conversation_uuid, incoming_request_id, message_uuid}`.
- **sendMessage** — POST `.../botService/sendMessage`: `conversation_uuid`*, `text`* (or `payload` JSON attachment array, e.g. `[{"type":"photo","file_id":123}]`) → true. Bot speaks into an existing chat.

---

## 9. KALFA relevance analysis

- Kit is a separate product/account from the Voximplant Platform KALFA uses today (Management API `StartScenarios` + VoxEngine + ctx/cb bridge). Kit's `campaigns/create` (automated, dialer 2.0) + `appendContacts` + callbacks (`new_calls`/`call_finalized` with `completion_code`) is a full managed replacement for campaign dialing — pacing (`max_lines`), retries (`dialing_strategy` per-number attempts/intervals), working hours, DNC, Caller ID rotation — everything KALFA planned to hand-roll around CallList.
- BUT: Kit scenarios are Kit-flow scenarios (no raw VoxEngine `call.say()`/Groq bridge as-is); KALFA's Hebrew LLM agent would have to be rebuilt in Kit's scenario editor (Voice AI blocks) — a platform migration, not an add-on. `contact rows` carry arbitrary variables (no 200-byte cap like `script_custom_data`) — that cap disappears in Kit's model.
- `completion_code` (`Call_Answered` = the only "Successful") maps directly onto KALFA's per-reached-contact billing; `new_calls`/`call_finalized` callbacks push per-attempt cost + duration + record_url, removing the need to poll.
- DNC lists are first-class (dnc folder + campaign `dnc_list_ids` + `Restricted_By_DNC` completion code) — relevant to the Israeli legal DNC gate in the Voximplant bridge plan.
- Voicemail-detection models have NO Hebrew/Israel option (ru/kz/colombia/br/mx/ph/pe/us/cl only); `region` has no Israel (nearest: europe). TTS options for record-notifications are enumerated per-language (Google/Yandex/etc.) — Hebrew support in Kit scenario TTS would need separate verification.
- Callback security = md5(salt+domain+callbackType) — weaker than HMAC; must still IP-allowlist/validate on KALFA's side; 5-endpoint cap and 3×5-min retry policy matter for webhook design.
- The 16 callbacks include chat events; combined with bot-service sendTemplateMessage, Kit also overlaps KALFA's WhatsApp stack (template sends, 10 rps) — but KALFA already has a direct Meta integration; no reason to switch.
- Legacy `outbound` (dialer 1.0) folder still exists — any Kit adoption should target **campaigns - dialer 2.0** only.

## 10. Coverage
- Catalog: all 33 folders / 149 requests enumerated (method, URL, purpose; key params for deep-dive folders).
- Deep-dive fully documented: agentCampaigns (12/12), campaigns - dialer 2.0 (14/14), callback (4 CRUD + 16 event types), cti (2/2), calls (2/2), bot-service (2/2) = 36 requests in deep scope, all read with bodies + response examples.
