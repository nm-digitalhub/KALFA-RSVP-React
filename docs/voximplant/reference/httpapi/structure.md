# Structure  (ref_folder)


## A2PActivatedCallback  (api_struct)

Received when A2P messages are activated. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `a2p_enabled` — Whether A2P messages are allowed


## A2PSmsDeliveryCallback  (api_struct)

The A2P SMS delivery status callback.

- `destination_numbers` — The destination number(s)

- `id` — The SMS delivery ID

- `source_number` — The source number

- `status` — The SMS delivery status


## A2PSmsHistoryType  (api_struct)

The [A2PGetSmsHistory](/docs/references/httpapi/sms#a2pgetsmshistory) function result.

- `cost` — The message cost

- `delivery_status` — Delivery status: QUEUED, DISPATCHED, ABORTED, REJECTED, DELIVERED, FAILED, EXPIRED, UNKNOWN

- `destination_number` — SMS destination number

- `error_message` — Error message (if any)

- `fragments` — Number of fragments the initial message is divided into

- `message_id` — Message ID

- `processing_date` — Date of message processing. The format is yyyy-MM-dd HH:mm:ss

- `source_number` — SMS source number

- `status_id` — The message status. The possible values are: 1 — Success, 2 — Error, 3 — Waiting

- `text` — Stored message text

- `transaction_id` — The transaction ID for this message


## AccountCallback  (api_struct)

The account callback. See the [AccountCallbacks](/docs/references/httpapi/structure/accountcallbacks) type.

- `a2p_sms_activated` — Received when A2P SMS are activated

- `account_document_status_updated` — Received when the verification status is updated

- `account_document_uploaded` — Deprecated. Please use the unified <b>account_document_status_updated</b> callback instead

- `account_document_verified` — Deprecated. Please use the unified <b>account_document_status_updated</b> callback instead

- `account_email` — The account email

- `account_first_name` — The first name

- `account_id` — The account ID

- `account_is_frozen` — Received when an account is frozen

- `account_is_unfrozen` — Received when an account is unfrozen

- `account_last_name` — The last name

- `account_name` — The account name

- `activate_successful` — Received when a new (not child) account is created

- `balance` — The account's money

- `batch_task_cancelling_completed` — Received when batch task cancelling has been completed

- `call_history_report` — Received when a call history report is ready

- `callback_id` — The callback ID (sequence)

- `card_expired` — Received when a card is expired

- `card_expires_in_month` — Received when one month is left for a card to be expired

- `card_payment` — Received when a bank card payment is made

- `card_payment_failed` — Received when a bank card payment is failed

- `certificate_expired` — Deprecated. Please use the <b>expired_certificates</b> and <b>expiring_certificates</b> callbacks instead

- `currency` — The currency code (USD, RUR, EUR, ...)

- `expired_agreement` — Received for the accounts for which the confirmation documents waiting period has already expired or expires today

- `expired_certificates` — Received for the accounts whose Apple VOIP certificates are expired

- `expiring_agreement` — Received for the accounts for which the confirmation documents waiting period expires in 20/15/10/5/1 day(s)

- `expiring_callerid` — Received when a caller ID is about to be expired

- `expiring_certificates` — Received for the accounts whose Apple VOIP certificates expire in 14 or fewer days

- `hash` — The security hash: hash = md5(account_salt + account_id + api_key + callback_id). Example: 50c5fe2290cd7409b37e673b8b05e495

- `invoice_received` — Received when a monthly invoice is sent

- `js_fail` — Received when <b>send_js_error</b> is set to true and a JS error occurs. See the 'send_js_error' parameter of the 'SetAccountInfo' function

- `language_code` — The notification language code (2 symbols, ISO639-1). Examples: en, ru

- `min_balance` — Received when the minimum balance is reached

- `next_charge_alert` — Received when a plan is to be renewed in 3 days, but there is not enough money

- `phone_number_activation_status_changed` — Received when a rented phone number changed its activation status

- `regulation_address_documents_requested` — Received when the verification status is changed to PENDING

- `regulation_address_uploaded` — Received when proof of address is uploaded

- `regulation_address_verified` — Received when proof of address is verified

- `renewed_subscriptions` — Received when subscriptions are renewed

- `reset_account_password_request` — Received when an account password reset is requested

- `restored_agreement_status` — Received when an expiration date of the confirmation documents waiting period is changed

- `robokassa_payment` — Received when a robokassa payment is made

- `sip_registration_fail` — Received when one or several SIP registrations are failed

- `sip_registration_recovered` — Received when one or several SIP registrations are recovered

- `sms_inbound` — Received when an incoming SMS is received

- `subscription_is_detached` — Received when a subscription is canceled

- `subscription_is_frozen` — Received when a subscription is frozen

- `transaction_history_report` — Received when a transaction history report is ready

- `transcription_complete` — Received when a transcription is saved

- `type` — The callback type

- `unverified_subscription_detached` — Received when an unverified subscription is canceled

- `wire_transfer` — Received when a wire transfer is made


## AccountCallbacks  (api_struct)

The account callbacks body. See <a href='/docs/guides/managementapi/callbacks'>this article</a> for details.

- `callbacks` — The account callback array


## AccountDocumentStatusUpdatedCallback  (api_struct)

Received when the verification status is updated. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `account_document_id` — Uploaded document ID

- `account_document_status` — Document verification status. The following values are possible: AWAITING_DOCUMENTS_UPLOADING, AWAITING_AGREEMENT_UPLOADING, AWAITING_VERIFICATION, WAITING_FOR_CONFIRMATION_DOCUMENTS, VERIFIED, REJECTED, WAITING_PERIOD_EXPIRED

- `comment` — Reviewer's comment

- `legal_status` — Status of the user in the context of entrepreneurial activity. Possible values are: 'INDIVIDUAL', 'ENTREPRENEUR', 'LEGAL_ENTITY'

- `previous_account_document_status` — Previous document verification status. The following values are possible: AWAITING_AGREEMENT_UPLOADING, AWAITING_VERIFICATION, WAITING_FOR_CONFIRMATION_DOCUMENTS, VERIFIED, REJECTED, WAITING_PERIOD_EXPIRED, AWAITING_DOCUMENTS_UPLOADING

- `update_time` — UTC time when the status is updated


## AccountDocumentsType  (api_struct)

The account documents with verification states

- `account_id` — The account ID

- `verifications` — The account verifications


## AccountDocumentUploadedCallback  (api_struct)

Deprecated. Please use the unified [AccountDocumentStatusUpdatedCallback](/docs/references/httpapi/structure/accountdocumentstatusupdatedcallback) callback instead.

- `account_document_id` — The uploaded document ID. See GetAccountDocuments

- `legal_status` — Status of the user in the context of entrepreneurial activity. Possible values are 'individual', 'entrepreneur', 'legal entity'

- `uploaded` — The UTC date of the document upload in the following format: YYYY-MM-DD HH::mm:ss

- `verification_name` — The verification name (type)


## AccountDocumentVerifiedCallback  (api_struct)

Deprecated. Please use the unified [AccountDocumentStatusUpdatedCallback](/docs/references/httpapi/structure/accountdocumentstatusupdatedcallback) callback instead.

- `account_document_id` — The uploaded document ID

- `account_document_status` — The document verification status. The following values are possible: AWAITING_AGREEMENT_UPLOADING, AWAITING_VERIFICATION, WAITING_FOR_CONFIRMATION_DOCUMENTS, VERIFIED, REJECTED, WAITING_PERIOD_EXPIRED, AWAITING_DOCUMENTS_UPLOADING

- `comment` — The reviewer's comment

- `legal_status` — Status of the user in the context of entrepreneurial activity. Possible values are 'individual', 'entrepreneur', 'legal entity'

- `uploaded` — The UTC date of the document upload in the following format: YYYY-MM-DD HH::mm:ss

- `verification_name` — The verification name (type)


## AccountInfoType  (api_struct)

The [GetAccountInfo](/docs/references/httpapi/accounts#getaccountinfo) function result.

- `a2p_sms_enabled` — Whether to activate one-way SMS

- `access_entries` — The allowed access entries (the API function names)

- `account_custom_data` — The custom data

- `account_email` — The account's email

- `account_first_name` — The first name

- `account_id` — The account's ID

- `account_last_name` — The last name

- `account_name` — The account's name

- `account_notifications` — Whether Voximplant notifications are required

- `active` — Whether the account is active

- `api_key` — The account API key. Use password or api_key authentication to show the api_key

- `balance` — The account's money

- `billing_address_address` — The office address

- `billing_address_country_code` — The billing address country code (2 symbols, ISO 3166-1 alpha-2). Examples: US, RU, GB

- `billing_address_name` — The company or businessman name

- `billing_address_phone` — The office phone number

- `billing_address_state` — The office state (US) or province (Canada), up to 100 characters. Examples: California, Illinois, British Columbia

- `billing_address_zip` — The office ZIP

- `billing_limits` — The payments limits applicable to each payment method

- `callback_salt` — If salt string is specified, each HTTP request made by the Voximplant cloud toward the <b>callback_url</b> has a <b>salt</b> field set to MD5 hash of account information and salt. That hash can be used be a developer to ensure that HTTP request is made by the Voximplant cloud

- `callback_url` — If URL is specified, Voximplant cloud makes HTTP POST requests to it when something happens. For a full list of reasons see the <b>type</b> field of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure. The HTTP request has a JSON-encoded body that conforms to the [AccountCallbacks](/docs/references/httpapi/structure/accountcallbacks) structure

- `created` — The UTC account created time in 24-h format: YYYY-MM-DD HH:mm:ss

- `credit_limit` — The account's credit limit

- `currency` — The currency code (USD, RUR, EUR, ...)

- `frozen` — Whether account is blocked by Voximplant admins

- `language_code` — The notification language code (2 symbols, ISO639-1). Examples: en, ru

- `location` — The account location (timezone). Examples: America/Los_Angeles, Etc/GMT-8, Etc/GMT+10

- `min_balance_to_notify` — The minimum balance value to notify by email or SMS

- `news_notifications` — Whether Voximplant news notifications are required

- `send_js_error` — Whether to send an email when a JS error occurs

- `support_bank_card` — Whether Bank card payments are allowed

- `support_invoice` — Whether Bank invoices are allowed

- `support_robokassa` — Whether Robokassa payments are allowed

- `tariff_changing_notifications` — Whether Voximplant plan changing notifications are required

- `with_access_entries` — Whether the admin user permissions are granted


## AccountInvoice  (api_struct)

GetAccountInvoices function result.

- `amount` — Info on all money spent in the invoice

- `invoice_date` — Date when the invoice is created in the following format: YYYY-MM-DD

- `invoice_id` — Invoice id

- `invoice_number` — Unique invoice number

- `period` — Invoice period

- `rows` — Detailed info on each spending

- `status` — Invoice status


## AccountIsFrozenCallback  (api_struct)

Received when an account is frozen. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## AccountIsUnfrozenCallback  (api_struct)

Received when an account is unfrozen. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## AccountPlanPackageType  (api_struct)

The account plan package info.

- `may_overrun` — Whether overrun is enabled

- `orig_package_size` — The original package size (excluding overrun)

- `overrun_price` — The overrun amount

- `overrun_resources` — The number of resources (e.g., messages) per overrun

- `package_name` — The package name

- `package_size` — The current package size (including overrun)

- `price_group_id` — The price group IDs

- `resource_left` — The resource left in the package


## AccountPlanType  (api_struct)

The [GetAccountPlans](/docs/references/httpapi/accounts#getaccountplans) function result item.

- `next_charge` — The next charge date, format: YYYY-MM-DD

- `packages` — The account plan package array

- `periodic_charge` — The plan monthly charge

- `plan_name` — The plan name

- `plan_subscription_template_id` — The current plan ID

- `plan_type` — The plan type. The possible values are IM, MAU


## AccountVerificationDocument  (api_struct)

The account verification document info. The [AccountVerificationType](/docs/references/httpapi/structure/accountverificationtype) field.

- `account_document_id` — The account verification document ID

- `account_document_status` — The account document status. The following values are possible: ACCEPTED, REJECTED, IN_PROGRESS, INCOMPLETE_SET

- `comment` — The reviewer's comment

- `is_individual` — Whether the account belongs to an individual

- `uploaded` — The UTC date of the document upload in the following format: YYYY-MM-DD HH::mm:ss


## AccountVerificationsType  (api_struct)

Account verifications.

- `agreements` — Agreements list

- `comments` — Comments for the customer in case of verification rejection

- `created` — Date created in the following format: 2022-07-12 07:06:05

- `creation_type` — Verification creation type. Possible values are: MANUAL, GOSUSLUGI, TRANSFER_RIGHTS

- `credentials` — Person or company who takes the verification

- `default_end_user` — Verification's default customer

- `status` — Verification status. Possible values are: AWAITING_DOCUMENTS_UPLOADING, AWAITING_AGREEMENT_UPLOADING, AWAITING_VERIFICATION, WAITING_FOR_CONFIRMATION_DOCUMENTS, VERIFIED, REJECTED, WAITING_PERIOD_EXPIRED

- `status_scheme` — Status scheme name

- `verification_id` — Verification ID


## AccountVerificationsTypeAgreements  (api_struct)

Agreements list.

- `agreement_date` — Agreement signing date

- `agreement_id` — Agreement ID

- `agreement_number` — Agreement number

- `comments` — Comments for the customer in case of agreement rejection

- `signing_type` — Agreement signing date. Possible values are: MANUAL, ESIGNATURE

- `status` — Agreement status. Possible values are: NEW, IN_PROCESS, VERIFIED, REJECTED

- `type` — Agreement type


## AccountVerificationsTypeCredentials  (api_struct)

Person or company who takes the verification.

- `entrepreneur` — Company details for a individual entrepreneur

- `individual` — Details of a person who takes the verification

- `legal_entity` — Company details for a legal entity

- `legal_status` — Subscriber type. Possible values are: INDIVIDUAL, LEGAL_ENTITY, ENTREPRENEUR


## AccountVerificationsTypeDefaultEndUser  (api_struct)

Verification's default customer.

- `credentials` — Customer's data

- `end_user_uuid` — Customer's UUID


## AccountVerificationType  (api_struct)

The account verification info. The [AccountVerificationsType](/docs/references/httpapi/structure/accountverificationstype) field.

- `documents` — The uploaded documents

- `unverified_hold_until` — Unverified subscriptions hold until the date in the following format: YYYY-MM-DD (if the account verification is required). Some subscriptions are detached on that day automatically!

- `verification_name` — The verification name

- `verification_status` — The account verification status. The following values are possible: REQUIRED, IN_PROGRESS, VERIFIED, NOT_REQUIRED


## ACDAfterServiceOperatorStateType  (api_struct)

The after service operator state.

- `status` — The operator <a href='/docs/references/websdk/voximplant/operatoracdstatuses'>status string</a>

- `user_display_name` — The display user name of the operator

- `user_id` — The user ID of the operator

- `user_name` — The user name of the operator


## ACDLock  (api_struct)

The [ACD](/docs/references/voxengine/voxengine/enqueueacdrequest) lock type.

- `created` — The UTC lock created time in 24-h format: YYYY-MM-DD HH:mm:ss

- `id` — The ACD lock ID


## ACDLockedOperatorStateType  (api_struct)

The locked operator state.

- `acd_calls` — The ACD operator calls

- `locks` — The operator locks

- `status` — The operator <a href='/docs/references/websdk/voximplant/operatoracdstatuses'>status string</a>. 'BANNED' string indicates temporarily <a href='/docs/guides/smartqueue/acdv1'>banned operators</a>. The following values are possible: READY, BANNED

- `unreached` — The UTC time when the operator becomes unavailable in 24-h format: YYYY-MM-DD HH:mm:ss

- `user_display_name` — The display user name of the operator

- `user_id` — The user ID of the operator

- `user_name` — The user name of the operator


## ACDOperatorAggregationGroupType  (api_struct)

The [GetACDOperatorStatistics](/docs/references/httpapi/queues#getacdoperatorstatistics) function result item.

- `date` — If aggregation is enabled, contains UTC date for the results in 24-h 'YYYY-MM-DD' format

- `hour` — If aggregation is enabled, contains the 60-minute interval number from 1 to 24

- `statistics` — List of records grouped by date or user ID according to the 'group' method call argument

- `user_id` — If aggregation is enabled, contains user ID for the results


## ACDOperatorCall  (api_struct)

The ACD operator call type.

- `acd_queue_id` — The ACD queue ID

- `acd_queue_name` — The ACD queue name

- `acd_request_id` — The internal ACD session history ID

- `acd_session_history_id` — The ACD session history ID of the request

- `begin_time` — The begin time of the request in 24-h format: YYYY-MM-DD HH:mm:ss

- `callerid` — The client callerid

- `submitted` — The submission time of the request in 24-h format: YYYY-MM-DD HH:mm:ss


## ACDOperatorStatisticsType  (api_struct)

Individual record in the [ACDOperatorAggregationGroupType](/docs/references/httpapi/structure/acdoperatoraggregationgrouptype) group.

- `AC` — Number of answered calls. Name is 'AnsweredCalls' if 'abbreviation' is set to 'false'

- `ACW` — Time between operator ended a call and changed status to a one different from the 'AFTER_SERVICE'. This time is tracked only if operator changed status to 'AFTER_SERVICE' after the call. Name is 'AfterCallWork' if 'abbreviation' is set to 'false'

- `date` — If aggregation is enabled, contains UTC date for the results in 24-h 'YYYY-MM-DD' format

- `hour` — If aggregation is enabled, contains the 60-minute interval number from 1 to 24

- `HT` — Sum of 'TalkTime' and 'AfterCallWork'. Name is 'HandlingTime' if 'abbreviation' is set to 'false'

- `SA` — Delay between a call started to ring and operator answered it. Name is 'SpeedOfAnswer' if 'abbreviation' is set to 'false'

- `TACW` — Sum of 'AfterCallWork', in seconds. Name is 'TotalAfterCallWork' if 'abbreviation' is set to 'false'

- `TDT` — Sum of delays between calls started to ring and operator answered them, in seconds. Name is 'TotalDialingTime' if 'abbreviation' is set to 'false'

- `THT` — Sum of 'HandlingTime', in seconds. Name is 'TotalHandlingTime' if 'abbreviation' is set to 'false'

- `TT` — Time between operator answering and ending a call. Name is 'TalkTime' if 'abbreviation' is set to 'false'

- `TTT` — Sum of 'TalkTime', in seconds. Name is 'TotalTalkTime' if 'abbreviation' is set to 'false'

- `UAC` — Number of unanswered calls. Name is 'UnansweredCalls' if 'abbreviation' is set to 'false'

- `user_id` — If aggregation is enabled, contains user ID for the results


## ACDOperatorStatusAggregationGroupType  (api_struct)

The [GetACDOperatorStatusStatistics](/docs/references/httpapi/queues#getacdoperatorstatusstatistics) function result item.

- `date` — If aggregation is enabled, contains UTC date for the results in 24-h 'YYYY-MM-DD' format

- `hour` — If aggregation is enabled, contains the 60-minute interval number from 1 to 24

- `statistics` — List of records grouped by date or user ID according to the 'group' method call argument

- `user_id` — If aggregation is enabled, contains user ID for the results


## ACDOperatorStatusStatisticsDetail  (api_struct)

Individual record in [ACDOperatorStatusStatisticsType](/docs/references/httpapi/structure/acdoperatorstatusstatisticstype).

- `AFTER_SERVICE` — The AFTER_SERVICE status statistics

- `BANNED` — The BANNED status statistics

- `DND` — The DND status statistics

- `IN_SERVICE` — The IN_SERVICE status statistics

- `OFFLINE` — The OFFLINE status statistics

- `ONLINE` — The ONLINE status statistics

- `READY` — The READY status statistics

- `TIMEOUT` — The TIMEOUT status statistics


## ACDOperatorStatusStatisticsType  (api_struct)

Individual record in the  [ACDOperatorStatusAggregationGroupType](/docs/references/httpapi/structure/acdoperatorstatusaggregationgrouptype) group.

- `acd_status` — The user statistics

- `date` — If aggregation is enabled, contains UTC date for the results in 24-h 'YYYY-MM-DD' format

- `hour` — If aggregation is enabled, contains the 60-minute interval number from 1 to 24

- `user_id` — If aggregation is enabled, contains user ID for the results


## ACDQueueOperatorInfoType  (api_struct)

The 'acd_queues' element of the [GetUsers](/docs/references/httpapi/users#getusers) function result.

- `acd_queue_id` — The ACD queue ID

- `acd_queue_name` — The ACD queue name

- `auto_link` — Whether the user is bound to the ACD queue in manual mode if false


## ACDQueueStateType  (api_struct)

The ACD queue state.

- `acd_queue_id` — The ACD queue ID

- `after_service_operator_count` — Number of operators with the 'AFTER SERVICE' state

- `after_service_operators` — List of operators with the 'AFTER_SERVICE' state. This state is set right after a call is ended to indicate a call postprocessing

- `locked_operators` — List of operators with the 'READY' state that cannot accept a call from this queue. Operator cannot accept a call if they are temporarily banned, or they are servicing a call right now

- `locked_operators_count` — Number of locked operators

- `ready_operators` — List of operators with the 'READY' state that can accept a call from this queue

- `ready_operators_count` — Number of ready operators

- `servicing_calls` — List of calls enqueued into this queue that are being serviced right now by operators

- `waiting_calls` — List of calls enqueued into this queue that are not yet serviced by operators


## ACDQueueStatisticsServiceLevelType  (api_struct)

Individual service level description used in the [ACDQueueStatisticsType](/docs/references/httpapi/structure/acdqueuestatisticstype).

- `acceptable_waiting_time` — Maximum time, is seconds, user is waiting operator for a given service level

- `call_count` — Number of calls for a given service level

- `service_level` — Percentage of calls for a given service level, from 0 (non-inclusive) up to 1 (all calls)


## ACDQueueStatisticsType  (api_struct)

Individual record in the [ACDOperatorAggregationGroupType](/docs/references/httpapi/structure/acdoperatoraggregationgrouptype) group.

- `AC` — Number of answered calls. Name is 'AnsweredCalls' if 'abbreviation' is set to 'false'

- `ACW` — Time between operator ended a call and changed status to a one different from the 'AFTER_SERVICE'. This time is tracked only if operator changed status to 'AFTER_SERVICE' after the call. Name is 'AfterCallWork' if 'abbreviation' is set to 'false'

- `AT` — Time between user called Voximplant cloud and time they disconnect not reaching the operator. Name is 'AbandonmentTime' if 'abbreviation' is set to 'false'

- `date` — If aggregation is enabled, contains UTC date for the results in 24-h 'YYYY-MM-DD' format

- `hour` — If aggregation is enabled, contains the 60-minute interval number from 1 to 24

- `HT` — Sum of 'TalkTime' and 'AfterCallWork'. Name is 'HandlingTime' if 'abbreviation' is set to 'false'

- `QL` — How many users are in the queue. Name is 'QueueLength' if 'abbreviation' is set to 'false'

- `RC` — Number of calls rejected by the ACD. Call is rejected if all operators are offline or banned, or queue length is exceeded, or predicted answer time exceeds maximum specified for the query. Name is 'RejectedCalls' if 'abbreviation' is set to 'false'

- `SA` — Delay between a call started to ring and operator answered it. Name is 'SpeedOfAnswer' if 'abbreviation' is set to 'false'

- `SL` — List of service levels. Name is 'ServiceLevel' if 'abbreviation' is set to 'false'

- `TACW` — Sum of 'AfterCallWork', in seconds. Name is 'TotalAfterCallWork' if 'abbreviation' is set to 'false'

- `TAT` — Sum for all times between user called Voximplant cloud and time they disconnect not reaching the operator, in seconds. Name is 'TotalAbandonmentTime' if 'abbreviation' is set to 'false'

- `TC` — Total number of calls. Name is 'TotalCalls' if 'abbreviation' is set to 'false'

- `THT` — Sum of 'HandlingTime', in seconds. Name is 'TotalHandlingTime' if 'abbreviation' is set to 'false'

- `TST` — Sum of 'SpeedOfAnswer', in seconds. Name is 'TotalSubmissionTime' if 'abbreviation' is set to 'false'

- `TT` — Time between operator answering and ending a call. Name is 'TalkTime' if 'abbreviation' is set to 'false'

- `TTT` — Sum of 'TalkTime', in seconds. Name is 'TotalTalkTime' if 'abbreviation' is set to 'false'

- `TWT` — Sum of 'WaitingTime', in seconds. Name is 'TotalWaitingTime' if 'abbreviation' is set to 'false'

- `UAC` — Number of unanswered calls. Name is 'UnansweredCalls' if 'abbreviation' is set to 'false'

- `WT` — Delay between user called and operator answered the call (or call is terminated). Name is 'WaitingTime' if 'abbreviation' is set to 'false'


## ACDReadyOperatorStateType  (api_struct)

The ready operator state.

- `idle_duration` — The idle duration in seconds. The minimum of the duration after the last hangup and the duration after the operator status changing to READY

- `user_display_name` — The display user name of the operator

- `user_id` — The user ID of the operator

- `user_name` — The user name of the operator


## ACDServicingCallStateType  (api_struct)

The servicing call state.

- `acd_session_history_id` — The ACD session history ID of the request

- `begin_time` — The begin time of the request in 24-h format: YYYY-MM-DD HH:mm:ss

- `callerid` — The client callerid

- `priority` — The request priority

- `user_display_name` — The display user name of the operator

- `user_id` — The user ID of the operator

- `user_name` — The user name of the operator

- `waiting_time` — The waiting time before servicing in seconds


## ACDSessionEventInfoType  (api_struct)

The ACD session event info.

- `acd_session_event_id` — The ACD session event ID

- `custom_data` — The custom data

- `time` — The UTC start date in 24-h format: YYYY-MM-DD HH:mm:ss

- `type` — The event type name

- `user_id` — The user ID


## ACDSessionInfoType  (api_struct)

The [GetACDHistory](/docs/references/httpapi/history#getacdhistory) function result item.

- `account_id` — The account ID

- `acd_queue_id` — The ACD queue ID

- `acd_request_id` — The ACD request ID. See the [ACDRequest.id()](/docs/references/voxengine/acd/acdrequest#id) VoxEngine method

- `acd_session_history_id` — The ACD session history ID

- `after_service_duration` — The after service duration in seconds

- `begin_time` — The UTC start date in 24-h format: YYYY-MM-DD HH:mm:ss

- `events` — The bound events

- `in_service_duration` — The conversation duration in seconds

- `priority` — The request priority

- `user_id` — The user ID

- `waiting_duration` — The waiting duration in seconds


## ACDStateType  (api_struct)

The [GetACDState](/docs/references/httpapi/queues#getacdstate) function result item.

- `acd_queues` — The queues' states


## ACDStatisticsCalls  (api_struct)

Individual statistics item in the [ACDQueueStatisticsType](/docs/references/httpapi/structure/acdqueuestatisticstype) record.

- `count` — Absolute number of calls

- `percent` — Percentage of answered/rejected/unanswered calls, is counted against total number of calls


## ACDStatisticsItemType  (api_struct)

Individual statistics item in the [ACDOperatorStatisticsType](/docs/references/httpapi/structure/acdoperatorstatisticstype), [ACDQueueStatisticsType](/docs/references/httpapi/structure/acdqueuestatisticstype), and [ACDOperatorStatusStatisticsDetail](/docs/references/httpapi/structure/acdoperatorstatusstatisticsdetail) records.

- `avg` — Average value over the aggregated interval, in seconds

- `count` — Number of samples over the aggregated interval

- `max` — Maximum value over the aggregated interval, in seconds

- `min` — Minimum value over the aggregated interval, in seconds

- `sum` — Sum of all samples over the aggregated interval, in seconds


## ACDWaitingCallStateType  (api_struct)

The waiting call state.

- `acd_session_history_id` — The ACD session history ID of the request

- `begin_time` — The begin time of the request in 24-h format: YYYY-MM-DD HH:mm:ss

- `callerid` — The client callerid

- `minutes_to_submit` — The predicted minutes left to start servicing

- `priority` — The request priority

- `user_display_name` — The display user name of the operator

- `user_id` — The user ID of the operator to try to service the request

- `user_name` — The user name of the operator

- `waiting_time` — The waiting time in seconds


## ActivateSuccessfulCallback  (api_struct)

Received when a new (not child) account is created. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## AddSecretResult  (api_struct)

The [AddSecret](/docs/references/httpapi/secrets#addsecret) function result

- `secret_id` — Added secret ID


## API_Error  (api_struct)

The API error.

- `code` — The error code

- `msg` — The error description


## ApplicationInfoType  (api_struct)

The [GetApplications](/docs/references/httpapi/applications#getapplications) function result.

- `application_id` — The application ID

- `application_name` — The full application name

- `modified` — The application editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `secure_record_storage` — Whether a secure storage for logs and records is enabled


## AttachedPhoneInfoType  (api_struct)

The [GetPhoneNumbers](/docs/references/httpapi/phonenumbers#getphonenumbers) function result.

- `activation_status` — Phone number activation status

- `application_id` — ID of the bound application

- `application_name` — Name of the bound application

- `auto_charge` — Whether to charge automatically

- `can_be_used` — Whether a not verified account can use the phone

- `canceled` — Whether the subscription is cancelled

- `category_name` — The phone category name (MOBILE, GEOGRAPHIC, TOLLFREE, MOSCOW495)

- `deactivated` — Whether the subscription is frozen

- `emergency_calls_enabled` — Whether calls to emergency numbers are enabled

- `emergency_calls_to_be_enabled` — Whether you need to make a request to enable calls to emergency numbers

- `extended_application_name` — Full application name, e.g. myapp.myaccount.n1.voximplant.com

- `incoming_sms_callback_url` — If set, the callback of an incoming SMS is sent to this url, otherwise, it is sent to the general account URL

- `is_sms_enabled` — Whether SMS sending and receiving is enabled for this phone number via the [ControlSms](/docs/references/httpapi/sms#controlsms) Management API

- `is_sms_supported` — Whether SMS is supported for this phone number. SMS needs to be explicitly enabled via the [ControlSms](/docs/references/httpapi/sms#controlsms) Management API before sending or receiving SMS. If SMS is supported and enabled, SMS can be sent from this phone number via the [SendSmsMessage](/docs/references/httpapi/sms#sendsmsmessage) Management API and received via the [InboundSmsCallback](/docs/references/httpapi/structure/inboundsmscallback) property of the HTTP callback. See <a href='/docs/guides/managementapi/callbacks'>this article</a> for HTTP callback details

- `modified` — UTC date of an event associated with the number in 24-h format: YYYY-MM-DD HH:mm:ss

- `phone_country_code` — The phone country code (2 symbols)

- `phone_id` — The phone ID

- `phone_next_renewal` — The next renewal date in the following format: YYYY-MM-DD

- `phone_number` — The phone number

- `phone_price` — The phone monthly charge in the account's currency

- `phone_purchase_date` — The purchase date in 24-h format: YYYY-MM-DD HH:mm:ss

- `phone_region_name` — Phone region name

- `required_verification` — Whether the verification is required for the account

- `rule_id` — ID of the bound rule

- `rule_name` — Name of the bound rule

- `subscription_id` — Phone number subscription ID

- `unverified_hold_until` — Unverified phone hold until the date in the following format: YYYY-MM-DD (if the account verification is required). The number is detached on that day automatically!

- `verification_status` — The account verification status. The following values are possible: REQUIRED, IN_PROGRESS, VERIFIED


## AuditLogInfoType  (api_struct)

The [GetAuditLog](/docs/references/httpapi/history#getauditlog) function result item.

- `account_id` — The account ID

- `audit_log_id` — The audit log ID

- `cmd_args` — The arguments of the called function (they may be masked or resolved)

- `cmd_name` — The called function

- `cmd_result` — The modified values

- `ip` — The initiator IP address

- `requested` — The action time in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `subuser_id` — The subuser's ID

- `subuser_name` — The subuser's name


## AuthorizedAccountIPType  (api_struct)

The [GetAuthorizedAccountIPs](/docs/references/httpapi/authorizedips#getauthorizedaccountips) function result.

- `allowed` — Whether the IP is allowed (true - whitelist, false - blacklist)

- `authorized_ip` — The authorized IP4 or network

- `created` — The item creating UTC date in 24-h format: YYYY-MM-DD HH:mm:ss


## BankCardBillingLimitInfoType  (api_struct)

The payment limit info.

- `currency` — The currency

- `min_amount` — The minimum amount


## BankCardErrorType  (api_struct)

The bank card error info.

- `amount` — The amount in the payment currency

- `currency` — The payment currency

- `date` — The error date in 24-h format: YYYY-MM-DD HH:mm:ss

- `msg` — The error message


## BankCardType  (api_struct)

The bank card info.

- `acct` — The last card number digits

- `auto_charge` — Whether the auto_charge is enabled

- `bank_card_provider` — The payment system. The possible values are ALFABANK, BRAINTREE

- `card_holder` — The cardholder’s first name and last name

- `card_overrun_value` — The card overrun value in the account currency

- `card_type` — The card's payment system. The possible values are VISA, MASTER CARD

- `expiration_month` — The card expiration month

- `expiration_year` — The card expiration year

- `last_error` — The last card error

- `min_balance ` — The minimum account balance to trigger the auto charging


## BatchTaskCancellingCallback  (api_struct)

Received when batch task cancelling has been completed

- `batch_id` — Batch UUID of the cancelled tasks

- `cancelled_tasks_number` — Number of cancelled tasks


## BillingLimitInfoType  (api_struct)

The payment limit info.

- `currency` — The currency

- `min_amount` — The minimum amount


## BillingLimitsType  (api_struct)

The payments limits applicable to each payment method. Payments that are beyond limits are declined.

- `bank_card` — The bank card limits

- `invoice` — The invoice limits

- `robokassa` — The Robokassa limits


## CalculatedCallHistoryDataType  (api_struct)

The [HistoryReportType](/docs/references/httpapi/structure/historyreporttype) calculated_data object if the [HistoryReportType](/docs/references/httpapi/structure/historyreporttype) history_type parameter is set to 'calls'.

- `session_count` — The number of sessions in the report

- `timezone` — The selected timezone

- `total_session_count` — The total found filtered session count


## CalculatedTransactionHistoryDataType  (api_struct)

The [HistoryReportType](/docs/references/httpapi/structure/historyreporttype) calculated_data object if the [HistoryReportType](/docs/references/httpapi/structure/historyreporttype) history_type parameter is set to 'transactions'.

- `account_id` — The account ID

- `end_balance` — The end account/user balance with currency. Example: 12.5 RUR

- `start_balance` — The start account/user balance with currency. Example: 2.3 USD

- `timezone` — The selected timezone

- `total_transaction_count` — The total found filtered transaction count

- `transaction_count` — The number of transactions in the report

- `user_id` — The user ID

- `user_name` — The user name


## CallerIDInfoType  (api_struct)

The [GetCallerIDs](/docs/references/httpapi/callerids#getcallerids) function result.

- `active` — Whether active

- `callerid_id` — The callerID id

- `callerid_number` — The callerID number

- `code_entering_attempts_left` — The code entering attempts left for the unverified callerID

- `verification_call_attempts_left` — The verification call attempts left for the unverified callerID

- `verified_until` — The verification ending date in the following format: YYYY-MM-DD (for the verified callerID)


## CallHistoryReportCallback  (api_struct)

Received when a call history report is ready. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `history_report_id` — The history report ID

- `order_date` — The UTC order date in the following format: YYYY-MM-DD HH::mm:ss

- `success` — Whether the request is successful


## CallInfoType  (api_struct)

The call info.

- `call_id` — Call's history ID

- `cost` — Call's cost

- `custom_data` — Custom data passed to the JS session

- `diversion_number` — Call forwarding number

- `duration` — Call duration in seconds

- `end_reason` — End reason code and description

- `incoming` — Whether the call is incoming

- `local_number` — Local number on the platform side

- `media_server_address` — Media server's IP address

- `record_url` — Record URL

- `remote_number` — Remote number on the client side

- `remote_number_type` — Type of the remote number, e.g., a PSTN, mobile, user or sip address

- `start_time` — Call start time in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `successful` — Whether the call is successful

- `transaction_id` — Transaction ID


## CallListDetailType  (api_struct)

Detailing job telephone calls.

- `attempts_left` — Number of remaining attempts

- `call_schedule` — Call list schedule in the JSON format. Refer to the <a href="/docs/guides/solutions/call-lists">Call lists guide</a> for more information.

- `custom_data` — Data for transmission to the script

- `finish_execution_time` — Time after which the task cannot be performed in 24-h format: HH:mm:ss

- `last_attempt` — Date and time of the last attempt to perform a task

- `list_id` — The list ID

- `result_data` — Results of the task, if it is granted, or information about the runtime error

- `start_execution_time` — Time with which to start the job in 24-h format: HH:mm:ss

- `status` — The status name. The possible values are __New__ (status_id = 0), __In progress__ (status_id = 1), __Processed__ (status_id = 2), __Error__ (status_id = 3), __Canceled__ (status_id = 4)

- `status_id` — The status ID. The possible values are __0__ (status = New), __1__ (status = In progress), __2__ (status = Processed), __3__ (status = Error), __4__ (status = Canceled)

- `task_id` — The call list task ID

- `task_uuid` — The call list task UUID


## CallListType  (api_struct)

Information about call list's configurations.

- `dt_complete` — The completion date in 24-h format: YYYY-MM-DD HH:mm:ss

- `dt_submit` — The date of submitted the list in 24-h format: YYYY-MM-DD HH:mm:ss

- `interval_seconds` — The interval between attempts in seconds

- `list_id` — The list ID

- `list_name` — The list name

- `max_simultaneous` — The maximum number of simultaneous tasks

- `num_attempts` — The number of task attempts run, which failed to call

- `priority` — The priority of the call list

- `rule_id` — The rule id

- `status` — The status name. The possible values are __In progress__, __Completed__, __Canceled__

- `task_priority_strategy` — Whether the first or repeated calls have priority.


## CallSessionInfoType  (api_struct)

The [GetCallHistory](/docs/references/httpapi/history#getcallhistory) function result item.

- `account_id` — Account ID that initiates the JS session

- `application_id` — Application ID that initiates the JS session

- `application_name` — Application name

- `audio_quality` — Call's audio quality. The possible values are: Standard | HD | Ultra HD.

- `call_session_history_id` — Unique JS session identifier

- `calls` — Calls within the JS session, including durations, cost, phone numbers and other information

- `custom_data` — Custom data

- `duration` — Entire JS session duration in seconds. The session can contain multiple calls

- `finish_reason` — Finish reason. Possible values are __Normal termination__, __Insufficient funds__, __Internal error (billing timeout)__, __Terminated administratively__, __JS session error__, __Timeout__

- `initiator_address` — Initiator's IP address

- `log_file_url` — Link to the session log. The log retention policy is 1 month, after that time this field clears. If you have issues accessing the log file, check if the application has "Secure storage of applications and logs" feature enabled. In this case, you need to <a href='/docs/guides/managementapi/secureobjects'>authorize</a>.

- `media_server_address` — Media server IP address

- `other_resource_usage` — Used resources

- `records` — Bound records

- `rule_name` — Routing rule name

- `start_date` — Start date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `user_id` — User ID that initiates the JS session


## CardExpiredCallback  (api_struct)

Received when a card is expired. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## CardExpiresInMonthCallback  (api_struct)

Received when one month is left for a card to be expired. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## CardPaymentCallback  (api_struct)

Received when a bank card payment is made. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `amount` — The amount in the account currency

- `transaction_id` — The transaction ID

- `transaction_type` — The transaction type


## CardPaymentFailedCallback  (api_struct)

Received when a bank card payment is failed. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## CertificateExpiredCallback  (api_struct)

Deprecated. Please use the <b>expired_certificates</b> and <b>expiring_certificates</b> callbacks instead.


## CertificateInfoType  (api_struct)

The [ExpiredCertificateCallback](/docs/references/httpapi/structure/expiredcertificatecallback) and [ExpiringCertificateCallback](/docs/references/httpapi/structure/expiringcertificatecallback) callbacks details.

- `applications` — Array of application names

- `cert_file_name` — The push certificate file name

- `expiration_date` — The push certificate expiration date in YYYY-MM-DD format

- `push_credential_id` — The push credential id


## ChargedPhoneType  (api_struct)

The charged phone info.

- `deactivated` — Whether the subscription is frozen

- `is_charged` — Whether the phone number has been charged

- `phone_id` — The phone ID

- `phone_number` — The phone number


## ClonedAccountType  (api_struct)

The cloned account info.

- `account_email` — The account's email

- `account_id` — The account's ID

- `account_name` — The account's name

- `acd_queues` — The cloned ACD queues

- `acd_skills` — The cloned ACD skills

- `active` — Whether the account is active

- `admin_roles` — The cloned admin roles

- `admin_users` — The cloned admin users

- `api_key` — The account API key

- `applications` — The cloned applications

- `scenarios` — The cloned scenarios

- `users` — The cloned users


## ClonedACDQueueType  (api_struct)

The cloned ACD queue info.

- `acd_queue_id` — The ACD queue ID

- `acd_queue_name` — The ACD queue name


## ClonedACDSkillType  (api_struct)

The cloned ACD skill info.

- `skill_id` — The ACD skill ID

- `skill_name` — The ACD skill name


## ClonedAdminRoleType  (api_struct)

The cloned admin role info.

- `admin_role_id` — The admin role ID

- `admin_role_name` — The admin role name


## ClonedAdminUserType  (api_struct)

The cloned admin user info.

- `admin_user_api_key` — The API key of the admin user

- `admin_user_id` — The admin user ID

- `admin_user_name` — The admin user name


## ClonedApplicationType  (api_struct)

The cloned application info.

- `application_id` — The application ID

- `application_name` — The full application name

- `users` — The cloned rules


## ClonedRuleType  (api_struct)

The cloned rule info.

- `rule_id` — The rule ID

- `rule_name` — The rule name


## ClonedScenarioType  (api_struct)

The cloned scenario info.

- `scenario_id` — The scenario ID

- `scenario_name` — The scenario name


## ClonedUserType  (api_struct)

The cloned user info.

- `user_id` — The user ID

- `user_name` — The user name


## CommonReportType  (api_struct)

The phone number report info.

- `calculated_data` — The calculated report data (the specific report data, see [CalculatedCallHistoryDataType](/docs/references/httpapi/structure/calculatedcallhistorydatatype), [CalculatedTransactionHistoryDataType](/docs/references/httpapi/structure/calculatedtransactionhistorydatatype))

- `completed` — The UTC completion time in 24-h format: YYYY-MM-DD HH:mm:ss. The report is completed if the field exists

- `created` — The creation time in the UTC timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `download_count` — The download attempt count

- `download_size` — The gzipped report size to download

- `file_name` — The report file name

- `file_size` — The report file size

- `filters` — The report order filters (the saved [GetCallHistory](/docs/references/httpapi/history#getcallhistory), [GetTransactionHistory](/docs/references/httpapi/history#gettransactionhistory) parameters)

- `format` — The report format type. The following values are possible: csv

- `last_downloaded` — The last download UTC time in 24-h format: YYYY-MM-DD HH:mm:ss. The report is completed if the field exists

- `report_id` — The phone number report ID

- `store_until` — Store the report until the date in the following format: YYYY-MM-DD. The report is completed if the field exists

- `type` — The report type. The following values are possible: phone_numbers, phone_numbers_awaiting_configuration, none


## ContactInfoType  (api_struct)

The notification contact info.

- `contact_data` — The contact data (i.g. email)

- `contact_id` — The contact ID

- `contact_type` — The contact type. The following values are available: 'email'

- `created` — The creation time in the UTC timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `description` — The contact description

- `is_persistent` — Whether the contact is persistent

- `modified` — The contact editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `next_verification_after_sec` — The verification code sending timeout is seconds

- `notification_group` — The attached notification group list. The following groups are available: 'news', 'tariff_changing', 'account', 'development'

- `verified` — The activation time in the UTC timezone in 24-h format: YYYY-MM-DD HH:mm:ss


## DialogflowKey  (api_struct)

The [Dialogflow](/docs/references/httpapi/dialogflowcredentials) key's content.

- `project_id` — The project ID from Json Web Key


## DialogflowKeyInfo  (api_struct)

The Dialogflow keys list info.

- `applications` — Bound applications

- `content` — The key's content

- `dialogflow_key_id` — The Dialogflow key's id


## ExchangeRatesType  (api_struct)

The [GetCurrencyRate](/docs/references/httpapi/accounts#getcurrencyrate) function result.

- `EUR` — The EUR exchange rate

- `KZT` — The KZT exchange rate

- `RUR` — The RUR exchange rate

- `USD` — The USD exchange rate. It is always equal to 1


## ExpiredAgreementCallback  (api_struct)

Received for the accounts for which the confirmation documents waiting period has already expired or expires today. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `document_ids` — The list of the expired agreements IDs


## ExpiredCertificateCallback  (api_struct)

Received for the accounts whose Apple VOIP certificates are expired. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `certificates` — The expired certificates info


## ExpiringAgreementCallback  (api_struct)

Received for the accounts for which the confirmation documents waiting period expires in 20/15/10/5/1 day(s). Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `expiration_date` — The date of agreement expiration in the following format: YYYY-MM-DD

- `until_expiration` — The number of days left until an expiration date


## ExpiringCallerIDCallback  (api_struct)

Received when a caller ID is about to be expired.

- `callerids` — The list of expiring Caller IDs

- `expiration_date` — The Caller IDs expiration date in YYYY-MM-DD format


## ExpiringCertificateCallback  (api_struct)

Received for the accounts whose Apple VOIP certificates expire in 14 or fewer days. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `certificates` — The expiring certificates info


## FailedSms  (api_struct)

The part of the [A2PSendSms](/docs/references/httpapi/sms#a2psendsms) function result.

- `destination_number` — The SMS destination number

- `error_code` — The error code

- `error_description` — The error description


## GetAutochargeConfigResultType  (api_struct)

The [GetAutochargeConfig](/docs/references/httpapi/structure/getautochargeconfigresulttype) function result.

- `auto_charge` — Whether auto charge enabled or not

- `card_overrun_value` — The auto top-up amount in the account's currency

- `min_balance` — The auto charge threshold

- `receipt_email` — The email for receiving payment receipts


## GetMaxBankCardPaymentResultType  (api_struct)

The [GetMaxBankCardPayment](/docs/references/httpapi/structure/getmaxbankcardpaymentresulttype) function result.

- `currency` — The currency code (USD, RUR, ...)

- `max_payment` — The maximum payment for the specified card. It always equals or less than **new_max_payment**

- `new_max_payment` — The maximum payment available for any card. The values depends on payment gateways, previous transactions during the last 24 hours, etc


## GetMoneyAmountToChargeResult  (api_struct)

The [GetMoneyAmountToCharge](/docs/references/httpapi/accounts#getmoneyamounttocharge) function result.

- `amount` — The money amount of the subscriptions + plan + negative_balance in the specified currency

- `bank_card_amount_usd` — Exists if bank card payments are allowed. It is the maximum of the 'amount' in USD and the min_card_payment (10$)

- `min_amount` — The 'amount' value minus the positive account balance in the specified currency

- `min_bank_card_amount_usd` — Exists if bank card payments are allowed. It is the maximum of the 'min_amount' in USD and the min_card_payment (10$)

- `min_robokassa_amount_rub` — Exists if robokassa payments are allowed. It is the maximum of the 'min_amount' in RUR and the min_robokassa_payment (500 RUR)

- `robokassa_amount_rub` — Exists if robokassa payments are allowed. It is the maximum of the 'min_amount' in RUR and the min_robokassa_payment (500 RUR)

- `subscriptions` — The subscriptions to charge


## GetSecretValueResult  (api_struct)

The [GetSecretValue](/docs/references/httpapi/secrets#getsecretvalue) function result

- `created` — Secret creation timestamp

- `description` — Secret description

- `modified` — Secret modification timestamp

- `secret_id` — Secret ID

- `secret_name` — Secret name

- `secret_value` — Secret value


## GetSQAgentsResult  (api_struct)

The [SQ_GetAgents](/docs/references/httpapi/smartqueue#sq_getagents) function result.

- `max_simultaneous_conversations` — Maximum number of chats that the user processes simultaneously

- `sq_queues` — JSON array of the agent's queues

- `sq_skills` — JSON array of the agent's skills

- `sq_statuses` — Agent statuses info

- `user_display_name` — Display name of the user

- `user_id` — ID of the user

- `user_name` — Name of the user


## GetSQQueuesResult  (api_struct)

The [SQ_GetQueues](/docs/references/httpapi/smartqueue#sq_getqueues) function result.

- `agent_selection` — Agent selection strategy

- `agentcount` — Number of agents bound to the queue

- `call_max_queue_size` — Maximum size of the queue with CALL-type requests

- `call_max_waiting_time` — Maximum time in minutes that a CALL-type request can remain in the queue without being assigned to an agent in minutes. If the value has been passed in seconds, this field is also present in the answer, rounded to the bigger number

- `call_max_waiting_time_in_seconds` — Maximum time in minutes that a CALL-type request can remain in the queue without being assigned to an agent in seconds. If the value has been passed in minutes, this field is also present in the answer

- `created` — UTC date of the queue creation in 24-h format: YYYY-MM-DD HH:mm:ss

- `description` — Comment

- `hold_calls_if_inactive_agents` — Whether the call task is kept in the queue if all agents are unavailable

- `hold_im_if_inactive_agents` — Whether the tasks are queued when there are no active agents

- `im_max_queue_size` — Maximum size of the queue with IM-type requests

- `im_max_waiting_time` — Maximum time in minutes that an IM-type request can remain in the queue without being assigned to an agent in minutes. If the value has been passed in seconds, this field is also present in the answer, rounded to the bigger number

- `im_max_waiting_time_in_seconds` — Maximum time in minutes that an IM-type request can remain in the queue without being assigned to an agent in seconds. If the value has been passed in minutes, this field is also present in the answer

- `modified` — UTC date of the queue modification in 24-h format: YYYY-MM-DD HH:mm:ss

- `sq_queue_id` — ID of the SmartQueue

- `sq_queue_name` — Name of the SmartQueue

- `task_selection` — Strategy of prioritizing requests for service


## GetSQSkillsResult  (api_struct)

The [SQ_GetSkills](/docs/references/httpapi/smartqueue#sq_getskills) function result.

- `created` — UTC date of the queue creation in 24-h format: YYYY-MM-DD HH:mm:ss

- `description` — Comment

- `modified` — UTC date of the queue modification in 24-h format: YYYY-MM-DD HH:mm:ss

- `sq_skill_id` — ID of the skill

- `sq_skill_name` — Name of the skill


## HistoryReportType  (api_struct)

The history report info.

- `calculated_data` — The calculated report data (the specific report data, see [CalculatedCallHistoryDataType](/docs/references/httpapi/structure/calculatedcallhistorydatatype), [CalculatedTransactionHistoryDataType](/docs/references/httpapi/structure/calculatedtransactionhistorydatatype))

- `completed` — The UTC completion time in 24-h format: YYYY-MM-DD HH:mm:ss. The report is completed if the field exists

- `created` — The creation time in the UTC timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `download_count` — The download attempt count

- `download_size` — The gzipped report size to download

- `file_name` — The report file name

- `file_size` — The report file size

- `filters` — The report order filters (the saved [GetCallHistory](/docs/references/httpapi/history#getcallhistory), [GetTransactionHistory](/docs/references/httpapi/history#gettransactionhistory) parameters)

- `format` — The report format type. The following values are possible: csv

- `history_report_id` — The call history report ID

- `history_type` — The history report type. The following values are possible: calls, transactions, audit, call_list

- `last_downloaded` — The last download UTC time in 24-h format: YYYY-MM-DD HH:mm:ss. The report is completed if the field exists

- `store_until` — Store the report until the date in the following format: YYYY-MM-DD. The report is completed if the field exists


## InboundSmsCallback  (api_struct)

The incoming SMS callback. Received as a part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure. If the <b>incoming_sms_notification_url</b> parameter is set, the notification of an incoming SMS is sent to this url, otherwise, it is sent to the general account URL.

- `sms_inbound` — The incoming SMS info


## InboundSmsCallbackItem  (api_struct)

The details of the [InboundSmsCallback](/docs/references/httpapi/structure/inboundsmscallback).

- `destination_number` — The destination phone number

- `sms_body` — The message

- `source_number` — The source phone number


## InvoicePeriod  (api_struct)

Invoices period.

- `from` — From date in the following format: YYYY-MM-DD

- `to` — To date in the following format: YYYY-MM-DD


## InvoiceReceivedCallback  (api_struct)

Received when a monthly invoice is sent. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `amount` — Amount of money in the invoice (excluding taxes)

- `currency` — Invoice currency

- `invoice_date` — Date when invoice is created

- `invoice_id` — Invoice ID

- `receival_date` — Date when invoice is received

- `tax_amount` — Tax amount in the invoice


## InvoiceSpendingDetails  (api_struct)

Each spending details.

- `amount` — Paid amount

- `service_name` — Service name

- `taxes` — Array of taxes


## InvoiceTaxesDetails  (api_struct)

Taxes in the invoice.

- `amount` — Paid amount

- `category` — Tax category

- `currency` — Tax currency

- `level` — Tax type. Possible values: Federal, State, County, City, Unincorporated

- `name` — Tax name

- `rate` — Tax rate

- `taxable_measure` — Taxable sum


## InvoiceTotalDetails  (api_struct)

Invoice total amount details.

- `amount_to_pay` — Discounted amount to pay

- `currency` — Invoice currency

- `discount_amount` — Discount

- `tax_amount` — Total amount of taxes

- `total_amount` — Invoice total amount including taxes


## JSFailCallback  (api_struct)

Received when when <b>send_js_error</b> is set to true and a JS error occurs. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## KeyInfo  (api_struct)

The [CreateKey](/docs/references/httpapi/rolesystem#createkey) function result.

- `account_email` — Client email

- `account_id` — The account ID

- `key_id` — The key ID

- `private_key` — The private key


## KeyValueItems  (api_struct)

SetKeyValueItem, GetKeyValueItem, and GetKeyValueItems functions result.

- `expires_at` — Expiration date based on **ttl** (timestamp without milliseconds)

- `key` — Key that matches the specified key or key pattern

- `value` — Value for the specified key


## KeyValueKeys  (api_struct)

GetKeyValueKeys function result.

- `expires_at` — Expiration date based on **ttl** (timestamp without milliseconds)

- `key` — Key that matches the pattern


## KeyValuePairs  (api_struct)

GetKeyValueItems function result.

- `expires_at` — Expiration date based on **ttl** (timestamp without milliseconds)

- `key` — Key that matches the pattern

- `value` — Value for the specified key


## KeyView  (api_struct)

The [GetKeys](/docs/references/httpapi/rolesystem#getkeys) function result.

- `description` — The key description

- `key_id` — The key ID

- `key_name` — The key's name

- `roles` — The key roles

- `subuser` — The key subuser


## MinBalanceCallback  (api_struct)

Received when the minimum balance is reached. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `is_min_credit` — Whether the credit threshold exceeded. The credit threshold = credit_limit - min_balance_to_notify, wherein min_balance_to_notify > 0

- `is_repeated` — Whether the callback is repeated


## MultipleNumbersPrice  (api_struct)

Info about multiple numbers subscription for the child accounts.

- `account_currency` — Account currency

- `account_installation_price` — Phone number installation price in the account currency

- `account_price` — Phone number price in the account currency

- `count` — The number of subscriptions which should be purchased simultaneously to enable a multiple numbers subscription

- `installation_tax_reserve` — The phone number installation tax reserve

- `local_currency` — Price list currency

- `local_installation_price` — Phone number installation price from the price list

- `local_price` — Phone number price from the price list

- `tax_reserve` — The phone number tax reserve


## NewAttachedPhoneInfoType  (api_struct)

The [AttachPhoneNumber](/docs/references/httpapi/phonenumbers#attachphonenumber) function result.

- `phone_id` — The phone ID

- `phone_number` — The phone number

- `required_verification` — Country code, where the verification is required for the account. Currently, the only possible value for this field is `RU` (Russia)

- `unverified_hold_until` — Unverified phone hold until the date in the following format: YYYY-MM-DD (if the account verification is required). The number is detached on that day automatically!

- `verification_status` — The account verification status. Available only for RU accounts. The following values are possible: REQUIRED, IN_PROGRESS


## NewPhoneInfoType  (api_struct)

The [GetNewPhoneNumbers](/docs/references/httpapi/phonenumbers#getnewphonenumbers) function result item.

- `phone_category_name` — The phone category name (MOBILE, GEOGRAPHIC, TOLLFREE, MOSCOW495)

- `phone_country_code` — The phone country code (2 symbols)

- `phone_id` — The phone ID

- `phone_installation_price` — The phone installation price (without the first monthly fee). It consists of `phone_installation_price` and `phone_installation_tax_reserve`

- `phone_installation_tax_reserve` — The phone number installation tax reserve. The phone installation price consists of `phone_installation_price` and `phone_installation_tax_reserve`

- `phone_number` — The phone number

- `phone_period` — The charge period in 24-h format: Y-M-D H:m:s. Example: 0-1-0 0:0:0 is 1 month

- `phone_price` — The phone monthly fee. It consists of `phone_price` and `phone_tax_reserve`

- `phone_region_name` — The phone region name

- `phone_tax_reserve` — The phone number tax reserve. The phone monthly fee consists of `phone_price` and `phone_tax_reserve`


## NextChargeAlertCallback  (api_struct)

Received when a plan is to be renewed in 3 days, but there is not enough money. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `insufficient_funds_amount` — The amount of money in the account currency required to renew the subscription plans

- `required_money` — The price (in the account currency) of all subscription plans to be renewed on the 1st day of the month


## OutboundTestPhonenumberInfoType  (api_struct)

The [GetOutboundTestPhoneNumbers](/docs/references/httpapi/outboundtestnumbers#getoutboundtestphonenumbers) function result.

- `country_code` — The country code

- `is_verified` — Whether the phone number is verified

- `phone_number` — The personal phone number


## PhoneNumberActivationStatusChangedCallback  (api_struct)

Rented phone number verification status change. Received as a part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `phone_number_activation_status_changed` — Rented phone number verification status


## PhoneNumberActivationStatusChangedCallbackItem  (api_struct)

The details of the [PhoneNumberActivationStatusChangedCallback](/docs/references/httpapi/structure/phonenumberactivationstatuschangedcallback).

- `activation_status` — New verification status

- `phone_number` — Phone number that changed the status


## PhoneNumberCountryCategoryInfoType  (api_struct)

The 'phone_categories' element of the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) function result.

- `country_has_states` — Whether the chosen phone number country has states

- `localized_country_name` — The localized country name

- `localized_phone_category_name` — The localized phone category name

- `localized_phone_region_name` — The localized phone region name

- `phone_category_name` — The phone category name


## PhoneNumberCountryInfoType  (api_struct)

The [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) function result.

- `can_list_phone_numbers` — Whether to list phone numbers

- `country_code` — The country code

- `emergency_calls_to_be_enabled` — Whether you need to make a request to enable calls to emergency numbers

- `localized_country_name` — The localized country name

- `phone_categories` — The phone categories

- `phone_prefix` — The country phone prefix


## PhoneNumberCountryRegionInfoType  (api_struct)

The [GetPhoneNumberRegions](/docs/references/httpapi/phonenumbers#getphonenumberregions) function result.

- `account_currency` — Account currency

- `account_installation_price` — Phone number installation price in the account currency

- `account_price` — Phone number price in the account currency

- `is_need_regulation_address` — Whether to need proof of address

- `is_sms_supported` — Whether SMS is supported for phone numbers in this region. SMS needs to be explicitly enabled for a phone number via the [ControlSms](/docs/references/httpapi/sms#controlsms) Management API before sending or receiving SMS. If SMS is supported and enabled, SMS can be sent from a phone number via the [SendSmsMessage](/docs/references/httpapi/sms#sendsmsmessage) Management API and received via the [InboundSmsCallback](/docs/references/httpapi/structure/inboundsmscallback) property of the HTTP callback. See <a href='/docs/guides/managementapi/callbacks'>this article</a> for HTTP callback details

- `local_currency` — Price list currency

- `local_installation_price` — Phone number installation price from the price list

- `local_price` — Phone number price from the price list

- `localized_country_name` — The localized country name

- `localized_phone_category_name` — The localized phone category name

- `localized_phone_region_name` — The localized phone region name

- `multiple_numbers_price` — [Array](MultipleNumbersPrice) with info about multiple numbers subscription for the child accounts

- `phone_count` — The phone number quantity in stock for the region

- `phone_installation_tax_reserve` — The phone number installation tax reserve

- `phone_period` — The charge period in 24-h format: Y-M-D H:m:s. Example: 0-1-0 0:0:0 is 1 month

- `phone_region_code` — The region phone prefix

- `phone_region_id` — The region ID

- `phone_region_name` — The full region name

- `phone_tax_reserve` — The phone number tax reserve

- `regulation_address_type` — The type of regulation address. The possible values are LOCAL, NATIONAL, WORLDWIDE

- `required_verification` — Country code, where the verification is required for the account. Currently, the only possible value for this field is `RU` (Russia)

- `verification_status` — The account verification status. Available only for RU accounts. The following values are possible: REQUIRED, IN_PROGRESS


## PhoneNumberCountryStateInfoType  (api_struct)

The [GetPhoneNumberCountryStates](/docs/references/httpapi/phonenumbers#getphonenumbercountrystates) function result.

- `country_state` — The country state code

- `country_state_name` — The full country state name


## PlanPackageType  (api_struct)

The plan package info.

- `may_overrun` — Whether overrun is enabled

- `overrun_price` — The overrun amount

- `overrun_resources` — The number of resources (e.g., messages) per overrun

- `package_name` — The package name

- `package_size` — The package size

- `price_group_id` — The price group IDs


## PlanType  (api_struct)

The [GetAvailablePlans](/docs/references/httpapi/accounts#getavailableplans) function result item.

- `packages` — The account package array

- `periodic_charge` — The plan monthly charge

- `plan_name` — The plan name

- `plan_subscription_template_id` — The current plan ID

- `plan_type` — The plan type. The possible values are IM, MAU


## PriceGroup  (api_struct)

The resource price group.

- `num_resources_per_price` — The resource number per price

- `params` — The available resource parameters

- `price` — The price for the 'num_resources_per_price' resource count

- `price_group_id` — The price group ID

- `price_group_name` — The price group name. Example: Russia Mobile

- `quantum` — The resource rounding quantum


## PstnBlackListInfoType  (api_struct)

The PSTN black list item info.

- `pstn_blacklist_id` — The black list item ID

- `pstn_blacklist_phone ` — The phone number


## PushCredentialContent  (api_struct)

The push credentials list item info.

- `cert_content` — The certificate content in BASE64. Credentials for APPLE push

- `cert_file_name` — The file name. Credentials for APPLE push

- `huawei_application_id` — The application id, provided by Huawei. Credentials for HUAWEI push

- `huawei_client_id` — The client id, provided by Huawei. Credentials for HUAWEI push

- `is_dev_mode` — Whether to use in a Apple sandbox environment. Credentials for APPLE push

- `sender_id` — The sender id provided by Google. Credentials for GOOGLE push


## PushCredentialInfo  (api_struct)

The push credentials list item info.

- `applications` — Bound applications

- `content` — The credentials content

- `credential_bundle` — The bundle of Android/iOS application

- `expiration_date` — The expiration date of the push certificate

- `push_credential_id` — The push credential id

- `push_provider_id` — The push provider id

- `push_provider_name` — The push provider name. The possible values are APPLE, APPLE_VOIP, GOOGLE, HUAWEI


## QueueInfoType  (api_struct)

The [GetQueues](/docs/references/httpapi/queues#getqueues) function result item.

- `acd_queue_id` — The ACD queue ID

- `acd_queue_name` — The queue name

- `acd_queue_priority` — The integer queue priority. The highest priority is 0

- `application_id` — The application ID

- `auto_binding` — Whether to enable the auto binding of operators to a queue by skills comparing

- `average_service_time` — The average service time in seconds. Specify the parameter to correct or initialize the waiting time prediction

- `created` — The ACD queue creating UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `deleted` — The ACD queue deleting UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `max_queue_size` — The maximum number of calls that can be enqueued into this queue

- `max_waiting_time` — The maximum predicted waiting time in minutes. When a call is going to be enqueued to the queue, its predicted waiting time should be less or equal to the maximum predicted waiting time; otherwise, a call would be rejected

- `modified` — The ACD queue editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `operatorcount` — Number of agents bound to the queue

- `service_probability` — The value in the range of [0.5 ... 1.0]. The value 1.0 means the service probability 100% in challenge with a lower priority queue

- `skills` — The queue skills info

- `sl_thresholds` — The service level thresholds in seconds

- `users` — The queue users info


## QueueSkills  (api_struct)

The queue skills info.

- `skill_id` — The skill ID

- `skill_name` — The skill name


## QueueUsers  (api_struct)

The queue users info.

- `user_id` — The user ID


## RecordStorageInfoType  (api_struct)

The [GetRecordStorages](/docs/references/httpapi/recordstorages#getrecordstorages) function result.

- `record_storage_id` — The record storage ID

- `record_storage_name` — The record storage name


## RecordType  (api_struct)

The record info.

- `cost` — The record cost

- `duration` — The call duration in seconds

- `file_size` — The file size

- `record_id` — The record ID

- `record_name` — The record name

- `record_url` — The record URL.  If you have issues accessing the record file, check if the application has "Secure storage of applications and logs" feature enabled. In this case, you need to <a href='/docs/guides/managementapi/secureobjects'>authorize</a>.

- `start_time` — The start recording time in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `transaction_id` — The transaction ID

- `transcription_status` — The status of transcription. The possible values are Not required, In progress, Complete

- `transcription_url` — Transcription URL. To open the URL, please add authorization parameters and <b>record_id</b> to it


## RegulationAddress  (api_struct)

The [GetRegulationsAddress](/docs/references/httpapi/regulationaddress#getregulationsaddress) and [GetAvailableRegulations](/docs/references/httpapi/regulationaddress#getavailableregulations) result.

- `builder_latter` — The builder latter

- `builder_number` — The builder number

- `city` — The city name

- `company` — The company name

- `country_code` — The country code

- `external_id` — The external ID

- `first_name` — The first name

- `last_name` — The last name

- `owner_country_code` — The owner country code

- `phone_category_name` — The phone category name

- `regulation_address_id` — The regulation address ID

- `reject_message` — The reject message

- `salutation` — The salutation. Possible values: MR, MS, COMPANY

- `status` — The status verification. Possible values: IN_PROGRESS, VERIFIED, DECLINED

- `street` — The zip code

- `zip_code` — The zip code


## RegulationAddressDocumentsRequestedCallback  (api_struct)

Received when the verification status of regulation address is changed to PENDING. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `comment` — Reviewer's comment

- `is_individual` — Whether the account belongs to an individual

- `regulation_address_id` — Uploaded document ID

- `regulation_address_name` — Uploaded document name

- `regulation_address_status` — Document verification status. The following values are possible: IN_PROGRESS, VERIFIED, DECLINED, PENDING

- `update_time` — UTC time when the status is updated


## RegulationAddressUploadedCallback  (api_struct)

Received when proof of address is uploaded. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `is_individual` — Whether the account belongs to an individual

- `regulation_address_id` — The uploaded document ID. See GetRegulationsAddress

- `regulation_address_name` — The regulation address name

- `uploaded` — The UTC date of the document upload in the following format: YYYY-MM-DD HH::mm:ss


## RegulationAddressVerifiedCallback  (api_struct)

Received when proof of address is verified. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `comment` — The reviewer's comment

- `is_individual` — Whether the account belongs to an individual

- `regulation_address_id` — The uploaded document ID

- `regulation_address_name` — The regulation address name

- `regulation_address_status` — The document verification status. The following values are possible: VERIFIED, DECLINED

- `uploaded` — The UTC date of the document upload in the following format: YYYY-MM-DD HH::mm:ss


## RegulationCountry  (api_struct)

The country record.

- `country_code` — The country code A2

- `country_name` — The country name


## RegulationRegionRecord  (api_struct)

The [GetRegions](/docs/references/httpapi/regulationaddress#getregions) function result.

- `is_need_regulation_address` — Whether need to confirm the address

- `phone_region_code` — The phone region code 

- `phone_region_id` — The regulation address ID

- `phone_region_name` — The region name

- `regulation_address_type` — The regulation address type. Available: LOCAL, NATIONAL, WORLDWIDE


## RenewedSubscriptionsCallback  (api_struct)

Received when subscriptions are renewed. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `subscriptions` — The renewed subscription list


## RenewedSubscriptionsCallbackItem  (api_struct)

The specific account callback details.

- `cost` — The subscription cost

- `details` — Info about the phone numbers or sip registrations that the subscription is attached to

- `name` — The subscription description (details). Example: the subscribed phone number

- `next_renewal` — The next renewal date, format: YYYY-MM-DD

- `type` — The subscription type, example: PHONE_NUM, SIP_REGISTRATION, PLAN


## ResetAccountPasswordRequestCallback  (api_struct)

Received when an account password reset is requested. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.


## ResourceParams  (api_struct)

The available resource parameters.

- `allowed` — The allowed parameter prefixes. Example: 7495

- `forbidden` — The forbidden parameter prefixes. Example: 7800

- `requested` — The requested parameters. Example: 79263331122


## ResourcePrice  (api_struct)

The [GetResourcePrice](/docs/references/httpapi/accounts#getresourceprice) function result.

- `price_groups` — The price group array

- `resource_type` — The resource type name. The possible values are AUDIOHDCONFERENCE, AUDIOHDRECORD, AUDIORECORD, CALLLIST, CALLSESSION, DIALOGFLOW, IM, PSTN_IN_ALASKA, PSTN_IN_GB, PSTN_IN_GEOGRAPHIC, PSTN_IN_GEO_PH, PSTN_IN_RU, PSTN_IN_RU_TOLLFREE, PSTN_INTERNATIONAL, PSTNINTEST, PSTN_IN_TF_AR, PSTN_IN_TF_AT, PSTN_IN_TF_AU, PSTN_IN_TF_BE, PSTN_IN_TF_BR, PSTN_IN_TF_CA, PSTN_IN_TF_CO, PSTN_IN_TF_CY, PSTN_IN_TF_DE, PSTN_IN_TF_DK, PSTN_IN_TF_DO, PSTN_IN_TF_FI, PSTN_IN_TF_FR, PSTN_IN_TF_GB, PSTN_IN_TF_HR, PSTN_IN_TF_HU, PSTN_IN_TF_IL, PSTN_IN_TF_LT, PSTN_IN_TF_PE, PSTN_IN_TF_US, PSTN_IN_US, PSTNOUT, PSTNOUT_EEA, PSTNOUTEMERG, PSTNOUT_KZ, PSTNOUT_LOCAL, PSTN_OUT_LOCAL_RU, RELAYED_TRAFFIC, SIPOUT, SIPOUTVIDEO, SMSINPUT, SMSOUT, SMSOUT_INTERNATIONAL, TRANSCRIPTION, TTS_TEXT_GOOGLE, TTS_YANDEX, USER_LOGON, VIDEOCALL, VIDEORECORD, VOICEMAILDETECTION, VOIPIN, VOIPOUT, VOIPOUTVIDEO, YANDEXASR, ASR, ASR_GOOGLE_ENHANCED


## ResourceUsageType  (api_struct)

The resource usage info.

- `cost` — The resource cost

- `description` — The description

- `ref_call_id` — The reference to call

- `resource_quantity` — The resource quantity

- `resource_type` — The resource type. The possible values are CALLSESSION, VIDEOCALL, VIDEORECORD, VOICEMAILDETECTION, YANDEXASR, ASR, TRANSCRIPTION, TTS_TEXT_GOOGLE, TTS_YANDEX, AUDIOHDCONFERENCE

- `resource_usage_id` — The resource usage ID

- `transaction_id` — The transaction ID

- `unit` — The resource unit

- `used_at` — The start resource using time in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss


## RestoredAgreementStatusCallback  (api_struct)

Received when an expiration date of the confirmation documents waiting period is changed. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `document_id` — ID of the agreement document which status has been changed

- `expiration_date` — The new date of agreement expiration in the following format: YYYY-MM-DD


## RobokassaPaymentCallback  (api_struct)

Received when a robokassa payment is made. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `amount` — The amount in the account currency

- `transaction_id` — The transaction ID

- `transaction_type` — The transaction type


## RoleGroupView  (api_struct)

The [GetRoleGroups](/docs/references/httpapi/rolesystem#getrolegroups) function result.

- `id` — The role group ID

- `name` — The role group name


## RoleView  (api_struct)

The role view.

- `child_ids` — Child roles IDs array

- `gui_only` — Whether the role is gui only

- `inherited` — Whether the role is inherited

- `parent_role_id` — Parent roles IDs array

- `role_id` — The role ID

- `role_name` — The role name


## RuleInfoType  (api_struct)

The [GetRules](/docs/references/httpapi/rules#getrules) function result item.

- `application_id` — The application ID

- `modified` — The rule editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `rule_id` — The rule ID

- `rule_name` — The rule name

- `rule_pattern` — The rule pattern regex

- `rule_pattern_exclude` — The rule pattern excluding regex

- `scenarios` — The bound scenarios

- `video_conference` — Whether video conference is required


## ScenarioInfoType  (api_struct)

The [GetScenarios](/docs/references/httpapi/scenarios#getscenarios) function result.

- `modified` — The scenario editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `parent` — Whether the scenario belongs to the parent account, 'false' if the scenario belongs to the current account

- `scenario_id` — The scenario ID

- `scenario_name` — The scenario name

- `scenario_script` — The scenario text


## SecretListItem  (api_struct)

The [GetSecrets](/docs/references/httpapi/secrets#getsecrets) function result list item

- `created` — Secret creation timestamp

- `description` — Secret description

- `modified` — Secret modification timestamp

- `secret_id` — Secret ID

- `secret_name` — Secret name


## ShortAccountInfoType  (api_struct)

The short account info.

- `account_id` — The account's ID

- `balance` — The account's money

- `currency` — The currency code (USD, RUR, EUR, ...)

- `frozen` — Whether account is blocked by Voximplant admins or not


## SIPRegistrationFailCallback  (api_struct)

Received when one or several SIP registrations are failed. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `sip_registrations` — SIP registration array


## SIPRegistrationIsFailedCallbackItem  (api_struct)

The specific account callback details.

- `error_message` — Error message from a SIP registration

- `sip_registration_id` — SIP registration ID

- `status_code` — Status code from a SIP registration


## SIPRegistrationIsRecoveredCallbackItem  (api_struct)

The specific account callback details.

- `sip_registration_id` — SIP registration ID


## SIPRegistrationRecoveredCallback  (api_struct)

Received when one or several SIP registrations are recovered. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `sip_registrations` — SIP registration array


## SIPRegistrationType  (api_struct)

Detailing SIP registration.

- `application_id` — ID of the bound application

- `application_name` — Name of the bound application

- `auth_user` — The SIP authentications user

- `deactivated` — Whether the subscription is deactivation. The SIP registration is frozen if true

- `error_message` — The error message from a SIP registration

- `is_persistent` — Whether the SIP registration is persistent. Set false to activate it only on the user login

- `last_updated` — The last time updated

- `next_subscription_renewal` — The next subscription renewal date in the following format: YYYY-MM-DD

- `outbound_proxy` — The outgoing proxy

- `proxy` — The sip proxy

- `purchase_date` — The purchase date in 24-h format: YYYY-MM-DD HH:mm:ss

- `rule_id` — ID of the bound rule

- `rule_name` — Name of the bound rule

- `sip_registration_id` — The SIP registration ID

- `sip_username` — The user name from sip proxy

- `status_code` — The status code from a SIP registration

- `subscription_price` — The subscription monthly charge

- `successful` — Whether the SIP registration is successful

- `user_id` — ID of the bound user

- `user_name` — Name of the bound user


## SipWhiteListInfoType  (api_struct)

The [GetSipWhiteList](/docs/references/httpapi/sipwhitelist#getsipwhitelist) function result item.

- `description` — The network address description

- `sip_whitelist_id` — The SIP white list item ID

- `sip_whitelist_network` — The network address in format A.B.C.D/L


## SkillInfoType  (api_struct)

The [GetSkills](/docs/references/httpapi/skills#getskills) function result.

- `skill_id` — The skill ID

- `skill_name` — The skill name


## SmartQueueAgent_Skill  (api_struct)

Agent skill info.

- `sq_skill_id` — The agent skill ID

- `sq_skill_level` — The agent skill level

- `sq_skill_name` — The agent skill name


## SmartQueueMetricsGroups  (api_struct)

The [SmartQueueMetricsResult](/docs/references/httpapi/structure/smartqueuemetricsresult) details.

- `sq_queue_id` — The SmartQueue ID

- `sq_queue_name` — The SmartQueue name

- `user_display_name` — The user display name

- `user_id` — The user ID

- `user_name` — The user name

- `values` — The group values


## SmartQueueMetricsGroupsValues  (api_struct)

The [SmartQueueMetricsGroups](/docs/references/httpapi/structure/smartqueuemetricsgroups) details.

- `from_date` — The start of the period

- `to_date` — The end of the period

- `value` — The report value


## SmartQueueMetricsResult  (api_struct)

The [GetSmartQueueRealtimeMetrics](/docs/references/httpapi/smartqueue#getsmartqueuerealtimemetrics) function result.

- `groups` — Grouping by agent or queue

- `report_type` — The report type(s). Possible values are calls_blocked_percentage, count_blocked_calls, average_abandonment_rate, count_abandonment_calls, service_level, occupancy_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_banned_time, min_time_in_queue,max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime, sum_agents_custom_1_time ... sum_agents_custom_10_time, call_count_assigned_to_queue, im_count_assigned_to_queue


## SmartQueueState  (api_struct)

The [GetSQState](/docs/references/httpapi/smartqueue#getsqstate) function result.

- `sq_agents` — The list of logged-in agents with their skills and statuses

- `sq_queue_id` — The SmartQueue ID

- `sq_queue_name` — The SmartQueue name

- `tasks` — The list of tasks


## SmartQueueState_Agent  (api_struct)

SmartQueueState.sq_agents item.

- `sq_skills` — Agent skills

- `sq_statuses` — Agent statuses info

- `user_display_name` — The display user name

- `user_id` — The user ID

- `user_name` — The user name


## SmartQueueState_Agent_Status  (api_struct)

The current operator's status. Refer to <a href='https://voximplant.com/docs/guides/smartqueue/howto#set-up-an-operator's-workspace'>this guide</a> to read more about SmartQueue operator statuses

- `CALL` — The CALL status info

- `IM` — The IM status info


## SmartQueueState_Agent_Status_Type  (api_struct)

The current operator's status type. Refer to <a href='https://voximplant.com/docs/guides/smartqueue/howto#set-up-an-operator's-workspace'>this guide</a> to read more about SmartQueue operator statuses

- `from_date` — Time in 24-h format: YYYY-MM-DD HH:mm:ss

- `sq_status_name` — The status name


## SmartQueueState_Task  (api_struct)

SmartQueueState.tasks item.

- `custom_data` — Custom data text string for the current task. You can set the custom data in the [enqueueTask](/docs/references/voxengine/voxengine/enqueuetask#enqueuetask) method

- `processing_time` — Processing time in ms

- `sq_skills` — Task skills

- `status` — The task status. Possible values are IN_QUEUE, DISTRIBUTED, IN_PROCESSING

- `task_type` — The task type. Possible values are CALL, IM

- `user_id` — Selected agent

- `waiting_time` — Waiting time in ms


## SmartQueueTask_Skill  (api_struct)

Task skill info.

- `sq_skill_level` — The skill level

- `sq_skill_name` — The skill name


## SmsHistoryType  (api_struct)

The [GetSmsHistory](/docs/references/httpapi/sms#getsmshistory) function result.

- `cost` — Cost of the message

- `destination_number` — Number being called to

- `direction` — Incoming or outgoing message

- `error_message` — Error message (if any)

- `fragments` — Number of fragments the initial message is divided into

- `message_id` — Message ID

- `processed_date` — Date of message processing. The format is yyyy-MM-dd HH:mm:ss

- `source_number` — Number being called from

- `status_id` — Status of the message. The possible values are: 1 — Success, 2 — Error, 3 — Waiting

- `text` — Stored message text

- `transaction_id` — Id of the transaction for this message


## SmsTransaction  (api_struct)

The part of the [A2PSendSms](/docs/references/httpapi/sms#a2psendsms) function result.

- `destination_number` — The SMS destination number

- `message_id` — Message ID


## SQAddQueueResult  (api_struct)

The [SQ_AddQueue](/docs/references/httpapi/smartqueue#sq_addqueue) function result.

- `sq_queue_id` — ID of the added queue


## SQAddSkillResult  (api_struct)

The [SQ_AddSkill](/docs/references/httpapi/smartqueue#sq_addskill) function result.

- `sq_skill_id` — ID of the added skill


## SQAgentBindingModes  (api_struct)

Agent binding mode for the [SQ_BindAgent](/docs/references/httpapi/smartqueue#sq_bindagent) function.

- `add` — Remove all the queues from the agent and bind new queues

- `add_queues` — Add additional queues to the agent

- `replace` — Unbind all the existing agents and all the existing queues, then bind the specified queues to the specified agents

- `replace_agents` — Unbind all the existing agents from the queue and bind new agents


## SQSkillBindingModes  (api_struct)

Skill binding mode for the [SQ_BindSkill](/docs/references/httpapi/smartqueue#sq_bindskill) function.

- `add` — Add new skills to the agents

- `replace_agents` — Replace agents with new ones

- `replace_skills` — Replace agent skills with new ones


## SQTaskSelectionStrategies  (api_struct)

Task selection strategies for the [SQ_AddQueue](/docs/references/httpapi/smartqueue#sq_addqueue) and [SQ_SetQueueInfo](/docs/references/httpapi/smartqueue#sq_setqueueinfo) functions.

- `MAX_PRIORITY` — Calls or messages with the highest priority are the first to distribute to agents

- `MAX_WAITING_TIME` — Calls or messages with the longest waiting time are the first to distribute to agents


## SubscriptionCallbackDetails  (api_struct)

Information about the phone numbers or sip registrations that the subscription is attached to.

- `phone_numbers` — Object containing the subscription's phone numbers and their ids if type = PHONE

- `sip_registrations` — Object containing the subscription's sip registrations ids if type = SIP_REGISTRATION

- `type` — Type that the subscription is attached to. Possible values are PHONE and SIP_REGISTRATION


## SubscriptionCallbackDetailsPhoneNumbers  (api_struct)

Information about the subscription's phone numbers.

- `phone_id` — Phone number id

- `phone_number` — Phone number


## SubscriptionCallbackDetailsSipRegistrations  (api_struct)

Information about the subscription's sip registrations.

- `sip_registration_id` — Sip registration id


## SubscriptionIsDetachedCallback  (api_struct)

Received when a subscription is canceled. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `subscriptions` — The detached subscription list


## SubscriptionIsDetachedCallbackItem  (api_struct)

The specific account callback details.

- `details` — Info about the phone numbers or sip registrations that the subscription is attached to

- `name` — The subscription description (details). Example: the subscribed phone number

- `type` — The subscription type, example: PHONE_NUM, SIP_REGISTRATION


## SubscriptionIsFrozenCallback  (api_struct)

Received when a subscription is frozen. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `subscriptions` — The frozen subscription list


## SubscriptionIsFrozenCallbackItem  (api_struct)

The specific account callback details.

- `cost` — The subscription cost

- `details` — Info about the phone numbers or sip registrations that the subscription is attached to

- `name` — The subscription description (details). Example: the subscribed phone number

- `type` — The subscription type, example: PHONE_NUM, SIP_REGISTRATION


## SubscriptionsToChargeType  (api_struct)

The [GetMoneyAmountToCharge](/docs/references/httpapi/accounts#getmoneyamounttocharge) function result field.

- `subscription_amount` — The money amount to charge in the specified currency

- `subscription_auto_charge` — Whether the subscription charges automatically

- `subscription_description` — The subscription description (details). Example: the subscribed phone number

- `subscription_next_renewal` — The next renewal date, format: YYYY-MM-DD. Displayed for only verified phone numbers

- `subscription_type` — The subscription type, example: PHONE_NUM, SIP_REGISTRATION


## SubscriptionTemplateType  (api_struct)

The subscription template info.

- `currency` — Subscription's currency

- `installation_price` — Subscription's installation price (without the first monthly fee)

- `installation_price_in_currency` — Subscription's installation price in the original currency

- `installation_tax_reserve` — Phone number's installation tax reserve

- `period` — Charge period in 24-h format: Y-M-D H:m:s. Example: 0-1-0 0:0:0 is 1 month

- `price` — Subscription's monthly fee, including taxes and discounts

- `price_in_currency` — Subscription's monthly fee in the original currency

- `required_verification` — Whether verification is required for the account

- `subscription_template_id` — Subscription's template ID

- `subscription_template_name` — Subscription template name (example: SIP registration, Phone GB, Phone RU 495, ...)

- `subscription_template_type` — Subscription template type. The following values are possible: PHONE_NUM, SIP_REGISTRATION

- `tax_reserve` — Phone number's tax reserve

- `verification_status` — Verification status. Possible values are REQUIRED, IN_PROGRESS, VERIFIED, NOT_REQUIRED


## SubUserID  (api_struct)

The [AddSubUser](/docs/references/httpapi/rolesystem#addsubuser) function result.

- `subuser_id` — The subuser ID


## SubUserView  (api_struct)

The [GetSubUsers](/docs/references/httpapi/rolesystem#getsubusers) function result.

- `description` — The subuser description

- `roles` — The subuser roles

- `subuser_id` — The subuser ID

- `subuser_name` — The subuser name, can be used as __subuser_login__ to <a href='/docs/guides/managementapi/authorization'>authenticate</a>


## TransactionHistoryReportCallback  (api_struct)

Received when a transaction history report is ready. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `history_report_id` — The history report ID

- `order_date` — The UTC order date in the following format: YYYY-MM-DD HH::mm:ss

- `success` — Whether the request is successful


## TransactionInfoType  (api_struct)

The [GetTransactionHistory](/docs/references/httpapi/history#gettransactionhistory) function result item.

- `account_id` — The account ID

- `amount` — The transaction amount, $

- `currency` — The amount currency (USD, RUR, EUR, ...). 

- `performed_at` — The transaction date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `transaction_description` — The transaction description

- `transaction_id` — The transaction ID

- `transaction_type` — The transaction type. The following values are possible: gift_revoke, resource_charge, money_distribution, subscription_charge, subscription_installation_charge, card_periodic_payment, card_overrun_payment, card_payment, rub_card_periodic_payment, rub_card_overrun_payment, rub_card_payment, robokassa_payment, gift, promo, adjustment, wire_transfer, us_wire_transfer, refund, discount, mgp_charge, mgp_startup, mgp_business, mgp_big_business, mgp_enterprise, mgp_large_enterprise, techsupport_charge, tax_charge, monthly_fee_charge, grace_credit_payment, grace_credit_provision, mau_charge, mau_overrun, im_charge, im_overrun, fmc_charge, sip_registration_charge, development_fee, money_transfer_to_child, money_transfer_to_parent, money_acceptance_from_child, money_acceptance_from_parent, phone_number_installation, phone_number_charge, toll_free_phone_number_installation, toll_free_phone_number_charge, services, user_money_transfer, paypal_payment, paypal_overrun_payment, paypal_periodic_payment


## TranscriptionCompleteCallback  (api_struct)

Received when a transcription is saved. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `transcription_complete` — The transcription info


## TranscriptionCompleteCallbackItem  (api_struct)

The specific account callback details.

- `call_session_history_id` — The call session history ID

- `record_url` — The record url

- `transcription_cost` — The cost of transcription

- `transcription_url` — Transcription URL. To open the URL, please add authorization parameters and <b>record_id</b> to it


## UnverifiedSubscriptionDetachedCallback  (api_struct)

Received when an unverified subscription is canceled. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `subscriptions` — The frozen subscription list


## UnverifiedSubscriptionDetachedCallbackItem  (api_struct)

The specific account callback details.

- `details` — Info about the phone numbers or sip registrations that the subscription is attached to

- `name` — The subscription description (details). Example: the subscribed phone number

- `type` — The subscription type, example: PHONE_NUM, SIP_REGISTRATION


## UserInfoType  (api_struct)

The [GetUsers](/docs/references/httpapi/users#getusers) function result.

- `acd_queues` — The bound ACD queues

- `acd_status` — The ACD operator status. The following values are possible: OFFLINE, ONLINE, READY, BANNED, IN_SERVICE, AFTER_SERVICE, TIMEOUT, DND

- `acd_status_change_time` — The ACD status changing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `applications` — The bound applications

- `balance` — The current user's money in the currency specified for the account. The value is the number rounded to 4 decimal places. The parameter is the alias to live_balance by default. But there is a possibility to make the alias to fixed_balance: just to pass return_live_balance=false into the [GetAccountInfo](/docs/references/httpapi/accounts#getaccountinfo) method

- `created` — The user editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `fixed_balance` — The last committed balance which has been approved by billing's transaction

- `live_balance` — The current user's money in the currency specified for the account. The value is the number rounded to 4 decimal places, and it changes during the calls, transcribing, purchases etc

- `modified` — The user editing UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `parent_accounting` — Whether the user uses the parent account's money, 'false' if the user has a separate balance

- `skills` — The bound skills

- `user_active` — Whether the user is active. Inactive users cannot log in to applications

- `user_custom_data` — The custom data

- `user_display_name` — The display user name

- `user_id` — The user ID

- `user_name` — The user name


## WABPhoneInfoType  (api_struct)

The [GetWABPhoneNumbers](/docs/references/httpapi/wabphonenumbers#getwabphonenumbers) function result.

- `application_id` — ID of the bound application

- `application_name` — Name of the bound application

- `country_code` — The WhatsApp Business country code (2 symbols)

- `created` — UTC date in 24-h format: YYYY-MM-DD HH:mm:ss

- `description` — WhatsApp Business phone number description

- `extended_application_name` — Full application name, e.g. myapp.myaccount.n1.voximplant.com

- `modified` — UTC date of an event associated with the number in 24-h format: YYYY-MM-DD HH:mm:ss

- `rule_id` — ID of the bound rule

- `rule_name` — Name of the bound rule

- `wab_phone_number` — WhatsApp Business phone number


## WireTransferCallback  (api_struct)

Received when a wire transfer is made. Received as part of the [AccountCallback](/docs/references/httpapi/structure/accountcallback) structure.

- `amount` — The amount in the account currency

- `transaction_id` — The transaction ID

- `transaction_type` — The transaction type


## ZipCode  (api_struct)

The ZipCode record.

- `city` — The city name

- `zip_code` — The zip code
