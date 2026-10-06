# SmartQueue  (ref_folder)


## GetSmartQueueDayHistory  (api_method)

Gets the metrics for the specified SmartQueue for the last 2 days. Refer to the <a href="/docs/guides/contact-center/reporting">SmartQueue reporting guide</a> to learn more.

**Returns:** 

- `application_id` — The application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `decimal_separator` — The decimal mark for CSV numbers: a dot or a comma. If omitted, the account setting is used

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time minus 1 day

- `group_by` — Group the result by **agent** or *queue*. The **agent** grouping is allowed only for 1 queue and for the occupancy_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_banned_time, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types. The **queue** grouping allowed for the calls_blocked_percentage, count_blocked_calls, average_abandonment_rate, count_abandonment_calls, service_level, occupancy_rate, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types

- `interval` — Interval format: YYYY-MM-DD HH:mm:ss. Default is 1 day

- `max_waiting_sec` — Maximum waiting time. Required for the **service_level** report type

- `omit_empty` — Whether to omit the empty metric values from the result

- `report_type` — The report type. Possible values are: calls_blocked_percentage, count_blocked_calls, im_blocked_chats_percentage, im_count_blocked_chats, im_answered_chats_rate, average_abandonment_rate, count_abandonment_calls, service_level, im_service_level, occupancy_rate, im_agent_occupancy_rate, agent_utilization_rate, im_agent_utilization_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_in_service_incoming_time, sum_agents_in_service_outcoming_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_custom_1_time, sum_agents_custom_2_time, sum_agents_custom_3_time, sum_agents_custom_4_time, sum_agents_custom_5_time, sum_agents_custom_6_time, sum_agents_custom_7_time, sum_agents_custom_8_time, sum_agents_custom_9_time, sum_agents_custom_10_time, sum_agents_banned_time, im_sum_agents_online_time, im_sum_agents_ready_time, im_sum_agents_in_service_time, im_sum_agents_dnd_time, im_sum_agents_custom_1_time, im_sum_agents_custom_2_time, im_sum_agents_custom_3_time, im_sum_agents_custom_4_time, im_sum_agents_custom_5_time, im_sum_agents_custom_6_time, im_sum_agents_custom_7_time, im_sum_agents_custom_8_time, im_sum_agents_custom_9_time, im_sum_agents_custom_10_time, im_sum_agents_banned_time, average_agents_idle_time, max_agents_idle_time, min_agents_idle_time, percentile_0_25_agents_idle_time, percentile_0_50_agents_idle_time, percentile_0_75_agents_idle_time, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, im_min_answer_speed, im_max_answer_speed, im_average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime, count_agent_unanswered_calls, im_count_agent_unanswered_chats, min_reaction_time, max_reaction_time, average_reaction_time, im_min_reaction_time, im_max_reaction_time, im_average_reaction_time, im_count_abandonment_chats, im_count_lost_chats, im_lost_chats_rate, call_count_assigned_to_queue, im_count_assigned_to_queue

- `sq_queue_id` — The SmartQueue ID list with a maximum of 5 values separated by semicolons (;). Can operate as filter for the **calls_blocked_percentage**, **count_blocked_calls**, **average_abandonment_rate**, **count_abandonment_calls**, **service_level**, **occupancy_rate**, **min_time_in_queue**, **max_time_in_queue**, **average_time_in_queue**, **min_answer_speed**, **max_answer_speed**, **average_answer_speed**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. <b>Required</b> unless <b>sq_queue_name</b> is provided or all the requested report types are agent reports.

- `sq_queue_name` — The SmartQueue name list separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided or all the requested report types are agent reports.

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time

- `user_id` — The user ID list with a maximum of 5 values separated by semicolons (;). Use the 'all' value to select all users. Can operate as a filter for the **occupancy_rate**, **sum_agents_online_time**, **sum_agents_ready_time**, **sum_agents_dialing_time**, **sum_agents_in_service_time**, **sum_agents_afterservice_time**, **sum_agents_dnd_time**, **sum_agents_banned_time**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name list separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## GetSmartQueueRealtimeMetrics  (api_method)

Gets the metrics for the specified SmartQueue for the last 30 minutes. Refer to the <a href="/docs/guides/contact-center/reporting">SmartQueue reporting guide</a> to learn more.

**Returns:** 

- `application_id` — The application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `decimal_separator` — The decimal mark for CSV numbers: a dot or a comma. If omitted, the account setting is used

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time minus 30 minutes

