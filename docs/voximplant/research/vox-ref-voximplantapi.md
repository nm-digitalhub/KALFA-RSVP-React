# Vox docs research notes — group vox-ref-voximplantapi

Scope: `references.voxengine.voximplantapi.*` — the **in-scenario Management API wrapper** (VoximplantAPI Client usable from inside a VoxEngine scenario). 295 pages per manifest. Depth: structural; ~40 pages fetched (root, folder/class/interface hubs, FOCUS members for call lists / scenarios / sessions-history / queues / SMS).

NOTE: notes were written to this plan file because plan mode was active in this session (only this file was writable). Intended location was `<scratchpad>/vox-research/vox-ref-voximplantapi.md`.

## What this namespace is

A typed wrapper (class `Client`) exposing a subset of the HTTP Management API from inside VoxEngine scenarios. `new Client()` → properties, one per API domain, each an interface of `(request) => Promise<response>` methods. Request/response types mirror Management API params in camelCase (wire names snake_case). Every response carries `error: APIError {code, msg}` plus `result`. The root page and `constructor` page are empty (no auth/config docs here — auth/usage is documented under the VoxEngine Modules/Management-API guide, not in this reference subtree).

`Client` properties (24): Accounts, Applications, AuthorizedIPs, CallLists, CallerIDs, DialogflowCredentials, History, Invoices, KeyValueStorage, OutboundTestNumbers, PSTNBlacklist, PhoneNumbers, Queues, RecordStorages, RoleSystem, SIPRegistration, SIPWhiteList, SMS, Scenarios, Secrets, Skills, SmartQueue, Users, WABPhoneNumbers.

## Subcategory notes

### Scenarios (ScenariosInterface) — CRITICAL GAP
Contains ONLY `startConference(StartConferenceRequest)`. **No StartScenarios / reStartScenario in the in-scenario wrapper** — a running scenario cannot fan out new outbound sessions through this wrapper; that must go through the external HTTP Management API (as KALFA already does) or call-list machinery. `StartConferenceRequest`: `ruleId` (required), `conferenceName` (<50 chars), `scriptCustomData` (→ `VoxEngine.customData()`, x-www-form-urlencoded UTF-8 — same custom-data channel as StartScenarios), `applicationId/Name`, `userId/Name`, `referenceIp`, `serverLocation`.

### CallLists (CallListsInterface) — FOCUS
Methods: `createCallList`, `appendToCallList`, `getCallLists`, `editCallList`, `editCallListTasksPriority`, `cancelCallListTask`, `cancelCallListBatch`, `deleteCallList`. (No `getCallListDetails`/`startNextCallListTask` in this wrapper — those exist only in the external Management API.)
- `CreateCallListRequest`: `ruleId` + `priority` + `maxSimultaneous` + `numAttempts` (1..5) + `name` (≤255, no slashes) + `fileContent: Buffer` (CSV, send as HTTP body/multiform — NOT via URL, large headers get dropped); optional `intervalSeconds` (default 0), `delimiter` (default `;`), `encoding` (default UTF-8), `escape`, `listCustomData`, `referenceIp`, `serverLocation`, `taskPriorityStrategy` (`first_attempts` default | `repeated_attempts`). Per-record schedule via CSV magic columns `__start_execution_time` / (start/end per docs) UTC+0 24h. Response: `{listId, batchId (UUID), count, result, error}`.
- `AppendToCallListRequest`: `fileContent` + `listId` OR `listName`; same CSV options.
- `GetCallListsRequest`: filters by `applicationId` ('all' ok), `listId`, `name`, `isActive`, `fromDate/toDate` (UTC `YYYY-MM-DD HH:mm:ss`), `typeList` (`AUTOMATIC|MANUAL`), `count/offset`. → `CallList[]` {listId, listName, ruleId, priority, status (`In progress|Completed|Canceled`), dtSubmit/dtComplete, intervalSeconds, maxSimultaneous, numAttempts, taskPriorityStrategy}.
- `EditCallListRequest`: mutate `intervalSeconds`, `maxSimultaneous` (≥1), `numAttempts` (≥1), `priority` (lower value = higher priority), `name`, `startAt` (`yyyy-MM-dd HH:mm:ss`), `serverLocation` (invalid → error 496), `taskPriorityStrategy`, `listCustomData`; bad listId → error 251.
- `CancelCallListTaskRequest`: `listId` + `tasksIds` OR `tasksUuids` (semicolon-separated, max 1000 per call). `CancelCallListBatchRequest`: `batchIds` (semicolon-sep UUIDs) + listId/listName.
- `EditCallListTasksPriorityRequest`: `listId` + `tasks` = JSON array of {task_id|task_uuid, task_priority}.

