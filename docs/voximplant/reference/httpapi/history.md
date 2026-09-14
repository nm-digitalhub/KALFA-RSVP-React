# History  (ref_folder)


## DeleteRecord  (api_method)

Try to remove a record and transcription files.

_roles: Owner, Admin_

**Returns:** 

- `record_id` — The record ID to remove. You can retrieve the record ID via the <a href="https://voximplant.com/docs/references/httpapi/structure/callsessioninfotype#records">CallSessionInfoType.records</a> method

- `record_url` — The record URL to remove. You can retrieve the record URL via the <a href="https://voximplant.com/docs/references/httpapi/structure/callsessioninfotype#records">CallSessionInfoType.records</a> method


## DownloadHistoryReport  (api_method)

Downloads the required history report.<br><br>Please note, that the history report can return in a compressed state (*.gzip). In order for CURL to process a compressed file correctly, add the **--compressed** key.

_roles: Owner, Admin, Supervisor, Accountant, Payer_

**Returns:** 

- `history_report_id` — The history report ID


## GetACDHistory  (api_method)

Gets the ACD history.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `acd_queue_id` — The ACD queue ID list to filter separated by semicolons (;)

- `acd_request_id` — The ACD request ID list separated by semicolons (;)

- `acd_session_history_id` — The ACD session history ID list separated by semicolons (;)

- `callerid` — The caller phone number to filter

- `count` — The maximum returning record count

- `custom_data` — The ACD session custom data to filter. The match is exact

- `decimal_separator` — The decimal mark for the CSV numbers if the output=csv. If omitted, the account locale setting is used

- `desc_order` — Whether to get records in the descent order

- `from_date` — The UTC 'from' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `min_waiting_time` — The minimum waiting time filter

- `offset` — The first <b>N</b> records are skipped in the output

- `operator_hangup` — Whether to get the calls terminated by the operator

- `output` — The output format. The following values available: **json**, **csv**, **xls**. The default value is **json**

- `rejected` — Whether the call is rejected calls by the 'max_queue_size', 'max_waiting_time' threshold

- `to_date` — The UTC 'to' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `unserviced` — Whether the call is unserviced by the operator

- `user_id` — The user ID list to filter separated by semicolons (;)

- `with_events` — Whether to get the bound events

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## GetAuditLog  (api_method)

Gets the history of account changes.

_roles: Owner_

**Returns:** 

- `advanced_filters` — A relation ID to filter (for example: a phone_number value, a user_id value, an application_id value)

- `audit_log_id` — The audit history ID list separated by semicolons (;)

- `count` — The maximum returning number of records. If omitted, the report service applies its own limit

- `decimal_separator` — The decimal mark for the CSV numbers if the output=csv. If omitted, the account locale setting is used

- `desc_order` — Whether to get records in the descent order

- `filtered_admin_user_id` — The admin user ID list separated by semicolons (;) to filter

- `filtered_cmd` — The function list separated by semicolons (;) to filter

- `filtered_ip` — The IP list separated by semicolons (;) to filter

- `from_date` — The UTC 'from' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `is_async` — Whether to create an asynchronous history report instead of returning the data immediately. Has the same effect as calling GetAuditLogAsync and requires the output=csv

- `offset` — The first <b>N</b> records are skipped in the output

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The UTC 'to' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `with_header` — Whether to get a CSV file with the column names if the output=csv

- `with_total_count` — Whether to include the 'total_count' and increase performance


## GetAuditLogAsync  (api_method)

