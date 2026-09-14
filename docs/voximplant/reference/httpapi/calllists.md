# CallLists  (ref_folder)


## AppendToCallList  (api_method)

Appends a new task to the existing call list.<br>This method accepts CSV files with custom delimiters, such a commas (,), semicolons (;) and other. To specify a delimiter, pass it to the <b>delimiter</b> parameter.<br><br>You can specify a custom call schedule for every record. Refer to the <a href="/docs/guides/solutions/call-lists">Call lists guide</a> for more information.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `delimiter` — Separator values. The default value is ';'

- `encoding` — Encoding file. The default value is UTF-8

- `escape` — Escape character for parsing csv

- `file_content` — Send as the request body or multiform. Refer to the <a href="https://voximplant.com/docs/guides/solutions/call-lists#csv-table-setup">Call lists guide</a> to learn about file syntax

- `list_id` — Call list ID. <b>Required</b> unless <b>list_name</b> is provided.

- `quote` — Quote character for parsing csv


## CancelCallListBatch  (api_method)

Cancels all tasks in the call list with the specified batch UUID.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `batch_ids` — Batch UUIDs of the tasks to cancel, separated by semicolon (;)

- `list_id` — Call list ID


## CancelCallListTask  (api_method)

Cancels the specified tasks in the call list by their IDs or UUIDs. The maximum number of tasks to cancel is 1000.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `account_id` — Account's ID

- `list_id` — Call list's ID

- `tasks_ids` — Task IDs separated by a semicolon. Specify either `tasks_ids` or `tasks_uuids`. The method returns an error if none of the parameters is specified

- `tasks_uuids` — Task UUIDs separated by a semicolon. Specify either `tasks_ids` or `tasks_uuids`. The method returns an error if none of the parameters is specified


## CreateCallList  (api_method)

Adds a new CSV file for call list processing and starts the specified rule immediately. To send a file, use the request body. To set the call time constraints, use the following options in a CSV file: <ul><li>**__start_execution_time** – when the call list processing starts every day, UTC+0 24-h format: HH:mm:ss</li><li>**__end_execution_time** – when the call list processing stops every day,  UTC+0 24-h format: HH:mm:ss</li><li>**__start_at** – when the call list processing starts, UNIX timestamp. If not specified, the processing starts immediately after a method call</li><li>**__task_uuid** – call list UUID. A string up to 40 characters, can contain latin letters, digits, hyphens (-) and colons (:). Unique within the call list</li></ul><br>This method accepts CSV files with custom delimiters, such a commas (,), semicolons (;) and other. To specify a delimiter, pass it to the <b>delimiter</b> parameter.<br/><b>IMPORTANT:</b> the account's balance should be equal or greater than 1 USD. If the balance is lower than 1 USD, the call list processing does not start, or it stops immediately if it is active.<br><br>You can specify a custom call schedule for every record. Refer to the <a href="/docs/guides/solutions/call-lists">Call lists guide</a> for more information.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `acd_version` — The ACD version. The possible values are: V1, V2. Applies only if <b>call_list_type</b> is predictive or progressive

- `avg_dial_time_sec` — The initial average dial time in seconds for the dialing statistics. Applies only if <b>call_list_type</b> is predictive or progressive

- `avg_time_talk_sec` — The initial average talk time in seconds for the dialing statistics. Applies only if <b>call_list_type</b> is predictive or progressive

- `avg_total_time_sec` — The initial average total call time in seconds for the dialing statistics. Applies only if <b>call_list_type</b> is predictive or progressive

- `buffer_size_target` — The PDS buffer size target. The possible values are: VALUE, OPERATOR, AGENT. Applies only if <b>call_list_type</b> is predictive or progressive

- `buffer_size_value` — The PDS buffer size, from 20 to 500. Applies only if <b>buffer_size_target</b> is VALUE

- `buffer_threshold_factor` — The PDS buffer threshold factor. Cannot be negative. Applies only if <b>buffer_size_target</b> is specified

- `call_list_type` — Call list type. The possible values are: automatic, predictive, progressive. The value is case-insensitive

- `delimiter` — Separator values. The default value is ';'

- `encoding` — Encoding file. The default value is UTF-8

- `escape` — Escape character for parsing csv

- `file_content` — Send as the "body" part of the HTTP request or as multiform. The sending "file_content" via URL is at its own risk because the network devices tend to drop HTTP requests with large headers. Refer to the <a href="https://voximplant.com/docs/guides/solutions/call-lists#csv-table-setup">Call lists guide</a> to learn about file syntax

- `interval_seconds` — Interval between call attempts in seconds. The default value is 0

- `ip_address` — IP from the geolocation of the call list subscribers. It allows selecting the nearest server for serving subscribers. If not specified, the client IP of the request is used

