# Voximplant Management API (HTTP API) — Platform Group Research Notes

Group: httpapi-platform · Scope: references.httpapi root + all sections EXCEPT calllists, scenarios, rules, history, phonenumbers, queues, callerids, outboundtestnumbers.
Source: https://voximplant.com/api/v2/getDoc?fqdn=<fqdn> (live-fetched 2026-07-19). Public URL pattern: https://voximplant.com/docs/references/httpapi/<section>.

NOTE: this file lives at the plan path because the session ran in plan mode (scratchpad writes blocked); intended path was scratchpad/vox-research/httpapi-platform.md.

## Structure / request format & auth (root + Structure section + observed examples)

- Base endpoint: `https://api.voximplant.com/platform_api/<MethodName>/` — plain GET/POST with URL-encoded query params; multiple IDs separated by `;` (URL-encoded `%3B`), e.g. `child_account_id=414877;464478`.
- Two auth modes visible in every example:
  1. Legacy credential params: `account_id` + `api_key` (or `account_name`/`account_email` + `account_password`) directly in the query string.
  2. Service-account JWT: examples all show `curl -H "$(bash token.sh)"` i.e. an `Authorization: Bearer <JWT>` header signed with a RoleSystem private key (CreateKey). Token errors are explicit codes: 447 INVALID_TOKEN_FORMAT, 454 INVALID_TOKEN_TTL (TTL exceeds max), 455 TOKEN_ISSUED_IN_FUTURE, 456 TOKEN_EXPIRED.
- Every response is JSON with either a `result` payload (often `result: 1` for success plus typed objects) or `{"error": {"code": N, "msg": "..."}}` (struct `API_Error` = {code:number, msg:string}).
- Per-method access control: each method documents allowed roles (e.g. Owner, Admin, Developer, Supervisor, User manager, Call list manager, Accountant, Payer, Support, CallsSMS). Methods without a roles list appear callable by main-account credentials.
- List methods share a pagination idiom: `count` + `offset`, returning `count`, `total_count`, `result[]`.
- The Structure section is a pure type catalog: 199 `api_struct` pages (see INVENTORY). Notable for platform work: AccountInfoType, ApplicationInfoType, UserInfoType, KeyInfo/KeyView/RoleView/RoleGroupView/SubUserView, KeyValueItems/KeyValueKeys/KeyValuePairs, SecretListItem/AddSecretResult/GetSecretValueResult, SmsTransaction/FailedSms/SmsHistoryType/A2PSmsHistoryType, API_Error, and ~40 `*Callback` structs that define the account callback_url webhook payloads (AccountCallback envelope + per-event items such as CardPaymentCallback, MinBalanceCallback, TranscriptionCompleteCallback, InboundSmsCallback, JSFailCallback, CallHistoryReportCallback).

## Accounts (15 methods)

Account lifecycle, plans, billing info. Key methods:
- GetAccountInfo (`return_live_balance?`) → AccountInfoType + `api_address` (per-account API host). SetAccountInfo edits profile incl. `callback_url` + `callback_salt` (webhook target for the *Callback structs), `send_js_error`, `store_inbound_sms`/`store_outbound_sms`.
- AddAccount / CloneAccount / SetChildAccountInfo / GetChildrenAccounts — child-account (reseller) management.
- Plans/pricing: ChangeAccountPlan, GetAccountPlans, GetAvailablePlans, GetResourcePrice, GetSubscriptionPrice, GetCurrencyRate (per-USD FX), GetMoneyAmountToCharge (recommended top-up).
- Verification (RU-focused): GetAccountDocuments (deprecated) → GetAccountVerifications.
- KALFA relevance: GetAccountInfo with return_live_balance is the programmatic way to watch the low prepaid balance (currently ~$2.88 gate); callback_url + MinBalanceCallback can push balance alerts into the existing Slack ops-alerting pipeline.

## Applications (4 methods)

AddApplication, DelApplication, GetApplications (`with_rules?`, `with_scenarios?`), SetApplicationInfo (`secure_record_storage?`).
- KALFA relevance: read-mostly; GetApplications with_rules/with_scenarios is a one-call snapshot of the app→rule→scenario wiring the StartScenarios flow depends on.

## Users (4 methods)

