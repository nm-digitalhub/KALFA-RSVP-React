# Queues  (ref_folder)


## AddQueue  (api_method)

Adds a new ACD queue.

_roles: Owner, Admin, Developer_

**Returns:** 

- `acd_queue_name` — The queue name. The length should be less than 100

- `acd_queue_priority` — The integer queue priority. The highest priority is 0

- `application_id` — The application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `auto_binding` — Whether to enable the auto binding of operators to a queue by skills comparing

- `average_service_time` — The average service time in seconds. Specify the parameter to correct or initialize the waiting time prediction

- `max_queue_size` — The maximum queue size

- `max_waiting_time` — The maximum predicted waiting time in minutes. The client is rejected if the predicted waiting time is greater than the maximum predicted waiting time

- `service_probability` — The value in the range of [0.5 ... 1.0]. The value 1.0 means the service probability 100% in challenge with a lower priority queue


## BindUserToQueue  (api_method)

Bind/unbind users to/from the specified ACD queues. Note that users and queues should be already bound to the same application.

_roles: Owner, Admin, Developer, User manager_

**Returns:** 

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). Use the 'all' value to specify all queues bound to the application. <b>Required</b> unless <b>acd_queue_name</b> is provided.

- `acd_queue_name` — The queue name. The queue name list separated by semicolons (;). <b>Required</b> unless <b>acd_queue_id</b> is provided.

- `application_id` — The application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `bind` — Whether to bind or unbind users

- `user_id` — The user ID list separated by semicolons (;). Use the 'all' value to specify all users bound to the application. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — The user name list separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## DelQueue  (api_method)

Deletes the ACD queue.

_roles: Owner, Admin, Developer_

**Returns:** 

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). <b>Required</b> unless <b>acd_queue_name</b> is provided.

- `acd_queue_name` — The ACD queue name. The ACD queue name list separated by semicolons (;). <b>Required</b> unless <b>acd_queue_id</b> is provided.


## GetACDOperatorStatistics  (api_method)

Get statistics for calls distributed to users (referred as 'operators') via the 'ACD' module. This method can filter statistic based on operator ids, queue ids and date-time interval. It can also group results by day or hour.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `abbreviation` — Whether key names in returned JSON are abbreviated to reduce response byte size. The abbreviations are: 'SA' for 'SpeedOfAnswer', 'HT' for 'HandlingTime', 'TT' for 'TalkTime', 'ACW' for 'AfterCallWork', 'TDT' for 'TotalDialingTime', 'THT' for 'TotalHandlingTime', 'TTT' for 'TotalTalkTime', 'TACW' for 'TotalAfterCallWork', 'AC' for 'AnsweredCalls', 'UAC' for 'UnansweredCalls'

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). Use the 'all' value to select all ACD queues

- `aggregation` — Specifies how records are grouped by date and time. If set to 'day', the criteria is a day number. If set to 'hour_of_day', the criteria is a 60-minute interval within a day. If set to 'hour', the criteria is both day number and 60-minute interval within that day. If set to 'none', records are not grouped by date and time

- `from_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'

- `group` — If set to 'user', first-level array in the resulting JSON groups records by the user ID, and second-level array groups them by date according to the 'aggregation' parameter. If set to 'aggregation', first-level array in the resulting JSON groups records according to the 'aggregation' parameter, and second-level array groups them by the user ID

- `report` — List of item names abbreviations separated by semicolons (;). Returned JSON includes keys only for the selected items. Special 'all' value defines all possible items, see [ACDOperatorStatisticsType](/docs/references/httpapi/structure/acdoperatorstatisticstype) for a complete list. See 'abbreviation' description for complete abbreviation list

- `to_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'

- `user_id` — The user ID list separated by semicolons (;). Use the 'all' value to select all users


## GetACDOperatorStatusStatistics  (api_method)

Get statistics for the specified operators and ACD statuses. This method can filter statistics by operator ids and statuses. It can also group results by day/hour or users.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `acd_status` — The ACD status list separated by semicolons (;). The following values are possible: OFFLINE, ONLINE, READY, BANNED, IN_SERVICE, AFTER_SERVICE, TIMEOUT, DND. If omitted, the statistics include all the statuses

- `aggregation` — Specifies how records are grouped by date and time. If set to 'day', the criteria is a day number. If set to 'hour_of_day', the criteria is a 60-minute interval within a day. If set to 'hour', the criteria is both day number and 60-minute interval within that day. If set to 'none', records are not grouped by date and time

