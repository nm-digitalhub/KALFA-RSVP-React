# Voximplant Kit API — anchored research notes: `agentCampaigns` folder (PDS campaigns)

Group: kit-api-anchored
Source: local Postman collection `scratchpad/kit-collection.json` ("Voximplant Kit API documentation", postman id 2db2ab94-821b-4acb-88f7-01979c5b2692), the collection behind https://kit-apidoc.voximplant.com/.
Anchor: `#35cddb0a-c2fb-4a74-9c1c-fdd5b3271e42` — this id is **not a request; it is the folder id of the top-level folder `agentCampaigns`** (12 requests). All 12 sibling requests are documented below.

NOTE: written to the plan file because plan mode was active in this session (only writable path). Intended path was `vox-research/kit-api-anchored.md`.

---

## 0. Collection-level context (applies to every request below)

- Base: `https://{{host}}/api/v3/agentCampaigns/<method>?domain={{domain}}` — all methods are **POST** with `application/x-www-form-urlencoded` bodies (file uploads, where relevant, use multipart/form-data).
- Auth: `access_token` body param = API token generated in Kit under **Administration > Security > API tokens**; `domain` query param = account name; `{{host}}` = per-account API host from the same screen. No Postman-level auth object; no collection variables defined (all `{{...}}` placeholders are user-supplied).
- Regional hosts exist (us, br, eu, kz, ru, ru2) — e.g. CTI host pattern `kit-cti-<region>.voximplant.com`.
- Collection overview also defines **completion codes** for call attempts (`completion_code` in callbacks/reports): `Call_Answered` (the only "successful" one), `Other_Error`, `Temporary_Unavailable` (SIP 480), `Request_Terminated` (487), `AMD` (answer machine detected), `Invalid_Number` (404), `Call_Busy` (486), `No_Answer` (408/timeout), `Insufficient_Funds` (402), `Call_Was_Rejected` (603), `Restricted_By_DNC`, `Abandoned` (customer answered, no agent), `Lost_By_Agent`, `Missed_By_Scenario`, `No_Agents`, `System_Error`, `Call_Prohibited` (403).

## 1. Folder: `agentCampaigns` (id 35cddb0a-c2fb-4a74-9c1c-fdd5b3271e42)

Folder description (verbatim, stripped): *"This folder contains actions you may need to manage PDS campaigns. A PDS campaign is a dialing campaign that uses agents to call customers. The unique feature of a PDS campaign is that it assigns phone calls to agents before they become available. This approach increases agents' efficiency by dialing as many customers as possible."*

PDS = Predictive Dialing System. These are **agent-based** (human contact-center agents) predictive/progressive dialer campaigns — distinct from the sibling top-level folders `campaigns - dialer 2.0` (automated/IVR campaigns) and `outbound`.

The 12 requests (all POST, all urlencoded, each with one 200-OK example response):

| # | name | path | request id |
|---|------|------|------------|
| 0 | createCampaign | /api/v3/agentCampaigns/createCampaign | bc791147-69df-4566-9b7a-52abee782937 |
| 1 | deleteCampaign | /api/v3/agentCampaigns/deleteCampaign | adc62844-1bc0-46b9-8375-56a3b0612973 |
| 2 | searchCampaigns | /api/v3/agentCampaigns/searchCampaigns?sort=-id&per-page=50 | 4af318b2-48fd-4367-a034-a05d639abfca |
| 3 | updateCampaign | /api/v3/agentCampaigns/updateCampaign | 7f146e06-cd74-48eb-acd2-77591784c4e0 |
| 4 | setCampaignStatus | /api/v3/agentCampaigns/setCampaignStatus | 1cba289d-90a1-44cc-8b53-250e51978c39 |
| 5 | setListStatus | /api/v3/agentCampaigns/setListStatus | a3857cbd-c1d9-412c-a29c-12c00485ec92 |
| 6 | searchContacts | /api/v3/agentCampaigns/searchContacts | 45f7d4d9-8249-4bcc-907a-1c90f8b4b496 |
| 7 | appendContacts | /api/v3/agentCampaigns/appendContacts | ce67fb50-2216-4a84-b8be-7a0e6be3517b |
| 8 | searchCampaignLists | /api/v3/agentCampaigns/searchCampaignLists | 8c5357e9-273d-4589-be77-81553aed3881 |
| 9 | cancelContacts | /api/v3/agentCampaigns/cancelContacts | 8556a798-1bcb-456b-a545-c925db18a193 |
| 10 | addAttempts | /api/v3/agentCampaigns/addAttempts | 1a232f69-92f5-4470-a6bb-38d6c787c992 |
| 11 | getStat | /api/v3/agentCampaigns/getStat | 74f47b06-9dfc-430e-a30d-942d855eede4 |