AddUser, DelUser, GetUsers (rich filters: ACD queue/skill, `with_queues`, `with_skills`, `return_live_balance`, order_by), SetUserInfo (`parent_accounting?` = bill to parent). Users are SDK/SIP endpoints inside an application — not needed for pure PSTN outbound.

## Secrets (5 methods) — application-scoped secret store

AddSecret (secret_name+secret_value per application), GetSecrets (list, values masked), GetSecretValue (explicit read-back), SetSecretInfo (rotate value/rename), DelSecret.
- KALFA relevance: HIGH. This is the platform-native place to hold the Groq API key (and any ElevenLabs key) instead of serving it via KALFA's ctx endpoint; VoxEngine scenarios can read app secrets, keeping keys out of script_custom_data (200-byte cap) and call history. Also the clean rotation path for the leaked Groq key noted in the Branch B status.

## RoleSystem (16 methods) — service accounts & API keys

- Keys: CreateKey (returns KeyInfo incl. `private_key` — shown once), GetKeys, UpdateKey, DeleteKey, SetKeyRoles/GetKeyRoles/RemoveKeyRoles. Roles reference: /docs/getting-started/basic-concepts/management-api#service-account-roles.
- Subusers (human operator logins): AddSubUser, GetSubUsers, SetSubUserInfo, DelSubUser, Set/Get/RemoveSubUserRoles (Owner-only).
- Roles catalog: GetRoles (filter by group), GetRoleGroups. role_id and role_name are mutually exclusive (error 449).
- Limits: 437 MAX_NUMBER_OF_KEYS_EXCEEDED, 438 MAX_NUMBER_OF_SUB_USERS_EXCEEDED, 435 INVALID_ROLE_SET.
- KALFA relevance: HIGH. Best practice = a dedicated key with least-privilege roles for the KALFA backend (StartScenarios needs scenario/rule execution rights; add CallsSMS only if SMS is ever used). The JWT built from this key is what src/lib/voximplant/client.ts signs.

## KeyValueStorage (5 methods) — app-scoped KV, shared with VoxEngine ApplicationStorage

SetKeyValueItem (key+value, `ttl?` seconds / `expires_at?` timestamp; keys unique per application), GetKeyValueItem, GetKeyValueItems (prefix pattern match), GetKeyValueKeys, DelKeyValueItem. Roles: Owner/Admin/Developer. Returns KeyValueItems {key, value, expires_at}.
- KALFA relevance: HIGH — this is the same storage VoxEngine reads/writes in-scenario. Pattern to beat the 200-byte script_custom_data cap: KALFA pre-writes the full guest/call context under a short key via SetKeyValueItem, passes only the key in script_custom_data, scenario fetches the rest (alternative to the ctx HTTP callback). TTL gives automatic cleanup per call. Value size limits are NOT stated on these pages (documented on the VoxEngine ApplicationStorage side).

## SMS (5 methods)

- SendSmsMessage: P2P between two numbers; source must be a Voximplant-purchased, SMS-capable number (is_sms_supported) with ControlSms enabled. Returns message_id + fragments_count.
- A2PSendSms: application-to-person, batch `dst_numbers` (`;`-separated); REQUIRES a SenderID installed via support. Returns SmsTransaction[] + FailedSms[] + fragments_count. Role CallsSMS.
- ControlSms enable/disable per number; GetSmsHistory / A2PGetSmsHistory (filters, `output` csv option).
- Inbound SMS arrive via InboundSmsCallback on the account callback_url.
- KALFA relevance: LOW-MEDIUM — KALFA already has ExtrA SMS + WhatsApp; Voximplant A2P to IL would need a SenderID via support. Could serve as an SMS fallback after failed calls, but per-message economics vs ExtrA unverified.

## Other in-scope sections (structural)

