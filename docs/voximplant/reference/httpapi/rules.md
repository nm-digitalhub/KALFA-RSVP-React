# Rules  (ref_folder)


## AddRule  (api_method)

Adds a new rule for the application.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `bind_key_id` — The service account ID to bind to the rule. Read more in the [guide](/docs/guides/voxengine/management-api)

- `rule_name` — The rule name. The length should be less than 100

- `rule_pattern` — The rule pattern regex. The length should be less than 64 KB

- `rule_pattern_exclude` — The exclude pattern regex. The length should be less than 64 KB

- `scenario_id` — The scenario ID list separated by semicolons (;). <b>Required</b> unless <b>scenario_name</b> is provided.

- `scenario_name` — The scenario name list separated by semicolons (;). <b>Required</b> unless <b>scenario_id</b> is provided.

- `video_conference` — Whether video conference is required


## DelRule  (api_method)

Deletes the rule.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;). Use the 'all' value to select all applications. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name list separated by semicolons (;). <b>Required</b> unless <b>application_id</b> is provided.

- `rule_id` — The rule ID list separated by semicolons (;). Use the 'all' value to select all rules. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name list separated by semicolons (;). <b>Required</b> unless <b>rule_id</b> is provided.


## GetRules  (api_method)

Gets the rules.

_roles: Owner, Admin, Developer, Supervisor, Call list manager, Support_

**Returns:** 

- `application_id` — The application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `attached_key_id` — The service account ID bound to the rule. Read more in the [guide](/docs/guides/voxengine/management-api)

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `rule_id` — The rule ID to filter

- `rule_name` — The rule name part to filter

- `template` — Search for template matching

- `video_conference` — Whether it is a video conference to filter

- `with_scenarios` — Whether to get bound scenarios info


## ReorderRules  (api_method)

Configures the rules' order in the <a href='//manage.voximplant.com/applications'>Applications</a> section of Control panel. Note: the rules should belong to the same application!

_roles: Owner, Admin, Developer_

**Returns:** 

- `rule_id` — The rule ID list separated by semicolons (;)


## SetRuleInfo  (api_method)

Edits the rule.

_roles: Owner, Admin, Developer_

**Returns:** 

- `bind_key_id` — The service account ID to bind to the rule. Read more in the [guide](/docs/guides/voxengine/management-api)

- `rule_id` — The rule ID

- `rule_name` — The new rule name. The length should be less than 100

- `rule_pattern` — The new rule pattern regex. The length should be less than 64 KB

- `rule_pattern_exclude` — The new exclude pattern regex. The length should be less than 64 KB

- `video_conference` — Whether video conference is required