### History (HistoryInterface) — FOCUS
`getCallHistory`, `getCallHistoryAsync` (for large exports), `getBriefCallHistory` (async, CSV output, `withHeader`), `getTransactionHistory`, `getTransactionHistoryAsync`.
- `GetCallHistoryRequest`: `fromDate/toDate` (selected timezone), filters: `applicationId/Name`, `ruleName`, `callSessionHistoryId` (≤1000 ids; from AppEvents.Started sessionID), **`callSessionHistoryCustomData`** (filter by session custom_data!), `remoteNumber`/`remoteNumberList`, `localNumber`, `userId`, `timezone`, `descOrder`; flags `withCalls`, `withRecords`, `withOtherResources`, `withTotalCount`; `count` ≤1000, `offset` ≤10000.
- `CallSessionInfo`: callSessionHistoryId, duration, `finishReason` (`Normal termination | Insufficient funds | Internal error (billing timeout) | Terminated administratively | JS session error | Timeout`), `logFileUrl` (**log retention 1 month**; secure-storage apps need auth to fetch), customData, calls: CallInfo[], records, otherResourceUsage, initiator/media server IPs, ruleName, audioQuality (Standard|HD|Ultra HD).
- `CallInfo`: callId, cost, duration, `endReason` (code+description), `successful`, incoming, local/remoteNumber, remoteNumberType (pstn/mobile/user/sip), recordUrl, customData, transactionId, startTime.

### SMS (SMSInterface) — FOCUS
`a2PSendSms` (A2P: `srcNumber` = SenderID **installed via support only**; `dstNumbers` ≤100 per call; `text` ≤1600 chars; segmentation >160 GSM-7 / >70 UTF-16, each segment billed; `storeBody` default false) → `{result: SmsTransaction[], failed: FailedSms[], fragmentsCount}`. `sendSmsMessage` (P2P between two numbers; source must be a Voximplant-purchased SMS-capable number with SMS enabled; body ≤765 chars). `controlSms` (`enable|disable` per phone number — incoming SMS charged once enabled). `getSmsHistory` / `a2PGetSmsHistory` (filters src/dst/direction IN|OUT, from/to UTC, count ≤1000, output json|csv|xls) → `SmsHistory` {messageId, cost, fragments, statusId 1=Success/2=Error/3=Waiting, errorMessage, transactionId}.

### Queues (QueuesInterface — classic ACD) and SmartQueue (SmartQueueInterface)
ACD: addQueue/delQueue/setQueueInfo/getQueues/bindUserToQueue/getACDState (`acdQueueId` list or 'all'). `QueueInfo`: priority (0 = highest), autoBinding by skills, averageServiceTime, maxQueueSize, maxWaitingTime (predicted, minutes), serviceProbability [0.5..1.0], slThresholds, skills, users. SmartQueue: full agent/queue/skill CRUD (`sQ_AddQueue`, `sQ_BindAgent`, `sQ_BindSkill`, custom agent-status mapping set/get/delete, `sQ_SetAgentInfo`…), monitoring: `getSQState`, `getSmartQueueRealtimeMetrics` (last 30 min), `getSmartQueueDayHistory` (last 2 days), `requestSmartQueueHistory`. Human-agent contact-center machinery — not needed for pure bot dialing.

### KeyValueStorage (KeyValueStorageInterface)
set/get/getItems (key-prefix pattern)/getKeys/del. `SetKeyValueItemRequest`: key ≤200 chars with `namespace:` convention, value ≤2000 chars, `ttl` 0..7,776,000s (90d; default 30d) or `expiresAt` timestamp — one of the two required; keys unique per application. Cross-session state shared with the external Management API and in-scenario ApplicationStorage.