- `group_by` — Group the result by **agent** or *queue*. The **agent** grouping is allowed for 1 queue and for the occupancy_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_banned_time, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types. The **queue** grouping allowed for the calls_blocked_percentage, count_blocked_calls, average_abandonment_rate, count_abandonment_calls, service_level, occupancy_rate, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types

- `interval` — Interval format: YYYY-MM-DD HH:mm:ss. Default is 30 minutes

- `max_waiting_sec` — Maximum waiting time. Required for the **service_level** report type

- `omit_empty` — Whether to omit the empty metric values from the result

- `report_type` — The report type. Possible values are: calls_blocked_percentage, count_blocked_calls, im_blocked_chats_percentage, im_count_blocked_chats, im_answered_chats_rate, average_abandonment_rate, count_abandonment_calls, service_level, im_service_level, occupancy_rate, im_agent_occupancy_rate, agent_utilization_rate, im_agent_utilization_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_in_service_incoming_time, sum_agents_in_service_outcoming_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_custom_1_time, sum_agents_custom_2_time, sum_agents_custom_3_time, sum_agents_custom_4_time, sum_agents_custom_5_time, sum_agents_custom_6_time, sum_agents_custom_7_time, sum_agents_custom_8_time, sum_agents_custom_9_time, sum_agents_custom_10_time, sum_agents_banned_time, im_sum_agents_online_time, im_sum_agents_ready_time, im_sum_agents_in_service_time, im_sum_agents_dnd_time, im_sum_agents_custom_1_time, im_sum_agents_custom_2_time, im_sum_agents_custom_3_time, im_sum_agents_custom_4_time, im_sum_agents_custom_5_time, im_sum_agents_custom_6_time, im_sum_agents_custom_7_time, im_sum_agents_custom_8_time, im_sum_agents_custom_9_time, im_sum_agents_custom_10_time, im_sum_agents_banned_time, average_agents_idle_time, max_agents_idle_time, min_agents_idle_time, percentile_0_25_agents_idle_time, percentile_0_50_agents_idle_time, percentile_0_75_agents_idle_time, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, im_min_answer_speed, im_max_answer_speed, im_average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime, count_agent_unanswered_calls, im_count_agent_unanswered_chats, min_reaction_time, max_reaction_time, average_reaction_time, im_min_reaction_time, im_max_reaction_time, im_average_reaction_time, im_count_abandonment_chats, im_count_lost_chats, im_lost_chats_rate, call_count_assigned_to_queue, im_count_assigned_to_queue

- `sq_queue_id` — The SmartQueue ID list with a maximum of 5 values separated by semicolons (;). Can operate as filter for the **calls_blocked_percentage**, **count_blocked_calls**, **average_abandonment_rate**, **count_abandonment_calls**, **service_level**, **occupancy_rate**, **min_time_in_queue**, **max_time_in_queue**, **average_time_in_queue**, **min_answer_speed**, **max_answer_speed**, **average_answer_speed**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. <b>Required</b> unless <b>sq_queue_name</b> is provided or all the requested report types are agent reports.

- `sq_queue_name` — The SmartQueue name list separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided or all the requested report types are agent reports.

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time

- `user_id` — The user ID list with a maximum of 5 values separated by semicolons (;). Use the 'all' value to select all users. Can operate as a filter for the **occupancy_rate**, **sum_agents_online_time**, **sum_agents_ready_time**, **sum_agents_dialing_time**, **sum_agents_in_service_time**, **sum_agents_afterservice_time**, **sum_agents_dnd_time**, **sum_agents_banned_time**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name list separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## GetSQState  (api_method)

Gets the current state of the specified SmartQueue.

**Returns:** 