- `is_cancelled` — Whether to create the call list in the cancelled state

- `is_personal_campaign` — Whether the call list is a personal campaign. Applies only if <b>call_list_type</b> is progressive

- `list_custom_data` — Custom data string for the call list

- `max_simultaneous` — Number of simultaneously processed tasks

- `maximum_error_rate` — The maximum abandoned call rate for predictive dialing, from 0 to 1. Applies only if <b>call_list_type</b> is predictive or progressive

- `minimum_busy_factor` — The minimum agent busy factor for predictive dialing, from 0 to 1. Applies only if <b>call_list_type</b> is predictive or progressive

- `name` — File name, up to 255 characters and cannot contain the '/' and '\' symbols

- `num_attempts` — Number of attempts. Minimum is <b>1</b>, maximum is <b>5</b>

- `percent_successful` — The initial successful call ratio for the dialing statistics. Applies only if <b>call_list_type</b> is predictive or progressive

- `personal_campaign_type` — The personal campaign mode. The possible values are: smart, strict. Allowed only if <b>is_personal_campaign</b> is true; the default value in that case is smart

- `predictive_type` — The predictive dialing algorithm. The possible values are: DEFAULT_PREDICTIVE_TYPE, AR_OPTIMIZED, BF_OPTIMIZED, AR_SMALL_GROUP, AR_AUTO_BALANCED. Applies only if <b>call_list_type</b> is predictive

- `priority` — Call list priority. The value is in the range of [0 ... 2^31] where zero is the highest priority

- `queue_id` — The ACD queue ID. <b>Required</b> if <b>call_list_type</b> is predictive or progressive, and should be omitted otherwise

- `quote` — Quote character for parsing csv

- `rule_id` — Rule ID. It is specified in the <a href='//manage.voximplant.com/applications'>Applications</a> section of the Control Panel

