# Scenarios  (ref_folder)


## AddScenario  (api_method)

Adds a new scenario to the <a href="https://voximplant.com/docs/gettingstarted/basicconcepts/scenarios#shared-scenarios">Shared</a> folder, so the scenario is available in all the existing applications. Please use the POST method.<br><br>When adding a scenario to the Shared folder, the `application_id` and `application_name` parameters should not be provided.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — Application ID to bind the scenario to

- `application_name` — Application name to bind the scenario to

- `rewrite` — Whether to rewrite the existing scenario

- `rule_id` — The rule ID. The new scenario binds to the specified rule. Please note, if you do not bind the scenario to any rule, you cannot execute the scenario. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name. Can be used instead of the <b>rule_id</b> parameter

- `scenario_name` — The scenario name. The length should be less than 30

- `scenario_script` — The scenario text. Use the application/x-www-form-urlencoded content type with UTF-8 encoding. The length should be less than 128 KB


## BindScenario  (api_method)

Bind the scenario list to the rule. You should specify the application_id or application_name if you specify the rule_name. Please note, the scenario and the routing rule need to be within the same application.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `bind` — Whether to bind or unbind (set true or false respectively)

- `rule_id` — The rule ID to bind the scenario. The rule and the scenario need to be in the same application. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name. <b>Required</b> unless <b>rule_id</b> is provided.

- `scenario_id` — The scenario ID list separated by semicolons (;). <b>Required</b> unless <b>scenario_name</b> is provided.

- `scenario_name` — The scenario name list separated by semicolons (;). <b>Required</b> unless <b>scenario_id</b> is provided.


## DelScenario  (api_method)

Deletes the scenario.

_roles: Owner, Admin, Developer_

**Returns:** 

- `scenario_id` — The scenario ID list separated by semicolons (;). Use the 'all' value to delete all scenarios in all applications. <b>Required</b> unless <b>scenario_name</b> is provided.

- `scenario_name` — The scenario name list separated by semicolons (;). <b>Required</b> unless <b>scenario_id</b> is provided.


## GetScenarios  (api_method)

Gets the account's scenarios.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — ID of the scenario's application

- `application_name` — Name of the scenario's application

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `scenario_id` — The scenario ID to filter

- `scenario_name` — The scenario name to filter. Exact match. Combines with <b>scenario_id</b> when both are passed. Use with <b>application_id</b> or <b>application_name</b> to limit the result to one application

- `with_script` — Whether to get the scenario text. You should specify the 'scenario_id' too!


## ReorderScenarios  (api_method)

Configures the order of scenarios that are assigned to the specified rule.

_roles: Owner, Admin, Developer_

**Returns:** 

- `rule_id` — The rule ID. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name. <b>Required</b> unless <b>rule_id</b> is provided.

- `scenario_id` — The scenario ID list separated by semicolons (;)


## SetScenarioInfo  (api_method)

Edits the scenario. You can edit the scenario's name and body. Please use the POST method.

_roles: Owner, Admin, Developer_

**Returns:** 

- `required_scenario_name` — Name of the scenario to edit. <b>Required</b> unless <b>scenario_id</b> is provided.

- `scenario_id` — Scenario ID. <b>Required</b> unless <b>required_scenario_name</b> is provided.

- `scenario_name` — New scenario name. The length should be less than 30

- `scenario_script` — New scenario text. Use the application/x-www-form-urlencoded content type with UTF-8 encoding. The length should be less than 128 KB


## StartConference  (api_method)

Runs a session for video conferencing or joins the existing video conference session.<br/><br/>When you create a session by calling this method, a scenario runs on one of the servers dedicated to video conferencing. All further method calls with the same **conference_name** do not create a new video conference session but join the existing one.<br/><br/>Use the [StartScenarios](/docs/references/httpapi/scenarios#startscenarios) method for creating audio conferences.

_roles: Owner, Admin, Developer, CallsSMS_

**Returns:** 

- `application_id` — The application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `conference_name` — The conference name. The name length should be less than 50 symbols

- `reference_ip` — Specifies the IP from the geolocation of predicted subscribers. It allows selecting the nearest server for serving subscribers. If not specified, the IP address of the HTTP request is used

- `rule_id` — The rule ID that needs to be launched. Please note, the necessary scenario needs to be attached to the rule. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name. <b>Required</b> unless <b>rule_id</b> is provided.

- `script_custom_data` — The script custom data, that can be accessed in the scenario via the <a href='/docs/references/voxengine/voxengine/customdata'>VoxEngine.customData()</a> method. Use the application/x-www-form-urlencoded content type with UTF-8 encoding.

- `server_location` — Specifies the location of the server where the scenario needs to be executed. Has higher priority than `reference_ip`. Request [getServerLocations](https://api.voximplant.com/getServerLocations) for possible values

- `user_id` — The user ID. Run the scripts from the user if set. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name. Run the scripts from the user if set. Can be used instead of the <b>user_id</b> parameter


## StartScenarios  (api_method)

Runs JavaScript scenarios on a Voximplant server. The scenarios run in a new media session. To start a scenario, pass the routing rule ID associated with the necessary scenario. You can use both GET and POST requests at your choice. If you need to send custom data, we recommend to use the POST method and to include the data in the `custom_data` field of the request body. The maximum number of concurrent HTTP-requests is limited to 200. If this number is exceeded, this method returns the 429 code error (Too Many Requests) until the number of active requests is reduced. If you exceed this number, you get the 429 error code.

_roles: Owner, Admin, Developer, CallsSMS_

**Returns:** 

- `application_id` — The application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name. Can be used instead of the <b>application_id</b> parameter

- `reference_ip` — Specifies the IP from the geolocation of predicted subscribers. It allows selecting the nearest server for serving subscribers. If not specified, the IP address of the HTTP request is used

- `rule_id` — The rule ID that needs to be launched. Please note, the necessary scenario needs to be attached to the rule. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name. <b>Required</b> unless <b>rule_id</b> is provided.

- `script_custom_data` — The script custom data, that can be accessed in the scenario via the <a href='/docs/references/voxengine/voxengine/customdata'>VoxEngine.customData()</a> method. Use the application/x-www-form-urlencoded content type with UTF-8 encoding

- `server_location` — Specifies the location of the server where the scenario needs to be executed. Has higher priority than `reference_ip`. Request [getServerLocations](https://api.voximplant.com/getServerLocations) for possible values

- `user_id` — The user ID. Run the scripts from the user if set. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name. Run the scripts from the user if set. Can be used instead of the <b>user_id</b> parameter