- `application_id` — The application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_queue_id` — The SmartQueue ID list separated by semicolons (;). Use the 'all' value to select all SmartQueues. <b>Required</b> unless <b>sq_queue_name</b> is provided.

- `sq_queue_name` — The SmartQueue name list separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided.

- `timezone` — The selected timezone or the 'auto' value (the account location)


## RequestSmartQueueHistory  (api_method)

Gets history for the specified SmartQueue. Refer to the <a href="/docs/guides/contact-center/reporting">SmartQueue reporting guide</a> to learn more.

**Returns:** 

- `application_id` — The application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `decimal_separator` — The decimal mark for CSV numbers: a dot or a comma. If omitted, the account setting is used

- `desc_order` — Whether to get records in the descent order

- `from_date` — The from date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time minus 1 day

- `group_by` — Group the result by **agent** or *queue*. The **agent** grouping is allowed only for 1 queue and for the occupancy_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_banned_time, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types. The **queue** grouping allowed for the calls_blocked_percentage, count_blocked_calls, average_abandonment_rate, count_abandonment_calls, service_level, occupancy_rate, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime report types

- `interval` — Interval format: YYYY-MM-DD HH:mm:ss. Default is 1 day

- `max_waiting_sec` — Maximum waiting time. Required for the **service_level** report type

- `omit_empty` — Whether to omit the empty metric values from the result

- `report_type` — The report type. Possible values are: calls_blocked_percentage, count_blocked_calls, im_blocked_chats_percentage, im_count_blocked_chats, im_answered_chats_rate, average_abandonment_rate, count_abandonment_calls, service_level, im_service_level, occupancy_rate, im_agent_occupancy_rate, agent_utilization_rate, im_agent_utilization_rate, sum_agents_online_time, sum_agents_ready_time, sum_agents_dialing_time, sum_agents_in_service_time, sum_agents_in_service_incoming_time, sum_agents_in_service_outcoming_time, sum_agents_afterservice_time, sum_agents_dnd_time, sum_agents_custom_1_time, sum_agents_custom_2_time, sum_agents_custom_3_time, sum_agents_custom_4_time, sum_agents_custom_5_time, sum_agents_custom_6_time, sum_agents_custom_7_time, sum_agents_custom_8_time, sum_agents_custom_9_time, sum_agents_custom_10_time, sum_agents_banned_time, im_sum_agents_online_time, im_sum_agents_ready_time, im_sum_agents_in_service_time, im_sum_agents_dnd_time, im_sum_agents_custom_1_time, im_sum_agents_custom_2_time, im_sum_agents_custom_3_time, im_sum_agents_custom_4_time, im_sum_agents_custom_5_time, im_sum_agents_custom_6_time, im_sum_agents_custom_7_time, im_sum_agents_custom_8_time, im_sum_agents_custom_9_time, im_sum_agents_custom_10_time, im_sum_agents_banned_time, average_agents_idle_time, max_agents_idle_time, min_agents_idle_time, percentile_0_25_agents_idle_time, percentile_0_50_agents_idle_time, percentile_0_75_agents_idle_time, min_time_in_queue, max_time_in_queue, average_time_in_queue, min_answer_speed, max_answer_speed, average_answer_speed, im_min_answer_speed, im_max_answer_speed, im_average_answer_speed, min_handle_time, max_handle_time, average_handle_time, count_handled_calls, min_after_call_worktime, max_after_call_worktime, average_after_call_worktime, count_agent_unanswered_calls, im_count_agent_unanswered_chats, min_reaction_time, max_reaction_time, average_reaction_time, im_min_reaction_time, im_max_reaction_time, im_average_reaction_time, im_count_abandonment_chats, im_count_lost_chats, im_lost_chats_rate, call_count_assigned_to_queue, im_count_assigned_to_queue

- `sq_queue_id` — The SmartQueue ID list with a maximum of 5 values separated by semicolons (;). Can operate as filter for the **calls_blocked_percentage**, **count_blocked_calls**, **average_abandonment_rate**, **count_abandonment_calls**, **service_level**, **occupancy_rate**, **min_time_in_queue**, **max_time_in_queue**, **average_time_in_queue**, **min_answer_speed**, **max_answer_speed**, **average_answer_speed**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. <b>Required</b> unless <b>sq_queue_name</b> is provided or all the requested report types are agent reports.

- `sq_queue_name` — The SmartQueue name list separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided or all the requested report types are agent reports.

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — The to date in the selected timezone in 24-h format: YYYY-MM-DD HH:mm:ss. Default is the current time

- `user_id` — The user ID list with a maximum of 5 values separated by semicolons (;). Use the 'all' value to select all users. Can operate as a filter for the **occupancy_rate**, **sum_agents_online_time**, **sum_agents_ready_time**, **sum_agents_dialing_time**, **sum_agents_in_service_time**, **sum_agents_afterservice_time**, **sum_agents_dnd_time**, **sum_agents_banned_time**, **min_handle_time**, **max_handle_time**, **average_handle_time**, **count_handled_calls**, **min_after_call_worktime**, **max_after_call_worktime**, **average_after_call_worktime** report types. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name list separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter

- `with_header` — Whether to get a CSV file with the column names if the output=csv


## SQ_AddQueue  (api_method)

Adds a new queue.

**Returns:** 

- `application_id` — Application ID to bind to. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to bind to. <b>Required</b> unless <b>application_id</b> is provided.

- `call_agent_selection` — Agent selection strategy for calls. Accepts one of the following values: "MOST_QUALIFIED", "LEAST_QUALIFIED", "MAX_WAITING_TIME"

- `call_max_queue_size` — Maximum size of the queue with CALL-type requests

- `call_max_waiting_time` — Maximum time in minutes that a CALL-type request can remain in the queue without being assigned to an agent. Specify either this parameter or `call_max_waiting_time_in_seconds`. Specifying both parameters simultaniously leads to an error

- `call_max_waiting_time_in_seconds` — Maximum call waiting time in seconds. Specify either this parameter or `call_max_waiting_time`. Specifying both parameters simultaniously leads to an error

- `call_task_selection` — Call type requests prioritizing strategy. Accepts one of the [SQTaskSelectionStrategies](/docs/references/httpapi/structure/sqtaskselectionstrategies) enum values

- `description` — Comment, up to 200 characters

- `hold_calls_if_inactive_agents` — Whether to keep the call task in the queue if all agents are in the DND/BANNED/OFFLINE statuses.

- `hold_im_if_inactive_agents` — Whether to add the task to the queue if there are no available agents

- `im_agent_selection` — Agent selection strategy for messages. Accepts one of the following values: "MOST_QUALIFIED", "LEAST_QUALIFIED", "MAX_WAITING_TIME". The default value is **call_agent_selection**

- `im_max_queue_size` — Maximum size of the queue with IM-type requests

- `im_max_waiting_time` — Maximum time in minutes that an IM-type request can remain in the queue without being assigned to an agent. Specify either this parameter or `im_max_waiting_time_in_seconds`. Specifying both parameters simultaniously leads to an error

- `im_max_waiting_time_in_seconds` — Maximum chat message waiting time in seconds. Specify either this parameter or `im_max_waiting_time`. Specifying both parameters simultaniously leads to an error

- `im_task_selection` — IM type requests prioritizing strategy. Accepts one of the [SQTaskSelectionStrategies](/docs/references/httpapi/structure/sqtaskselectionstrategies) enum values. The default value is **call_task_selection**

- `priority` — The queue's priority from 1 to 100

- `sq_queue_name` — Unique SmartQueue name within the application, up to 100 characters


## SQ_AddSkill  (api_method)

Adds a new skill to the app.

**Returns:** 

- `application_id` — Application ID to bind to. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to bind to. <b>Required</b> unless <b>application_id</b> is provided.

- `description` — Comment, up to 200 characters

- `sq_skill_name` — Unique skill name within the application


## SQ_BindAgent  (api_method)

Binds agents to a queue.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `bind_mode` — Binding mode. Accepts one of the [SQAgentBindingModes](/docs/references/httpapi/structure/sqagentbindingmodes) enum values

- `sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Use 'all' to select all the queues. <b>Required</b> unless <b>sq_queue_name</b> is provided.