The [GetAuditLog](/docs/references/httpapi/history#getauditlog) asynchronous implementation. Use this function to download a large amounts of data. Take a look at the [GetHistoryReports](/docs/references/httpapi/history#gethistoryreports) and [DownloadHistoryReport](/docs/references/httpapi/history#downloadhistoryreport) functions for downloading details.

_roles: Owner_

**Returns:** 

- `advanced_filters` — A relation ID to filter (for example: a phone_number value, a user_id value, an application_id value)

- `audit_log_id` — The audit history ID list separated by semicolons (;)

- `count` — The maximum number of records to include in the report. If omitted, the report service applies its own limit

- `desc_order` — Whether to get records in the descent order

- `filtered_admin_user_id` — The admin user ID list separated by semicolons (;) to filter

- `filtered_cmd` — The function list separated by semicolons (;) to filter

- `filtered_ip` — The IP list separated by semicolons (;) to filter

- `from_date` — The UTC 'from' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `offset` — The first <b>N</b> records are skipped in the output

- `output` — The output format. The following values available: **csv**. The default value is **csv**

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The UTC 'to' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## GetBriefCallHistory  (api_method)

Gets the account's brief call history in the asynchronous mode. Take a look at the [GetHistoryReports](/docs/references/httpapi/history#gethistoryreports) and [DownloadHistoryReport](/docs/references/httpapi/history#downloadhistoryreport) functions for downloading details.

_roles: Owner, Admin, Developer, Supervisor, Support_

**Returns:** 

- `application_id` — To receive the call history for a specific application, pass the application ID to this parameter. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `call_session_history_custom_data` — To filter the call history by the custom_data passed to the call sessions, pass the custom data to this parameter

- `call_session_history_id` — To get the call history for the specific sessions, pass the session IDs to this parameter separated by a semicolon (;). You can find the session ID in the <a href='/docs/references/voxengine/appevents#started'>AppEvents.Started</a> event's <b>sessionID</b> property in a scenario, or retrieve it from the <b>call_session_history_id</b> value returned from the <a href='https://voximplant.com/docs/references/httpapi/scenarios#reorderscenarios'>StartScenarios</a> or <a href='https://voximplant.com/docs/references/httpapi/scenarios#startconference'>StartConference</a> methods

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `local_number` — To receive a call history for a specific local numbers, pass the number list separated by semicolons (;). A local number is a number on the platform side

- `output` — The output format. The following values available: **csv**.

- `remote_number` — To receive a call history for a specific remote numbers, pass the number list separated by semicolons (;). A remote number is a number on the client side

- `rule_name` — To receive the call history for a specific routing rule, pass the rule name to this parameter. Applies only if you set application_id or application_name

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## GetCallHistory  (api_method)

Gets the account's call history (including call duration, cost, logs and other call information). You can filter the call history by a certain date.

_roles: Owner, Admin, Developer, Supervisor, Support_

**Returns:** 

- `application_id` — To receive the call history for a specific application, pass the application ID to this parameter. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `call_session_history_custom_data` — To filter the call history by the custom_data passed to the call sessions, pass the custom data to this parameter

- `call_session_history_id` — To get the call history for the specific sessions, pass the session IDs to this parameter separated by a semicolon (;). The maximum number of records is 1000. You can find the session ID in the <a href='/docs/references/voxengine/appevents#started'>AppEvents.Started</a> event's <b>sessionID</b> property in a scenario, or retrieve it from the <b>call_session_history_id</b> value returned from the <a href='https://voximplant.com/docs/references/httpapi/scenarios#reorderscenarios'>StartScenarios</a> or <a href='https://voximplant.com/docs/references/httpapi/scenarios#startconference'>StartConference</a> methods

- `child_account_id` — The child account ID list separated by semicolons (;)

- `children_calls_only` — Whether to get the children account calls only

- `count` — The number of returning records. The maximum value is 1000

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted, a server-configured default interval is used (default is one month)

- `is_async` — Whether to create an asynchronous history report instead of returning the data immediately. Has the same effect as calling GetCallHistoryAsync and requires the output=csv

- `local_number` — To receive a call history for a specific local numbers, pass the number list separated by semicolons (;). A local number is a number on the platform side

- `max_duration` — The maximum call duration in seconds to filter. You can restrict the allowed date range via duration filters

- `min_duration` — The minimum call duration in seconds to filter. You can restrict the allowed date range via duration filters

- `offset` — The number of records to skip in the output. The maximum value of 10000

- `remote_number` — To receive a call history for a specific remote numbers, pass the number list separated by semicolons (;). A remote number is a number on the client side. Ignored if the `remote_number_list` parameter is not empty

- `remote_number_list` — A JSON array of strings of specific remote phone numbers to sort the call history. Has higher priority than the `remote_number` parameter. If the array is empty, the `remote_number` parameter is used instead

- `rule_name` — To receive the call history for a specific routing rule, pass the rule name to this parameter. Applies only if you set application_id or application_name

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted, a server-configured default interval is used (default is one month)

- `user_id` — To receive the call history for a specific users, pass the user ID list separated by semicolons (;). If it is specified, the output contains the calls from the listed users only

- `with_calls` — Whether to receive a list of sessions with all calls within the sessions, including phone numbers, call cost and other information

- `with_header` — Whether to get a CSV file with the column names if the output=csv

- `with_other_resources` — Whether to get other resources usage (see [ResourceUsageType](/docs/references/httpapi/structure/resourceusagetype))

- `with_records` — Whether to get the calls' records

- `with_total_count` — Whether to include the 'total_count' and increase performance


## GetCallHistoryAsync  (api_method)

The [GetCallHistory](/docs/references/httpapi/history#getcallhistory) asynchronous implementation. Use this function to download a large amounts of data. Take a look at the [GetHistoryReports](/docs/references/httpapi/history#gethistoryreports) and [DownloadHistoryReport](/docs/references/httpapi/history#downloadhistoryreport) functions for downloading details.

_roles: Owner, Admin, Developer, Supervisor, Support_

**Returns:** 

- `application_id` — To receive the call history for a specific application, pass the application ID to this parameter. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `call_session_history_custom_data` — To filter the call history by the custom_data passed to the call sessions, pass the custom data to this parameter

- `call_session_history_id` — To get the call history for the specific sessions, pass the session IDs to this parameter separated by a semicolon (;). You can find the session ID in the <a href='/docs/references/voxengine/appevents#started'>AppEvents.Started</a> event's <b>sessionID</b> property in a scenario, or retrieve it from the <b>call_session_history_id</b> value returned from the <a href='https://voximplant.com/docs/references/httpapi/scenarios#reorderscenarios'>StartScenarios</a> or <a href='https://voximplant.com/docs/references/httpapi/scenarios#startconference'>StartConference</a> methods

- `child_account_id` — The child account ID list separated by semicolons (;)

- `children_calls_only` — Whether to get the children account calls only

- `count` — The maximum number of records to include in the report. If omitted, the report service applies its own limit. Unlike GetCallHistory, there is no default of 20 and no cap of 1000 on the Management API side

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted, a server-configured default interval is used (default is one month)

- `local_number` — To receive a call history for a specific local numbers, pass the number list separated by semicolons (;). A local number is a number on the platform side

- `max_duration` — The maximum call duration in seconds to filter. You can restrict the allowed date range via duration filters

- `min_duration` — The minimum call duration in seconds to filter. You can restrict the allowed date range via duration filters

- `offset` — The number of records to skip in the output

- `output` — The output format. The following values available: **csv**. The default value is **csv**

- `remote_number` — To receive a call history for a specific remote numbers, pass the number list separated by semicolons (;). A remote number is a number on the client side

- `remote_number_list` — A JSON-formatted list of strings containing phone numbers for history filtering. Has a higher priority than the <b>remote_number</b> parameter. If the array is empty, the <b>remote_number</b> parameter is used instead

- `rule_name` — To receive the call history for a specific routing rule, pass the rule name to this parameter. Applies only if you set application_id or application_name

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted, a server-configured default interval is used (default is one month)

- `user_id` — To receive the call history for a specific users, pass the user ID list separated by semicolons (;). If it is specified, the output contains the calls from the listed users only

- `with_calls` — Whether to receive a list of sessions with all calls within the sessions, including phone numbers, call cost and other information

- `with_header` — Whether to get a CSV file with the column names if the output=csv

- `with_other_resources` — Whether to get other resources usage (see [ResourceUsageType](/docs/references/httpapi/structure/resourceusagetype))

- `with_records` — Whether to get the calls' records


## GetHistoryReports  (api_method)

Gets the list of history reports and their statuses. The method returns info about the reports made via [GetCallHistoryAsync](/docs/references/httpapi/history#getcallhistoryasync), [GetTransactionHistoryAsync](/docs/references/httpapi/history#gettransactionhistoryasync), [GetAuditLogAsync](/docs/references/httpapi/history#getauditlogasync) and [GetBriefCallHistory](/docs/references/httpapi/history#getbriefcallhistory) asynchronous methods. Note that the **file_size** field in response is valid only for the video calls.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer_

**Returns:** 

- `application_id` — The application ID to filter. Can be a list separated by semicolons (;). Use the 'all' value to select all applications. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name list separated by semicolons (;). Can be used instead of the <b>application_id</b> parameter

- `count` — The maximum returning record count

- `created_from` — The UTC creation from date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `created_to` — The UTC creation to date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `desc_order` — Whether to get records in the descent order

- `history_report_id` — The history report ID to filter

- `history_type` — The history report type list separated by semicolons (;). Use the 'all' value to select all history report types. The following values are possible: calls, calls_brief, transactions, audit, call_list, transactions_on_hold

- `is_completed` — Whether the report is completed

- `offset` — The first <b>N</b> records are skipped in the output


## GetTransactionHistory  (api_method)

Gets the transaction history.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `application_id` — The application ID to filter. Can be used together with or instead of the <b>application_name</b> parameter

- `application_name` — The application name to filter. Can be used together with or instead of the <b>application_id</b> parameter

- `child_account_id` — The child account ID list separated by semicolons (;). Use the 'all' value to select all child accounts

- `children_transactions_only` — Whether to get the children account transactions only

- `count` — The number of returning records. The maximum value is 1000

- `decimal_separator` — The decimal mark for the CSV numbers if the output=csv. If omitted, the account locale setting is used

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted and is_uncommitted is false, a server-configured default interval is used (default is one month)

- `is_async` — Whether to create an asynchronous history report instead of returning the data immediately. Has the same effect as calling `GetTransactionHistoryAsync` and requires the output=csv

- `is_uncommitted` — Whether to get transactions on hold (transactions for which money is reserved but not yet withdrawn from the account)

- `offset` — The number of records to skip in the output with a maximum value of 10000

- `price_group_name` — The price group name list separated by semicolons (;) to filter

- `resource_type` — The resource type list separated by semicolons (;) to filter

- `subscription_id` — The subscription ID list separated by semicolons (;) to filter

- `subscription_name` — The subscription name list separated by semicolons (;) to filter

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted and is_uncommitted is false, a server-configured default interval is used (default is one month)

- `transaction_id` — The transaction ID list separated by semicolons (;)

- `transaction_type` — The transaction type list separated by semicolons (;). The following values are possible: gift_revoke, resource_charge, money_distribution, subscription_charge, subscription_installation_charge, card_periodic_payment, card_overrun_payment, card_payment, rub_card_periodic_payment, rub_card_overrun_payment, rub_card_payment, robokassa_payment, gift, promo, adjustment, wire_transfer, us_wire_transfer, refund, discount, mgp_charge, mgp_startup, mgp_business, mgp_big_business, mgp_enterprise, mgp_large_enterprise, techsupport_charge, tax_charge, monthly_fee_charge, grace_credit_payment, grace_credit_provision, mau_charge, mau_overrun, im_charge, im_overrun, fmc_charge, sip_registration_charge, development_fee, money_transfer_to_child, money_transfer_to_parent, money_acceptance_from_child, money_acceptance_from_parent, phone_number_installation, phone_number_charge, toll_free_phone_number_installation, toll_free_phone_number_charge, services, user_money_transfer, paypal_payment, paypal_overrun_payment, paypal_periodic_payment

- `use_accounting_dates` — Whether to filter by the accounting dates instead of the transaction's `performed_at` timestamps

- `user_id` — The user ID list separated by semicolons (;)

- `users_transactions_only` — Whether to get the users' transactions only

- `with_extended_info` — Whether to include the extended transaction fields, such as the application, subscription, resource type and price group, in the response

- `with_header` — Whether to get a CSV file with the column names if the output=csv

- `with_total_count` — Whether to include the 'total_count' and increase performance


## GetTransactionHistoryAsync  (api_method)

The [GetTransactionHistory](/docs/references/httpapi/history#gettransactionhistory) asynchronous implementation. Use this function to download a large amounts of data. Take a look at the [GetHistoryReports](/docs/references/httpapi/history#gethistoryreports) and [DownloadHistoryReport](/docs/references/httpapi/history#downloadhistoryreport) functions for downloading details.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `application_id` — The application ID to filter. Can be used together with or instead of the <b>application_name</b> parameter

- `application_name` — The application name to filter. Can be used together with or instead of the <b>application_id</b> parameter

- `child_account_id` — The child account ID list separated by semicolons (;). Use the 'all' value to select all child accounts

- `children_transactions_only` — Whether to get the children account transactions only

- `count` — The maximum number of records to include in the report. If omitted, the report service applies its own limit. Unlike GetTransactionHistory, there is no default of 20 and no cap of 1000 on the Management API side

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted and is_uncommitted is false, a server-configured default interval is used (default is one month)

- `is_uncommitted` — Whether to get transactions on hold (transactions for which money is reserved but not yet withdrawn from the account)

- `offset` — The number of records to skip in the output

- `output` — The output format. The following values available: **csv**. The default value is **csv**

- `price_group_name` — The price group name list separated by semicolons (;) to filter

- `resource_type` — The resource type list separated by semicolons (;) to filter

- `subscription_id` — The subscription ID list separated by semicolons (;) to filter

- `subscription_name` — The subscription name list separated by semicolons (;) to filter

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. If both dates are omitted and is_uncommitted is false, a server-configured default interval is used (default is one month)

- `transaction_id` — The transaction ID list separated by semicolons (;)

- `transaction_type` — The transaction type list separated by semicolons (;). The following values are possible: gift_revoke, resource_charge, money_distribution, subscription_charge, subscription_installation_charge, card_periodic_payment, card_overrun_payment, card_payment, rub_card_periodic_payment, rub_card_overrun_payment, rub_card_payment, robokassa_payment, gift, promo, adjustment, wire_transfer, us_wire_transfer, refund, discount, mgp_charge, mgp_startup, mgp_business, mgp_big_business, mgp_enterprise, mgp_large_enterprise, techsupport_charge, tax_charge, monthly_fee_charge, grace_credit_payment, grace_credit_provision, mau_charge, mau_overrun, im_charge, im_overrun, fmc_charge, sip_registration_charge, development_fee, money_transfer_to_child, money_transfer_to_parent, money_acceptance_from_child, money_acceptance_from_parent, phone_number_installation, phone_number_charge, toll_free_phone_number_installation, toll_free_phone_number_charge, services, user_money_transfer, paypal_payment, paypal_overrun_payment, paypal_periodic_payment

- `use_accounting_dates` — Whether to filter by the accounting dates instead of the transaction's `performed_at` timestamps

- `user_id` — The user ID list separated by semicolons (;)

- `users_transactions_only` — Whether to get the users' transactions only

- `with_header` — Whether to get a CSV file with the column names if the output=csv