### Secrets (SecretsInterface)
addSecret/getSecrets/getSecretValue/setSecretInfo/delSecret — per-application secret store (alternative to passing API keys through ctx endpoints / custom data).

### PSTNBlacklist (PSTNBlacklistInterface)
add/set/get/del by `pstnBlacklistPhone` (E.164 or regex). **Blocks INCOMING calls to Voximplant-purchased numbers only** — it is not an outbound DNC mechanism; outbound DNC must stay app-side (KALFA's mark_dnc). SIP-origin numbers must be filtered in scenario JS.

### Other domains (structural)
- Accounts: getAccountInfo (balance/email/etc.), getCurrencyRate (per USD, by date) — usable for balance monitoring from inside a scenario.
- Applications/Users/Skills/CallerIDs/AuthorizedIPs/SIPWhiteList/SIPRegistration/RoleSystem: account-admin CRUD mirrors.
- PhoneNumbers: getPhoneNumbers(+Async), isAccountPhoneNumber. OutboundTestNumbers: add/verify/activate/del/get (verified personal test numbers for outbound testing without buying a number).
- Invoices: getAccountInvoices, downloadInvoice (+ InvoicePeriod/Spending/Taxes/Total detail types).
- RecordStorages: getRecordStorages. DialogflowCredentials: setDialogflowKey. WABPhoneNumbers: getWABPhoneNumbers (WhatsApp Business numbers).

## KALFA relevance
- StartScenarios is NOT callable via this in-scenario wrapper (only startConference) — keep launching sessions from the Next.js backend via HTTP Management API; the 200-byte `script_custom_data` cap is not lifted by this wrapper (StartConferenceRequest uses the same mechanism).
- CallList evaluation: full create/append/monitor/cancel lifecycle exists here; CSV body upload, numAttempts 1..5, intervalSeconds, maxSimultaneous, per-record `__start_execution_time` daily windows (useful for Israeli calling-hour compliance), batchId cancel, `listCustomData`; but task-level detail (GetCallListDetails) and manual StartNextCallListTask require the external API.
- `GetCallHistoryRequest.callSessionHistoryCustomData` lets KALFA reconcile sessions by its own custom_data (e.g., campaign/guest id) — good for the stuck-call reconciler and billing per reached contact; `CallInfo.successful`, `duration`, `cost`, `endReason` are the billing-relevant fields; logs expire after 1 month.
- KeyValueStorage (90-day TTL, 2000-char values) can carry per-call context larger than the 200-byte custom-data cap: backend writes key, scenario reads it — an alternative/complement to the ctx endpoint.
- Secrets interface could hold the Groq key app-side instead of serving it via ctx endpoint.
- PSTN blacklist is inbound-only — KALFA's DNC list must remain in its own DB.
- SMS here is a possible fallback channel (A2P SenderID needs support ticket; ≤100 dst/call; segment billing), though KALFA already has ExtrA SMS.
- SmartQueue/ACD is human-agent machinery — out of scope for the AI-bot flow, relevant only if human escalation is ever added.

## INVENTORY (all 295 pages in scope; titles as in manifest)

Root/hub: VoximplantAPI (ref_folder); Client (class).

Interfaces (hub objects): AccountsInterface, ApplicationsInterface, AuthorizedIPsInterface, CallListsInterface, CallerIDsInterface, DialogflowCredentialsInterface, HistoryInterface, InvoicesInterface, KeyValueStorageInterface, OutboundTestNumbersInterface, PSTNBlacklistInterface, PhoneNumbersInterface, QueuesInterface, RecordStoragesInterface, RoleSystemInterface, SIPRegistrationInterface, SIPWhiteListInterface, SMSInterface, ScenariosInterface, SecretsInterface, SkillsInterface, SmartQueueInterface, UsersInterface, WABPhoneNumbersInterface.

A2P/SMS: A2PGetSmsHistoryRequest, A2PGetSmsHistoryResponse, A2PSendSmsRequest, A2PSendSmsResponse, A2PSmsHistory, ControlSmsRequest, ControlSmsResponse, FailedSms, GetSmsHistoryRequest, GetSmsHistoryResponse, SendSmsMessageRequest, SendSmsMessageResponse, SmsHistory, SmsTransaction.

ACD/queues: ACDAfterServiceOperatorState, ACDLock, ACDLockedOperatorState, ACDOperatorCall, ACDQueueOperatorInfo, ACDQueueState, ACDReadyOperatorState, ACDServicingCallState, ACDState, ACDWaitingCallState, AddQueueRequest, AddQueueResponse, BindUserToQueueRequest, BindUserToQueueResponse, DelQueueRequest, DelQueueResponse, GetACDStateRequest, GetACDStateResponse, GetQueuesRequest, GetQueuesResponse, QueueInfo, QueueSkills, QueueUsers, SetQueueInfoRequest, SetQueueInfoResponse.

SmartQueue: GetSQAgentsResult, GetSQQueuesResult, GetSQSkillsResult, GetSQStateRequest, GetSQStateResponse, GetSmartQueueDayHistoryRequest, GetSmartQueueDayHistoryResponse, GetSmartQueueRealtimeMetricsRequest, GetSmartQueueRealtimeMetricsResponse, RequestSmartQueueHistoryRequest, RequestSmartQueueHistoryResponse, SQAddQueueResult, SQAddSkillResult, SQ_AddQueueRequest, SQ_AddQueueResponse, SQ_AddSkillRequest, SQ_AddSkillResponse, SQ_BindAgentRequest, SQ_BindAgentResponse, SQ_BindSkillRequest, SQ_BindSkillResponse, SQ_DelQueueRequest, SQ_DelQueueResponse, SQ_DelSkillRequest, SQ_DelSkillResponse, SQ_DeleteAgentCustomStatusMappingRequest, SQ_DeleteAgentCustomStatusMappingResponse, SQ_GetAgentCustomStatusMappingRequest, SQ_GetAgentCustomStatusMappingResponse, SQ_GetAgentsRequest, SQ_GetAgentsResponse, SQ_GetQueuesRequest, SQ_GetQueuesResponse, SQ_GetSkillsRequest, SQ_GetSkillsResponse, SQ_SetAgentCustomStatusMappingRequest, SQ_SetAgentCustomStatusMappingResponse, SQ_SetAgentInfoRequest, SQ_SetAgentInfoResponse, SQ_SetQueueInfoRequest, SQ_SetQueueInfoResponse, SQ_SetSkillInfoRequest, SQ_SetSkillInfoResponse, SQ_UnbindAgentRequest, SQ_UnbindAgentResponse, SQ_UnbindSkillRequest, SQ_UnbindSkillResponse, SmartQueueAgentSkill, SmartQueueMetricsGroups, SmartQueueMetricsGroupsValues, SmartQueueMetricsResult, SmartQueueState, SmartQueueStateAgent, SmartQueueStateAgentStatus, SmartQueueStateAgentStatus_, SmartQueueStateTask, SmartQueueTaskSkill.

Call lists: AppendToCallListRequest, AppendToCallListResponse, CallList, CancelCallListBatchRequest, CancelCallListBatchResponse, CancelCallListTaskRequest, CancelCallListTaskResponse, CreateCallListRequest, CreateCallListResponse, DeleteCallListRequest, DeleteCallListResponse, EditCallListRequest, EditCallListResponse, EditCallListTasksPriorityRequest, EditCallListTasksPriorityResponse, GetCallListsRequest, GetCallListsResponse.

History/sessions: CallInfo, CallSessionInfo, GetBriefCallHistoryRequest, GetBriefCallHistoryResponse, GetCallHistoryAsyncRequest, GetCallHistoryAsyncResponse, GetCallHistoryRequest, GetCallHistoryResponse, GetTransactionHistoryAsyncRequest, GetTransactionHistoryAsyncResponse, GetTransactionHistoryRequest, GetTransactionHistoryResponse, Record, ResourceUsage, TransactionInfo.

Account/billing: AccountInfo, AccountInvoice, BankCardBillingLimitInfo, BillingLimitInfo, BillingLimits, DownloadInvoiceRequest, DownloadInvoiceResponse, ExchangeRates, GetAccountInfoRequest, GetAccountInfoResponse, GetAccountInvoicesRequest, GetAccountInvoicesResponse, GetCurrencyRateRequest, GetCurrencyRateResponse, InvoicePeriod, InvoiceSpendingDetails, InvoiceTaxesDetails, InvoiceTotalDetails.

Applications/users/skills/roles: AddApplicationRequest, AddApplicationResponse, AddSkillRequest, AddSkillResponse, AddUserRequest, AddUserResponse, ApplicationInfo, BindSkillRequest, BindSkillResponse, DelApplicationRequest, DelApplicationResponse, DelSkillRequest, DelSkillResponse, DelUserRequest, DelUserResponse, GetApplicationsRequest, GetApplicationsResponse, GetRoleGroupsRequest, GetRoleGroupsResponse, GetSkillsRequest, GetSkillsResponse, GetUsersRequest, GetUsersResponse, RoleGroupView, SetApplicationInfoRequest, SetApplicationInfoResponse, SetSkillInfoRequest, SetSkillInfoResponse, SetUserInfoRequest, SetUserInfoResponse, SkillInfo, UserInfo.

Numbers/caller ID/test numbers: ActivateOutboundTestPhoneNumberRequest, ActivateOutboundTestPhoneNumberResponse, AddOutboundTestPhoneNumberRequest, AddOutboundTestPhoneNumberResponse, AttachedPhoneInfo, CallerIDInfo, DelCallerIDRequest, DelCallerIDResponse, DelOutboundTestPhoneNumberRequest, DelOutboundTestPhoneNumberResponse, GetCallerIDsRequest, GetCallerIDsResponse, GetOutboundTestPhoneNumbersRequest, GetOutboundTestPhoneNumbersResponse, GetPhoneNumbersAsyncRequest, GetPhoneNumbersAsyncResponse, GetPhoneNumbersRequest, GetPhoneNumbersResponse, GetWABPhoneNumbersRequest, GetWABPhoneNumbersResponse, IsAccountPhoneNumberRequest, IsAccountPhoneNumberResponse, OutboundTestPhonenumberInfo, VerifyOutboundTestPhoneNumberRequest, VerifyOutboundTestPhoneNumberResponse, WABPhoneInfo.

Security/IPs/SIP: AddAuthorizedAccountIPRequest, AddAuthorizedAccountIPResponse, AddSipWhiteListItemRequest, AddSipWhiteListItemResponse, AuthorizedAccountIP, BindSipRegistrationRequest, BindSipRegistrationResponse, CheckAuthorizedAccountIPRequest, CheckAuthorizedAccountIPResponse, DelAuthorizedAccountIPRequest, DelAuthorizedAccountIPResponse, DelSipWhiteListItemRequest, DelSipWhiteListItemResponse, GetAuthorizedAccountIPsRequest, GetAuthorizedAccountIPsResponse, GetSipRegistrationsRequest, GetSipRegistrationsResponse, GetSipWhiteListRequest, GetSipWhiteListResponse, SIPRegistration, SetSipWhiteListItemRequest, SetSipWhiteListItemResponse, SipWhiteListInfo.

PSTN blacklist: AddPstnBlackListItemRequest, AddPstnBlackListItemResponse, DelPstnBlackListItemRequest, DelPstnBlackListItemResponse, GetPstnBlackListRequest, GetPstnBlackListResponse, PstnBlackListInfo, SetPstnBlackListItemRequest, SetPstnBlackListItemResponse.

Key-value storage: DelKeyValueItemRequest, DelKeyValueItemResponse, GetKeyValueItemRequest, GetKeyValueItemResponse, GetKeyValueItemsRequest, GetKeyValueItemsResponse, GetKeyValueKeysRequest, GetKeyValueKeysResponse, KeyValueItems, KeyValueKeys, SetKeyValueItemRequest, SetKeyValueItemResponse.

Secrets: AddSecretRequest, AddSecretResponse, AddSecretResult, DelSecretRequest, DelSecretResponse, GetSecretValueRequest, GetSecretValueResponse, GetSecretValueResult, GetSecretsRequest, GetSecretsResponse, SecretListItem, SetSecretInfoRequest, SetSecretInfoResponse.

Misc: APIError, DownloadInvoiceRequest/Response (listed above), GetRecordStoragesRequest, GetRecordStoragesResponse, RecordStorageInfo, SetDialogflowKeyRequest, SetDialogflowKeyResponse, StartConferenceRequest, StartConferenceResponse.