- `sq_queue_name` — List of SmartQueue names separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided.

- `user_id` — List of user IDs separated by semicolons (;). Use 'all' to select all the users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — List of user names separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## SQ_BindSkill  (api_method)

Binds skills to agents.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `bind_mode` — Binding mode. Accepts one of the [SQSkillBindingModes](/docs/references/httpapi/structure/sqskillbindingmodes) enum values

- `sq_skills` — Skills to be bound to agents in the JSON array format. The array should contain objects with the <b>sq_skill_id</b>/<b>sq_skill_name</b> and <b>sq_skill_level</b> keys where skill levels range from 1 to 5

- `user_id` — List of user IDs separated by semicolons (;). Use 'all' to select all the users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — List of user names separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## SQ_DeleteAgentCustomStatusMapping  (api_method)

Removes a mapping from the mapping table. If there is no such mapping, does nothing.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_status_name` — Status name


## SQ_DelQueue  (api_method)

Deletes a queue.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Use 'all' to delete all the queues. <b>Required</b> unless <b>sq_queue_name</b> is provided.

- `sq_queue_name` — List of SmartQueue names separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided.


## SQ_DelSkill  (api_method)

Deletes a skill and detaches it from agents.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_skill_id` — List of skill IDs separated by semicolons (;). Use 'all' to delete all the skills. <b>Required</b> unless <b>sq_skill_name</b> is provided.

- `sq_skill_name` — List of skill names separated by semicolons (;). <b>Required</b> unless <b>sq_skill_id</b> is provided.