---

## 2. createCampaign (POST /api/v3/agentCampaigns/createCampaign?domain={{domain}})

"Creates a PDS campaign." Largest request in the folder (~40 body params).

### Body params (urlencoded; `(d)` = disabled/optional example in collection)
- `access_token` — String. Required. API token.
- `title` — String. Required. Campaign name, max 255 chars.
- `folder_id` (d) — Integer. Optional. Campaign folder (default root). Must be a PDS-campaign-type folder.
- **Caller-number selection (exactly one mechanism required):**
  - `phone_number_id` — Integer. Required if caller_id & sip_number_id empty. Kit-purchased number id (see `phone/searchNumbers`).
  - `caller_id` (d) — Integer. Required if others empty. Verified custom Caller ID (see `callerid/searchCallerIDs`).
  - `sip_number_id` (d) — Integer. Required if others empty. External number bound to a SIP trunk (see `sipNumber/searchSipNumber`).
  - `phone_numbers` (d) — JSON object. Required if the three above empty. Rotating Caller-ID pool, max 100 numbers, e.g. `{"phone_number_ids":[1,2,3,4],"caller_id_ids":[1]}` or `{"sip_number_ids":[3,4,8]}`. phone_number_ids+caller_id_ids may combine; sip_number_ids may NOT combine with the others. Numbers must be active.