- `from_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'

- `group` — If set to 'user', first-level array in the resulting JSON groups records by the user ID, and second-level array groups them by date according to the 'aggregation' parameter. If set to 'aggregation', first-level array in the resulting JSON groups records according to the 'aggregation' parameter, and second-level array groups them by the user ID

- `to_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'

- `user_id` — The user ID list separated by semicolons (;). Use the 'all' value to select all users


## GetACDQueueStatistics  (api_method)

Get statistics for calls distributed to users (referred as 'operators') via the 'queue' distribution system. This method can filter statistic based on operator ids, queue ids and date-time interval. It can also group results by day or hour.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `abbreviation` — Whether key names in returned JSON are abbreviated to reduce response byte size. The abbreviations are: 'WT' for 'WaitingTime', 'SA' for 'SpeedOfAnswer', 'AT' is for 'AbandonmentTime', 'HT' is for 'HandlingTime', 'TT' is for 'TalkTime', 'ACW' is for 'AfterCallWork', 'QL' is for 'QueueLength', 'TC' is for 'TotalCalls', 'AC' is for 'AnsweredCalls', 'UAC' is for 'UnansweredCalls', 'RC' is for 'RejectedCalls', 'SL' is for 'ServiceLevel', 'TWT' is for 'TotalWaitingTime', 'TST' is for 'TotalSubmissionTime', 'TAT' is for 'TotalAbandonmentTime', 'THT' is for 'TotalHandlingTime', 'TTT' is for 'TotalTalkTime', 'TACW' is for 'TotalAfterCallWork'

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). Use the 'all' value to select all ACD queues

- `aggregation` — Specifies how records are grouped by date and time. If set to 'day', the criteria is a day number. If set to 'hour_of_day', the criteria is a 60-minute interval within a day. If set to 'hour', the criteria is both day number and 60-minute interval within that day. If set to 'none', records are not grouped by date and time

- `from_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'

- `report` — List of item names abbreviations separated by semicolons (;). Returned JSON includes keys only for the selected items. Special 'all' value defines all possible items, see [ACDQueueStatisticsType](/docs/references/httpapi/structure/acdqueuestatisticstype) for a complete list. See 'abbreviation' description for complete abbreviation list

- `to_date` — Date and time of statistics interval begin. Time zone is UTC, format is 24-h 'YYYY-MM-DD HH:mm:ss'


## GetACDState  (api_method)

Gets the current ACD queue state.

_roles: Owner, Admin, Developer_

**Returns:** 

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). Use the 'all' value to select all ACD queues


## GetQueues  (api_method)

Gets the ACD queues.

_roles: Owner, Admin, Developer, Supervisor_

**Returns:** 

- `acd_queue_id` — The ACD queue ID to filter

- `acd_queue_name` — The ACD queue name part to filter

- `application_id` — The application ID to filter. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `count` — The maximum returning record count

- `excluded_skill_id` — The excluded skill ID to filter. Can be used instead of the <b>excluded_skill_name</b> parameter

- `excluded_skill_name` — The excluded skill name. Can be used instead of the <b>excluded_skill_id</b> parameter

- `offset` — The first <b>N</b> records are skipped in the output

- `show_deleted` — Whether to include the deleted queues

- `showing_skill_id` — The skill to show in the 'skills' field output

- `skill_id` — The skill ID to filter. Can be used instead of the <b>skill_name</b> parameter

- `skill_name` — The skill name. Can be used instead of the <b>skill_id</b> parameter

- `with_operatorcount` — Whether to include the number of agents bound to the queue

- `with_skills` — Whether to get the bound skills


## SetQueueInfo  (api_method)

Edits the ACD queue.

**Returns:** 

- `acd_queue_id` — The ACD queue ID. <b>Required</b> unless <b>acd_queue_name</b> is provided.

- `acd_queue_name` — The ACD queue name. <b>Required</b> unless <b>acd_queue_id</b> is provided.

- `acd_queue_priority` — The integer queue priority. The highest priority is 0

- `application_id` — The new application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The new application name. Can be used instead of the <b>application_id</b> parameter

- `auto_binding` — Whether to enable the auto binding of operators to a queue by skills comparing

- `average_service_time` — The average service time in seconds. Specify the parameter to correct or initialize the waiting time prediction

- `max_queue_size` — The maximum queue size

- `max_waiting_time` — The maximum predicted waiting time in minutes. The client is rejected if the predicted waiting time is greater than the maximum predicted waiting time

- `new_acd_queue_name` — The new queue name. The length should be less than 100

- `service_probability` — The value in the range of [0.5 ... 1.0]. The value 1.0 means the service probability 100% in challenge with a lower priority queue