## SQ_GetAgentCustomStatusMapping  (api_method)

Returns the mapping list of SQ statuses and custom statuses. SQ statuses are returned whether they have mappings to custom statuses.

**Returns:** 

- `application_id` — Application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — Application name. Can be used instead of the <b>application_id</b> parameter


## SQ_GetAgents  (api_method)

Gets agents.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `count` — Number of items to show in the output

- `excluded_sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Agents bound to these queues are excluded. Use 'all' to select all the queues. Can be used instead of the <b>excluded_sq_queue_name</b> parameter

- `excluded_sq_queue_name` — List of SmartQueue names separated by semicolons (;). Can be used instead of the <b>excluded_sq_queue_id</b> parameter

- `offset` — Number of items to skip in the output

- `sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Use 'all' to select all the queues. Can be used instead of the <b>sq_queue_name</b> parameter

- `sq_queue_name` — List of SmartQueue names separated by semicolons (;). Can be used instead of the <b>sq_queue_id</b> parameter

- `sq_skills` — Skills to filter in the JSON array format. The array should contain objects with the <b>sq_skill_id</b>/<b>sq_skill_name</b>, <b>min_sq_skill_level</b>, and <b>max_sq_skill_level</b> keys where skill levels range from 1 to 5

- `sq_statuses` — Filter statuses in the JSON array format. The array should contain objects with the <b>sq_status_type</b> and <b>sq_status_name</b> keys. Possible values for <b>sq_status_type</b> are 'CALL' and 'IM'. Possible values for <b>sq_status_name</b> are 'OFFLINE', 'ONLINE', 'READY', 'IN_SERVICE', 'AFTER_SERVICE', 'DND'

- `user_id` — List of user IDs separated by semicolons (;). Can be used instead of the <b>user_name</b> parameter

- `user_name` — List of user names separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter

- `user_name_template` — Substring of the user name to filter

- `with_sq_queues` — Whether to display agent queues

- `with_sq_skills` — Whether to display agent skills

- `with_sq_statuses` — Whether to display agent current statuses


## SQ_GetQueues  (api_method)

Gets the queue(s).

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `count` — Number of items to show in the output

- `excluded_user_id` — List of user IDs separated by semicolons (;). Queues bound to these users are excluded. Can be used instead of the <b>excluded_user_name</b> parameter

- `excluded_user_name` — List of user names separated by semicolons (;). Can be used instead of the <b>excluded_user_id</b> parameter

- `offset` — Number of items to skip in the output