- `server_location` — Location of the server where the scenario needs to be executed. Has higher priority than `ip_address`. Request [getServerLocations](https://api.voximplant.com/getServerLocations) for possible values

- `start_at` — Time when the call list should start, as a Unix timestamp in seconds (UTC). The default value is the current time. The value cannot be in the past

- `task_multiplier` — The task multiplier for progressive dialing. The minimum value is 1. Applies only if <b>call_list_type</b> is progressive

- `task_priority_strategy` — Optional. Whether to prioritize first calling attempts or repeated ones. The possible values are: first_attempts, repeated_attempts. The default values is first_attempts.


## DeleteCallList  (api_method)

Deletes an existing call list by its ID.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `account_id` — Account's ID

- `list_id` — Call list's ID to delete


## EditCallList  (api_method)

Edits the specified call list by its ID.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `avg_dial_time_sec` — The average dial time in seconds for the dialing statistics. Cannot be negative

- `avg_time_talk_sec` — The average talk time in seconds for the dialing statistics. Cannot be negative

- `avg_total_time_sec` — The average total call time in seconds for the dialing statistics. Cannot be negative

- `call_list_type` — Call list type. The possible values are: automatic, manual, predictive, progressive. The value is case-insensitive

- `call_type` — Alias for <b>call_list_type</b>. Applies only if <b>call_list_type</b> is not specified

- `interval_seconds` — Minimum interval between call attempts. Cannot be a negative value

- `ip_address` — IP address in the `Inet4Address` format

- `is_personal_campaign` — Whether the call list is a personal campaign. <b>Required</b> if <b>personal_campaign_type</b> is specified

- `list_custom_data` — Custom data string for the call list

- `list_id` — Call list ID. If the ID is non existing, the 251 error returns

- `max_simultaneous` — Maximum simultaneous call attempts for this call list. Cannot be less than 1

- `maximum_error_rate` — The maximum abandoned call rate for predictive dialing, from 0 to 1. If omitted while <b>call_list_type</b> is set to predictive, the value becomes 0.02

- `minimum_busy_factor` — The minimum agent busy factor for predictive dialing. Cannot be negative. If omitted while <b>call_list_type</b> is set to predictive, the value becomes 0.8

- `name` — Call list name. Cannot be bigger than 255 characters, cannot contain slash symbol

- `num_attempts` — Maximum call attempt number. Cannot be less than 1

- `percent_successful` — The successful call ratio for the dialing statistics. Cannot be negative

- `personal_campaign_type` — The personal campaign mode. The possible values are: smart, strict. Allowed only if <b>is_personal_campaign</b> is true; the default value in that case is smart

- `predictive_type` — The predictive dialing algorithm. The possible values are: AR_OPTIMIZED, BF_OPTIMIZED, AR_SMALL_GROUP, AR_AUTO_BALANCED. If omitted while <b>call_list_type</b> is set to predictive, the value becomes AR_OPTIMIZED; for progressive the value is reset

- `priority` — Call list's priority among other call list. The lower the value, the higher is the call list's priority

- `server_location` — Location of the server processing the call list. If the ID is non existing, the 496 error returns: The 'server_location' parameter is invalid.

- `start_at` — Time when the call list should start, as a Unix timestamp in seconds (UTC)

- `task_multiplier` — The task multiplier for progressive dialing. Cannot be negative. If omitted while <b>call_list_type</b> is set to progressive, the value becomes 1

- `task_priority_strategy` — Optional. Whether to prioritize first calling attempts or repeated ones. The possible values are: first_attempts, repeated_attempts. The default values is first_attempts


## EditCallListTask  (api_method)

Edits the specified call list's task.

_roles: Owner, Admin, Developer, Call list manager, Support_

**Returns:** 

- `attempts_left` — Number of remaining calling attempts

- `call_schedule` — Call list schedule in the JSON format. Refer to the <a href="/docs/guides/solutions/call-lists">Call lists guide</a> for more information.

- `custom_data` — Custom data string

- `list_id` — Call list's ID

- `max_execution_time` — Optional. End time for the daily calling attempts in the UTC+0 24-h format: HH:mm:ss format. If spefied, please specify `min_execution_time` as well

- `min_execution_time` — Optional. Start time for the daily calling attempts in the UTC+0 24-h format: HH:mm:ss format. If spefied, please specify `max_execution_time` as well

- `next_attempt_time` — Time of the next calling attempt. One of the editable fields: at least one of them should be specified

- `skill_id` — The skill ID list separated by semicolons (;). Up to 5 IDs. One of the editable fields: at least one of them should be specified

- `start_at` — Next calling attempts timestamp in the yyyy-MM-dd HH:mm:ss format

- `task_id` — Call list's task ID. Please specify either the task's ID or the task's UUID to edit the task

- `task_uuid` — Call list's task ID. Please specify either the task's ID or the task's UUID to edit the task. The UUID is unique within the call list

- `user_id` — The user ID to bind to the task. One of the editable fields: at least one of them should be specified


## EditCallListTasksPriority  (api_method)

Edits priorities of existing tasks in the specified call list.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `list_id` — Call list ID. If the ID does not exist, the 251 error returns.

- `tasks` — JSON-encoded array of task objects. Each object should contain either 'task_id' (number) or 'task_uuid' (string), and 'task_priority' (number).


## GetCallListDetails  (api_method)

Gets details of the specified call list. Returns a CSV file by default.

_roles: Owner, Admin, Developer, Call list manager, sys.Admin read only_

**Returns:** 

- `batch_id` — Batch UUID to filter the tasks

- `count` — Maximum number of entries in the result. If <b>output</b> is json, the default and maximum value is 1000; for csv and xls no limit is applied unless the parameter is specified

- `delimiter` — Separator values. The default value is ';'

- `encoding` — Encoding of the output file. Default UTF-8

- `is_async` — Whether to create an asynchronous report instead of returning the data immediately. Requires <b>output</b> to be csv or xls

- `list_id` — The list ID

- `new_csv_style` — Whether to use the new csv layout. Applies to asynchronous reports; for xls the value is always true

- `offset` — The first <b>N</b> records are skipped in the output

- `output` — The output format. The following values available: **json**, **csv**, **xls**. The default value is **csv**


## GetCallLists  (api_method)

Get all call lists for the specified user.

_roles: Owner, Admin, Developer, Supervisor, Call list manager, Support_

**Returns:** 

- `application_id` — The application ID to filter. Can be a list separated by semicolons (;). Use the 'all' value to select all applications. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name list separated by semicolons (;). Can be used instead of the <b>application_id</b> parameter

- `count` — The maximum returning record count. The maximum value is 1000

- `from_date` — The UTC 'from' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `is_active` — Whether to find only active call lists

- `list_id` — The list ID to filter. Can be a list separated by semicolons (;). Use the 'all' value to select all lists

- `name` — Find call lists by name

- `offset` — The first <b>N</b> records are skipped in the output

- `rule_id` — The rule ID to filter. Can be a list separated by semicolons (;). Use the 'all' value to select all rules. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name list separated by semicolons (;). Can be used instead of the <b>rule_id</b> parameter

- `status` — The call list status to filter. The possible values are: In progress, Canceled, Completed, Suspended

- `to_date` — The UTC 'to' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `type_list` — The type of the call list. The possible values are AUTOMATIC and MANUAL


## RecoverCallList  (api_method)

Resume processing the specified call list.

_roles: Owner, Admin, Developer, Call list manager_

**Returns:** 

- `list_id` — The list Id


## StopCallListProcessing  (api_method)

Stops processing the specified call list.

_roles: Owner, Admin, Developer, Call list manager, Support_

**Returns:** 

- `list_id` — The list Id