- AuthorizedIPs (4): Add/Del/Get/CheckAuthorizedAccountIP — IP allow/deny list for Management API access (limit error 323). Relevance: pin API access to the IONOS server IP for hardening.
- DialogflowCredentials (5): Add/Bind/Del/Get/SetDialogflowKey — Google Dialogflow service-account JSON per application. Not relevant (KALFA uses Groq bridge).
- Invoices (2): GetAccountInvoices (USD/EUR accounts), DownloadInvoice.
- PSTNBlacklist (4): Add/Del/Get/SetPstnBlackListItem — blocks INCOMING calls to purchased numbers (not an outbound DNC list; KALFA's DNC must stay app-side).
- PushCredentials (5): mobile push certs (APNS/FCM/Huawei) for SDK apps — not relevant.
- RecordStorages (1): GetRecordStorages — where call recordings land; relevant if AI-call recordings are kept.
- RegulationAddress (6): KYC address linking for regulated phone numbers (GetCountries/GetRegions/GetZIPCodes/GetAvailableRegulations/GetRegulationsAddress/LinkRegulationAddress) — matters only when buying an IL number.
- SIPRegistration (5): register platform as user on 3rd-party SIP servers (persistent/one-time) — not relevant.
- SIPWhiteList (4): allow inbound SIP-URI calls without auth from listed networks — not relevant.
- Skills (5): ACDv1 operator skills — deprecated in favor of SmartQueue; not relevant.
- SmartQueue (21): ACDv2 omnichannel queueing — SQ_AddQueue/SQ_SetQueueInfo (agent/task selection strategies, max queue size/wait), SQ_BindAgent/SQ_BindSkill(+unbind), SQ_GetAgents/Queues/Skills, agent custom-status mapping, and reporting (GetSmartQueueRealtimeMetrics 30-min window, GetSmartQueueDayHistory 2-day window, RequestSmartQueueHistory arbitrary range, GetSQState). Relevant only if KALFA ever adds human-agent handoff from AI calls.
- WABPhoneNumbers (4): Add/Delete/Get/SetWABPhoneNumberInfo — WhatsApp Business phone numbers bound to an application+rule with a `voice_password`. Interesting: Voximplant-side WhatsApp voice; KALFA's WhatsApp stack is Meta-direct, so not currently relevant.

## Errors (references.httpapi.errors)

458 numeric error constants (code → name → message). Highlights:
- 100 AUTHORIZATION_FAILED, 101 INVALID_ARGUMENTS, 103 UNKNOWN_COMMAND, 104 FORBIDDEN_COMMAND (role missing).
- 340 RATE_LIMIT_EXCEED — the Management API is rate limited; 515 SAME_OPERATION_LIMIT (identical op repeated too soon); 512 parameter-changes limit.
- JWT: 447/454/455/456 (format/TTL/issued-in-future/expired).
- RoleSystem: 433-441, 448-453; count limits 437/438.
- Resource limits: 108 apps, 109 users, 314 concurrent resource, 418/419 scenario counts, 411 contacts, 323 IPs, 373 PSTN blacklist.
- SMS: 14, 385 SENDING_SMS_ERROR, 386 SMS_DISABLED_FOR_NUMBER, 509 A2P_SMS_DISABLED, 528 NOT_SUPPORT_SMS, 470 invalid direction.
- KALFA relevance: the stuck-call reconciler and any StartScenarios wrapper should special-case 340/515 (retry with backoff) and 456 (re-mint JWT).

## KALFA relevance summary

1. Secrets API = platform-native home for the Groq/ElevenLabs keys; removes them from ctx-endpoint serving and enables rotation.
2. KeyValueStorage = clean workaround for the 200-byte script_custom_data cap (write context server-side, pass short key).
3. RoleSystem CreateKey with least-privilege roles = correct auth for src/lib/voximplant/client.ts; watch errors 454-456 for token hygiene.
4. GetAccountInfo(return_live_balance) + SetAccountInfo(callback_url) + MinBalanceCallback = balance monitoring for the $2.88 gate via Slack alerts.
5. AuthorizedIPs can pin Management API usage to the IONOS server.
6. PSTN blacklist is inbound-only — legal DNC for outbound AI calls must remain in KALFA (mark_dnc flow), not on-platform.
7. Rate-limit errors (340/515) matter for campaign-scale StartScenarios bursts.
8. SmartQueue only if human-agent escalation is ever added; Skills/ACDv1 is legacy — ignore.

## INVENTORY (every page in scope; * = fetched)

- *references.httpapi — Management API (root)
- *Accounts (folder): AddAccount, ChangeAccountPlan, CloneAccount, GetAccountDocuments, GetAccountInfo, GetAccountPlans, GetAccountVerifications, GetAvailablePlans, GetChildrenAccounts, GetCurrencyRate, GetMoneyAmountToCharge, GetResourcePrice, GetSubscriptionPrice, SetAccountInfo, SetChildAccountInfo
- *Applications (folder): AddApplication, DelApplication, GetApplications, SetApplicationInfo
- *AuthorizedIPs (folder): AddAuthorizedAccountIP, CheckAuthorizedAccountIP, DelAuthorizedAccountIP, GetAuthorizedAccountIPs
- *DialogflowCredentials (folder): AddDialogflowKey, BindDialogflowKeys, DelDialogflowKey, GetDialogflowKeys, SetDialogflowKey
- *Invoices (folder): DownloadInvoice, GetAccountInvoices
- *KeyValueStorage (folder): DelKeyValueItem, GetKeyValueItem, GetKeyValueItems, GetKeyValueKeys, SetKeyValueItem
- *PSTNBlacklist (folder): AddPstnBlackListItem, DelPstnBlackListItem, GetPstnBlackList, SetPstnBlackListItem
- *PushCredentials (folder): AddPushCredential, BindPushCredential, DelPushCredential, GetPushCredential, SetPushCredential
- *RecordStorages (folder): GetRecordStorages
- *RegulationAddress (folder): GetAvailableRegulations, GetCountries, GetRegions, GetRegulationsAddress, GetZIPCodes, LinkRegulationAddress
- *RoleSystem (folder): AddSubUser, CreateKey, DeleteKey, DelSubUser, GetKeyRoles, GetKeys, GetRoleGroups, GetRoles, GetSubUserRoles, GetSubUsers, RemoveKeyRoles, RemoveSubUserRoles, SetKeyRoles, SetSubUserInfo, SetSubUserRoles, UpdateKey
- *Secrets (folder): AddSecret, DelSecret, GetSecrets, GetSecretValue, SetSecretInfo
- *SIPRegistration (folder): BindSipRegistration, CreateSipRegistration, DeleteSipRegistration, GetSipRegistrations, UpdateSipRegistration
- *SIPWhiteList (folder): AddSipWhiteListItem, DelSipWhiteListItem, GetSipWhiteList, SetSipWhiteListItem
- *Skills (folder, ACDv1 legacy): AddSkill, BindSkill, DelSkill, GetSkills, SetSkillInfo
- *SmartQueue (folder): GetSmartQueueDayHistory, GetSmartQueueRealtimeMetrics, GetSQState, RequestSmartQueueHistory, SQ_AddQueue, SQ_AddSkill, SQ_BindAgent, SQ_BindSkill, SQ_DeleteAgentCustomStatusMapping, SQ_DelQueue, SQ_DelSkill, SQ_GetAgentCustomStatusMapping, SQ_GetAgents, SQ_GetQueues, SQ_GetSkills, SQ_SetAgentCustomStatusMapping, SQ_SetAgentInfo, SQ_SetQueueInfo, SQ_SetSkillInfo, SQ_UnbindAgent, SQ_UnbindSkill
- *SMS (folder): A2PGetSmsHistory, A2PSendSms, ControlSms, GetSmsHistory, SendSmsMessage
- *Structure (folder) — 199 api_struct pages (fetched: api_error, keyinfo, keyview, keyvalueitems, smstransaction; rest enumerated): a2pactivatedcallback, a2psmsdeliverycallback, a2psmshistorytype, accountcallback, accountcallbacks, accountdocumentstatusupdatedcallback, accountdocumentstype, accountdocumentuploadedcallback, accountdocumentverifiedcallback, accountinfotype, accountinvoice, accountisfrozencallback, accountisunfrozencallback, accountplanpackagetype, accountplantype, accountverificationdocument, accountverificationstype, accountverificationstypeagreements, accountverificationstypecredentials, accountverificationstypedefaultenduser, accountverificationtype, acdafterserviceoperatorstatetype, acdlock, acdlockedoperatorstatetype, acdoperatoraggregationgrouptype, acdoperatorcall, acdoperatorstatisticstype, acdoperatorstatusaggregationgrouptype, acdoperatorstatusstatisticsdetail, acdoperatorstatusstatisticstype, acdqueueoperatorinfotype, acdqueuestatetype, acdqueuestatisticsserviceleveltype, acdqueuestatisticstype, acdreadyoperatorstatetype, acdservicingcallstatetype, acdsessioneventinfotype, acdsessioninfotype, acdstatetype, acdstatisticscalls, acdstatisticsitemtype, acdwaitingcallstatetype, activatesuccessfulcallback, addsecretresult, api_error, applicationinfotype, attachedphoneinfotype, auditloginfotype, authorizedaccountiptype, bankcardbillinglimitinfotype, bankcarderrortype, bankcardtype, batchtaskcancellingcallback, billinglimitinfotype, billinglimitstype, calculatedcallhistorydatatype, calculatedtransactionhistorydatatype, calleridinfotype, callhistoryreportcallback, callinfotype, calllistdetailtype, calllisttype, callsessioninfotype, cardexpiredcallback, cardexpiresinmonthcallback, cardpaymentcallback, cardpaymentfailedcallback, certificateexpiredcallback, certificateinfotype, chargedphonetype, clonedaccounttype, clonedacdqueuetype, clonedacdskilltype, clonedadminroletype, clonedadminusertype, clonedapplicationtype, clonedruletype, clonedscenariotype, clonedusertype, commonreporttype, contactinfotype, dialogflowkey, dialogflowkeyinfo, exchangeratestype, expiredagreementcallback, expiredcertificatecallback, expiringagreementcallback, expiringcalleridcallback, expiringcertificatecallback, failedsms, getautochargeconfigresulttype, getmaxbankcardpaymentresulttype, getmoneyamounttochargeresult, getsecretvalueresult, getsqagentsresult, getsqqueuesresult, getsqskillsresult, historyreporttype, inboundsmscallback, inboundsmscallbackitem, invoiceperiod, invoicereceivedcallback, invoicespendingdetails, invoicetaxesdetails, invoicetotaldetails, jsfailcallback, keyinfo, keyvalueitems, keyvaluekeys, keyvaluepairs, keyview, minbalancecallback, multiplenumbersprice, newattachedphoneinfotype, newphoneinfotype, nextchargealertcallback, outboundtestphonenumberinfotype, phonenumberactivationstatuschangedcallback, phonenumberactivationstatuschangedcallbackitem, phonenumbercountrycategoryinfotype, phonenumbercountryinfotype, phonenumbercountryregioninfotype, phonenumbercountrystateinfotype, planpackagetype, plantype, pricegroup, pstnblacklistinfotype, pushcredentialcontent, pushcredentialinfo, queueinfotype, queueskills, queueusers, recordstorageinfotype, recordtype, regulationaddress, regulationaddressdocumentsrequestedcallback, regulationaddressuploadedcallback, regulationaddressverifiedcallback, regulationcountry, regulationregionrecord, renewedsubscriptionscallback, renewedsubscriptionscallbackitem, resetaccountpasswordrequestcallback, resourceparams, resourceprice, resourceusagetype, restoredagreementstatuscallback, robokassapaymentcallback, rolegroupview, roleview, ruleinfotype, scenarioinfotype, secretlistitem, shortaccountinfotype, sipregistrationfailcallback, sipregistrationisfailedcallbackitem, sipregistrationisrecoveredcallbackitem, sipregistrationrecoveredcallback, sipregistrationtype, sipwhitelistinfotype, skillinfotype, smartqueueagent_skill, smartqueuemetricsgroups, smartqueuemetricsgroupsvalues, smartqueuemetricsresult, smartqueuestate, smartqueuestate_agent, smartqueuestate_agent_status, smartqueuestate_agent_status_type, smartqueuestate_task, smartqueuetask_skill, smshistorytype, smstransaction, sqaddqueueresult, sqaddskillresult, sqagentbindingmodes, sqskillbindingmodes, sqtaskselectionstrategies, subscriptioncallbackdetails, subscriptioncallbackdetailsphonenumbers, subscriptioncallbackdetailssipregistrations, subscriptionisdetachedcallback, subscriptionisdetachedcallbackitem, subscriptionisfrozencallback, subscriptionisfrozencallbackitem, subscriptionstochargetype, subscriptiontemplatetype, subuserid, subuserview, transactionhistoryreportcallback, transactioninfotype, transcriptioncompletecallback, transcriptioncompletecallbackitem, unverifiedsubscriptiondetachedcallback, unverifiedsubscriptiondetachedcallbackitem, userinfotype, wabphoneinfotype, wiretransfercallback, zipcode
- *Users (folder): AddUser, DelUser, GetUsers, SetUserInfo
- *WABPhoneNumbers (folder): AddWABPhoneNumber, DeleteWABPhoneNumber, GetWABPhoneNumbers, SetWABPhoneNumberInfo
- *Errors (error_list): 458 error constants (code+name+message), full dump persisted at tool-results/be6tugb9p.txt