- `sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Can be used instead of the <b>sq_queue_name</b> parameter

- `sq_queue_name` — List of SmartQueue names separated by semicolons (;). Can be used instead of the <b>sq_queue_id</b> parameter

- `sq_queue_name_template` — Substring of the SmartQueue name to filter

- `user_id` — List of user IDs separated by semicolons (;). Queues bound to these users are returned. Can be used instead of the <b>user_name</b> parameter

- `user_name` — List of user names separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter

- `with_agentcount` — Whether to include the number of agents bound to the queue


## SQ_GetSkills  (api_method)

Gets the skill(s).

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `count` — Number of items to show in the output

- `excluded_user_id` — List of user IDs separated by semicolons (;). Skills bound to these users are excluded. Can be used instead of the <b>excluded_user_name</b> parameter

- `excluded_user_name` — List of user names separated by semicolons (;). Can be used instead of the <b>excluded_user_id</b> parameter

- `offset` — Number of items to skip in the output

- `sq_skill_id` — List of skill IDs separated by semicolons (;). Can be used instead of the <b>sq_skill_name</b> parameter

- `sq_skill_name` — List of skill names separated by semicolons (;). Can be used instead of the <b>sq_skill_id</b> parameter

- `sq_skill_name_template` — Substring of the skill name to filter, case-insensitive

- `user_id` — List of user IDs separated by semicolons (;). Can be used instead of the <b>user_name</b> parameter

- `user_name` — List of user names separated by semicolons (;). Can be used instead of the <b>user_id</b> parameter


## SQ_SetAgentCustomStatusMapping  (api_method)

Adds a status if there is no match for the given internal status and renames it if there is a match. It means that if the passed **sq_status_name** parameter is not in the mapping table, a new entry is created in there; if it is, the **name** field in its mapping is replaced with **custom_status_name**.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `custom_status_name` — Custom status name

- `sq_status_name` — Status name


## SQ_SetAgentInfo  (api_method)

Edits the agent settings.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `handle_calls` — Whether the agent can handle calls. When set to false, the agent is excluded from the CALL-request distribution. <b>Required</b> unless <b>max_simultaneous_conversations</b> is provided.

- `max_simultaneous_conversations` — Maximum number of chats that the user processes simultaneously. <b>Required</b> unless <b>handle_calls</b> is provided.

- `user_id` — List of user IDs separated by semicolons (;). Use 'all' to select all the users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — List of user names separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## SQ_SetQueueInfo  (api_method)

Edits an existing queue.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `call_agent_selection` — Agent selection strategy for calls. Accepts one of the following values: "MOST_QUALIFIED", "LEAST_QUALIFIED", "MAX_WAITING_TIME"

- `call_max_queue_size` — Maximum size of the queue with CALL-type requests

- `call_max_waiting_time` — Maximum time in minutes that a CALL-type request can remain in the queue without being assigned to an agent. Specify either this parameter or `call_max_waiting_time_in_seconds`. Specifying both parameters simultaniously leads to an error

- `call_max_waiting_time_in_seconds` — Maximum call waiting time in seconds. Specify either this parameter or `call_max_waiting_time`. Specifying both parameters simultaniously leads to an error

- `call_task_selection` — Strategy of prioritizing CALL-type requests for service. Accepts one of the following values: "MAX_PRIORITY", "MAX_WAITING_TIME"

- `description` — Comment, up to 200 characters

- `hold_calls_if_inactive_agents` — Whether to keep the call task in the queue if all agents are in the DND/BANNED statuses.

- `hold_im_if_inactive_agents` — Whether to add the task to the queue if there are no available agents

- `im_agent_selection` — Agent selection strategy for messages. Accepts one of the following values: "MOST_QUALIFIED", "LEAST_QUALIFIED", "MAX_WAITING_TIME". The default value is **call_agent_selection**

- `im_max_queue_size` — Maximum size of the queue with IM-type requests

- `im_max_waiting_time` — Maximum time in minutes that an IM-type request can remain in the queue without being assigned to an agent. Specify either this parameter or `im_max_waiting_time_in_seconds`. Specifying both parameters simultaniously leads to an error

- `im_max_waiting_time_in_seconds` — Maximum chat message waiting time in seconds. Specify either this parameter or `im_max_waiting_time`. Specifying both parameters simultaniously leads to an error

- `im_task_selection` — Strategy of prioritizing IM-type requests for service. Accepts one of the following values: "MAX_PRIORITY", "MAX_WAITING_TIME". The default value is **call_task_selection**

- `new_sq_queue_name` — New SmartQueue name within the application, up to 100 characters

- `priority` — The queue's priority from 1 to 100

- `sq_queue_id` — ID of the SmartQueue to search for. <b>Required</b> unless <b>sq_queue_name</b> is provided.

- `sq_queue_name` — Name of the SmartQueue to search for. <b>Required</b> unless <b>sq_queue_id</b> is provided.


## SQ_SetSkillInfo  (api_method)

Edits an existing skill.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `description` — Comment, up to 200 characters

- `new_sq_skill_name` — New unique skill name within the application

- `sq_skill_id` — ID of the skill. <b>Required</b> unless <b>sq_skill_name</b> is provided.

- `sq_skill_name` — Name of the skill. <b>Required</b> unless <b>sq_skill_id</b> is provided.


## SQ_UnbindAgent  (api_method)

Unbinds agents from queues.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_queue_id` — List of SmartQueue IDs separated by semicolons (;). Use 'all' to select all the queues. <b>Required</b> unless <b>sq_queue_name</b> is provided.

- `sq_queue_name` — List of SmartQueue names separated by semicolons (;). <b>Required</b> unless <b>sq_queue_id</b> is provided.

- `user_id` — List of user IDs separated by semicolons (;). Use 'all' to select all the users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — List of user names separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## SQ_UnbindSkill  (api_method)

Unbinds skills from agents.

**Returns:** 

- `application_id` — Application ID to search by. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name to search by. <b>Required</b> unless <b>application_id</b> is provided.

- `sq_skill_id` — List of skill IDs separated by semicolons (;). Use 'all' to unbind all the skills. <b>Required</b> unless <b>sq_skill_name</b> is provided.

- `sq_skill_name` — List of skill names separated by semicolons (;). <b>Required</b> unless <b>sq_skill_id</b> is provided.

- `user_id` — List of user IDs separated by semicolons (;). Use 'all' to select all the users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — List of user names separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.