- **Schedule:** `date_start` (d), `date_end` (d) — `YYYY-MM-DD HH:mm:ss`, default null (start = on launch). `working_time` (d) — array `["12:00:00","16:00:00"]` in the **customer's local time**, computed from the contact's `UTC` field in the list; empty = call 24/7.
- **Retry policy:** `max_attempts` — 1..5, default 1; `interval` (d) — minutes between attempts, default 60.
- **Agents & distribution:** `user_ids` (d) — Integer array (see `user/searchUsers`); `operator_priority_strategy` (d) — MOST_QUALIFIED | LEAST_QUALIFIED | MAX_WAITING_TIME (default); `request_priority_strategy` (d) — MAX_PRIORITY (default) | MAX_WAITING_TIME.
- **Voicemail detection:** `voicemail_detection_enabled` (d) — bool, default false; `voicemail_detection_model` — required if enabled, one of `ru|kz|colombia|br|mx|ph|pe|us|cl|ru_experimental_vm|ru_experimental_human` (**no Israel/he model**); `voicemail_detection_timeout_sec` — float 1..10; `voicemail_detection_timeout_continue_call` (d) — bool: on undetermined, true = route to agent, false = hang up.
- **Pace / dialer tuning:** `dial_up_time_sec` (d) — seconds to dial a customer before moving on (default 40 per response); `mode` (d) — `predictive` (default; algorithm predicts agent availability from #agents, AHT, success/fail ratio) or `progressive` (one dial per available agent); `task_multiplier` (d) — float 1.0..25.0 (progressive only; limit 100 for >20 agents); `abandonment_rate` (d) — int 1..100, default 3 (predictive only).
- **After-service:** `afterservice_time_limit_enabled` (d) — bool, default false; `afterservice_time_limit` (d) — seconds, default 0.
- **Recording & notification:** `can_outbound_record` (d) — bool, default false (legal warning about consent included); `outbound_record_notification_type` (d) — none|media|tts; `outbound_record_notification_duration` (d) — DEFAULT|SIXMONTHS|ONEYEAR|TWOYEARS|THREEYEARS; `tts_language`, `tts_voice`, `tts_text` (d) — required for tts notification; `media_id` (d) — required for media notification (see `media/searchMedia`). The tts_language/tts_voice catalog embedded in the description is enormous (all providers: Google, Amazon, Microsoft, Yandex, IBM, TBank, SaluteSpeech, ElevenLabs, Deepgram). **Hebrew (Israel) is listed with Microsoft only: voices Avri, Hila** — no Google/ElevenLabs Hebrew voices in this catalog.
- **Call handling:** `client_waiting_media_id` (d) — media played to customer while waiting for agent; `call_auto_answer` (d) — bool, default false; `agents_can_decline_calls` (d) — bool, default true.
- **Region:** `region_enabled` (d) — bool; `region` — required if enabled: `usa|europe|south_america|singapore|russia|kazakhstan` (**no Israel region**).
- **Compliance lists:** `wrap_up_codes_set_id` (d) — wrap-up codes set (agents label call outcomes); `wrap_up_dnc_list_id` (d) — DNC list required when the set contains an "Add to DNC list" code; `dnc_lists` (d) — Integer array of DNC list ids to bind (contacts on them are not called; see `dnc/searchDncList`).

### Documented error table (highlights)
- 402 `Minimum balance necessary for operation is {balance} {currency}` — insufficient domain balance.
- 403 not-allowed (Agent/Manager/Supervisor roles can't create); 403 `Contact center not enabled`.
- 404 for bad folder / media / wrap-up set / DNC lists / phone number / caller id / users / topic set.
- 422 validation family: bad title/mode; `date_start` < today; `date_end` < now+1h; `date_end` < start+1h; invalid working time (format / end<start); `Phone number types cannot be combined`; unknown phone-number type key; empty/invalid phone id arrays; **`File is empty` / `File is too big` (max 20 MiB) / `Call list properties is invalid`** (a contact file can be attached at creation via multipart); `Max queues count per account reached`; wrong folder type; invalid TTS language+voice pair; empty wrap-up set; DNC-code set without DNC list; empty/inactive/denied-category numbers; number without redirection; **max 500 phone numbers per campaign**; inactive Caller ID; user exceeds queue blending limit; `User is not supervisor`; empty topic set.
- 500 internal.

### 200 response example (shape)
`{success:true, result:{ id, title, status:"draft", mode:"predictive", folder_id, date_start, date_end, working_time:["",""], max_attempts, interval, phone_number_id, caller_id, settings:{ voicemail_detection_enabled, dial_up_time_sec:40, outbound_call_recording:{enabled, notification:{type,tts_text,tts_voice,tts_language,media_id}, storage_period:"DEFAULT"} }, create_date, created_by, edit_date, edited_by, queue:{id,title,operator_priority_strategy,request_priority_strategy,afterservice_time_limit_enabled,afterservice_time_limit,agents_can_end_calls,agents_can_decline_calls}, timezone:"UTC", sip_number_id, use_tags, use_topics, topic_set_id, task_multiplier:1, abandonment_rate:3, reference_ip }}`
Key facts: a new campaign is born in **`draft`** status and auto-creates a **queue** with the same title.

---

## 3. deleteCampaign (POST .../deleteCampaign)

Body: `access_token` (req), `id` (Integer, req — campaign id from searchCampaigns).
Errors: 403 role not allowed; 404 campaign not found; 422 bad id; 422 `Agent campaign is active` — **only draft / completed / scheduled campaigns can be deleted** (ongoing or paused cannot).
200: `{success:true, result:true}`.

## 4. searchCampaigns (POST .../searchCampaigns?domain=...&sort=-id&per-page=50)

Query: `domain`, plus pagination/sort in the URL (`sort=-id`, `per-page=50`; body `page` param for page number).
Body filters: `id`, `title`, `status` (array of `draft|ongoing|paused|completed|scheduled`), `folder_id`, plus include-flags `with_queue`, `with_campaign_lists`, `with_users`, `with_folder_name`, `with_wrap_up_codes_set`, `with_dnc_lists`, `with_supervisors`, `with_phone_numbers` (bool/0/1, default false), and oddly `task_multiplier` / `abandonment_rate` filters; `page`.
200 example: array of campaign objects (same shape as createCampaign result) each **plus** `dialing_started`, `wrap_up_dnc_list {id,title}`, `wrap_up_codes_set {id,title}`, `dnc_lists[]`, and an embedded **`stat`** block: `{call_item_count, call_ended, call_success, call_failed, call_canceled, cost, success_calls_duration}`; plus `_meta {totalCount,pageCount,currentPage,perPage}` (Yii-style pagination).

## 5. updateCampaign (POST .../updateCampaign)

"Updates a PDS campaign." Body = `access_token`, `id` (req), `title` (req) and the same optional field set as createCampaign (caller_id / sip_number_id / phone_numbers, max_attempts, interval, working_time — special semantics: empty value ⇒ set null, omitted ⇒ unchanged — user_ids, mode, voicemail_* , dial_up_time_sec, afterservice_*, recording/notification + tts_*/media_id, client_waiting_media_id, agents_can_decline_calls, region_enabled/region, call_auto_answer, dnc_lists, wrap_up_codes_set_id, wrap_up_dnc_list_id, task_multiplier, abandonment_rate). No folder_id/date fields shown as enabled; phone_number_id not present (use phone_numbers/caller_id/sip_number_id).
Errors: 403 (Agent/Manager can't update; Supervisor lacking queue-editor permission; Supervisor may not update `user_ids`); 404 campaign; 422 `Agent campaign is completed` (immutable when completed); 422 `Agent campaign is started` (can't change date_start after dialing started); 422 `Agent campaign is ongoing` (can't change schedule while ongoing); date validations as in create; plus "Same as createCampaign" catch-all row: all create validations apply to corresponding fields.
200: full updated campaign object incl. `wrap_up_codes_set_id`, `wrap_up_dnc_list_id`, `dnc_lists`.

## 6. setCampaignStatus (POST .../setCampaignStatus)

Body: `access_token`, `id` (req), `status` (req) — settable values **`ongoing|paused|completed`** (lifecycle also includes draft & scheduled, which are system-set).
Errors: 402 insufficient balance on transition to ongoing/scheduled; 403 role restrictions (Supervisor cannot set completed; needs queue-editor permission); 403 Contact Center disabled; 404; 422 invalid status; 422 `Campaign status can not be changed from {from} to {to}` (transition matrix enforced); 422 must have an active Caller ID/phone/SIP number to launch; 422 `Not allowed to launch a campaign without agents`; 422 can't set ongoing before date_start.
200: `{success:true, result:true}`.
=> This is the **launch/pause/stop switch**: create (draft) → setCampaignStatus ongoing (or scheduled via date_start) → paused/completed.

## 7. setListStatus (POST .../setListStatus)

"Sets a status of a PDS campaign contact list." Body: `access_token`, `id` (req — contact-list id from searchCampaignLists), `status` (req) — **`ongoing|paused|canceled`** (per-list control, independent of campaign status). 200: `{success:true,result:true}`. (Minimal docs; no error table.)

## 8. searchContacts (POST .../searchContacts)

Body filters: `id` (contact id), `campaign_id`, `campaign_list_id` (array or int), `phone`, `status` (array of `ongoing|success|failed|canceled`), `from`/`to` (`YYYY-MM-DD HH:mm:ss` window).
200 example — contact object: `{id, agent_campaign_list_id, agent_campaign_id, phone:"17474888510", timezone:"America/Aruba", status:"ongoing", max_attempts, current_attempt, custom_data:{UTC:"America/Aruba", phone:"...", ...any imported columns}, last_attempt_date, create_date, created_by, edit_date, edited_by, canceled_by, cancel_reason, cancel_date, interval:[], callback_at}` + `_meta` pagination (perPage 20 default).
Note: **every imported CSV/JSON column round-trips in `custom_data`** — this is where per-contact variables live (name, event id, etc.).

## 9. appendContacts (POST .../appendContacts)

"Adds contacts to an existing PDS campaign." Body: `access_token`, `campaign_id` (req), `rows` (req) — JSON array, **max 5000 rows per call**; **`phone` and `UTC` fields are required** per row; arbitrary extra fields allowed (become custom_data) but **all rows in one request must have the identical field set** (else 422 `Different number of cells in rows`). Example: `[{"phone":"17474888510","UTC":"America/Aruba"}]`.
Errors: 402 balance; 403 role / Contact Center disabled; 404 campaign; 422 validation; 422 `Agent campaign is completed`; 422 caller number must be set; 422 >5000 rows; 422 invalid JSON in rows.
200: `{success:true, result:{list_id, count, success_count, errors_count, fail_list:[]}}` — appending creates/targets a **contact list** (`list_id`) inside the campaign; per-row failures come back in `fail_list`.

## 10. searchCampaignLists (POST .../searchCampaignLists)

Body filters: `id`, `status` (array of `processing|ongoing|paused|completed`), `agent_campaign_id`.
200 example — list object: `{id, agent_campaign_id, status, is_from_api (false when uploaded as a file, true when created via appendContacts), file_name:"Contacts.xlsx", file_size, call_item_count (e.g. 199999), call_ended, call_success, call_failed, cost:"0", success_calls_duration, processing_status:{processed, invalid_phone, invalid_timezone}, create_date, created_by, edit_date, edited_by, call_canceled}` + `_meta`.
=> Per-list dialing/cost stats and import-validation counters (invalid_phone / invalid_timezone).

## 11. cancelContacts (POST .../cancelContacts)

Body: `access_token`, `campaign_id` (req), `contact_ids` (req, array, e.g. `[115026]`), `comment` (optional, ≤255 chars; validation also mentions a `cancel_all` alternative flag — contact_ids OR cancel_all must be present).
Errors: 403 roles/CC disabled/supervisor queue permission; 404 campaign; 422 validation; 422 campaign completed.
200: `{success:true,result:true}`. => The opt-out/withdraw lever for individual queued contacts.

## 12. addAttempts (POST .../addAttempts)

"Adds dialing attempts to specific contacts." Body: `access_token`, `campaign_id` (req), `contact_ids` (req array), `interval` (req — time between attempts), `max_attempts` (req). 200: `{success:true,result:true}`. => Re-dial exhausted/failed contacts without re-importing.

## 13. getStat (POST .../getStat)

Body: `access_token` only. 200: `{success:true, result:{draft, paused, ongoing, scheduled, completed, total}}` — account-wide campaign counts by status (dashboard-style).

---

## 14. End-to-end workflow this folder implements

1. **Prepare prerequisites** (other folders): buy/verify a caller number (`phone`/`callerid`/`sipNumber`), create users/agents (`user`, `usergroup`), optional wrap-up code sets (`wrapUpCodes`), DNC lists (`dnc`), media files (`media`).
2. **createCampaign** → campaign in `draft` with an auto-created agent queue; configure mode (predictive vs progressive), pace (abandonment_rate / task_multiplier / dial_up_time_sec), retries, working hours (per-contact local time via `UTC`), AMD, recording+notification, DNC binding.
3. **appendContacts** (≤5000/row batches, uniform columns, phone+UTC required) → builds contact lists (`list_id`); or upload a file at creation (multipart, ≤20 MiB). Monitor import via **searchCampaignLists** (`processing_status`).
4. **setCampaignStatus → ongoing** (or set `date_start` for `scheduled`); gates: balance, agents in queue, active caller number, Contact Center enabled.
5. During the run: **setCampaignStatus paused/ongoing** (whole campaign), **setListStatus** (individual lists), **cancelContacts** (pull specific people out), **addAttempts** (extra re-dials), **searchContacts** (per-contact progress: status, current_attempt, callback_at, custom_data).
6. Monitor & finish: **searchCampaigns** with `stat` block (calls succeeded/failed/canceled, cost, talk duration), **getStat** for the account overview, **setCampaignStatus completed**; only draft/completed/scheduled campaigns can be **deleteCampaign**-ed. Completed campaigns are immutable.
7. Call outcomes surface as **completion codes** (Call_Answered, AMD, Abandoned, Restricted_By_DNC, ...) in reports/callbacks (see `history`/`report`/`callback` folders).

---

## 15. KALFA relevance (assessment)

- This whole folder is the **agent-based (human) predictive dialer** of Voximplant Kit — a different product surface than KALFA's current Voximplant Platform VoxEngine + StartScenarios AI-calling bridge. It presumes a staffed contact center (queues, agents, supervisors, wrap-up codes). KALFA has no human agents, so `agentCampaigns` is NOT a fit for the AI confirmation-call flow; the Kit folder to evaluate for automated calling is `campaigns - dialer 2.0` (automated campaigns) — sibling, out of this group's scope.
- Still, the model here is a useful reference for KALFA's own campaign dialer semantics: per-contact `max_attempts`/`interval`, per-contact local-time working windows keyed by a required `UTC` timezone column (Israel-only ⇒ trivially `Asia/Jerusalem`), DNC-list binding (matches KALFA's mark_dnc requirement and Israeli legal gates), cancelContacts as the mid-campaign opt-out lever, and per-list stats incl. `cost` (relevant to per-reached-contact billing: `call_success` ≈ "reached").
- Constraints worth noting if KALFA ever adopts Kit: campaign caller-ID pools max 100 numbers (500 phones/campaign), appendContacts max 5000 rows/request with uniform columns, contact file ≤20 MiB, **AMD voicemail-detection models have no Israeli/Hebrew option** (ru/kz/br/mx/us/... only), **region enum has no Israel/Middle East** (nearest = europe), and Hebrew TTS in Kit's catalog = **Microsoft Avri/Hila only** (no Google he-IL, no ElevenLabs Hebrew listed) — weaker than what KALFA already does on the Platform side, and notable given KALFA is evaluating ElevenLabs (ElevenLabs voices appear across many languages in Kit's catalog, but not for Hebrew).
- Billing/ops parallels: 402 minimum-balance gates on launch/append mirror the Platform-side $2.88-balance gate KALFA already tracks; `success_calls_duration` + `cost` per list/campaign is the shape of data KALFA needs for reconciliation.
