> מקור: https://docs.voximplant.ai/api-reference/management-api/reference/scenarios/start-scenarios
> נשמר: 2026-09-14

# StartScenarios

Management API
Reference
Scenarios
StartScenarios
Ask a question
|
Copy page
|
View as Markdown
|
More actions
POST
https://api.voximplant.com/platform_api/StartScenarios
POST
/platform_api/StartScenarios
cURL
curl -X POST "https://api.voximplant.com/platform_api/StartScenarios?rule_id=1" \
     -H "Authorization: Bearer <token>"
Try it
200
Success
{
  "result": 1,
  "media_session_access_url": "http://1.2.3.4:12092/request/eb769701de54cfa5.1539237068.6369268_1.2.3.4/1df792ad965d7105",
  "media_session_access_secure_url": "https://1.2.3.4:12092/request/eb769701de54cfa5.1539237068.6369268_1.2.3.4/1df792ad965d7105",
  "call_session_history_id": 123456
}

Runs JavaScript scenarios on a Voximplant server. The scenarios run in a new media session. To start a scenario, pass the routing rule ID associated with the necessary scenario. You can use both GET and POST requests at your choice. If you need to send custom data, we recommend to use the POST method and to include the data in the custom_data field of the request body. The maximum number of concurrent HTTP-requests is limited to 200. If this number is exceeded, this method returns the 429 code error (Too Many Requests) until the number of active requests is reduced. If you exceed this number, you get the 429 error code.

Allowed roles: Owner, Admin, Developer, CallsSMS.

Example request: Start the scripts from the account.

Authentication
Authorization
Bearer

Voximplant Management API uses signed JWT tokens generated from your service-account private key. Pass the token in the Authorization header as a Bearer value:

Authorization: Bearer $VOXIMPLANT_TOKEN

See Authorization for ready-to-copy snippets in bash, Python, Node.js and Go that turn your credentials.json into a token.

Query parameters
user_id
integer
Optional
The user ID. Run the scripts from the user if set
user_name
string
Optional

The user name that can be used instead of user_id. Run the scripts from the user if set

application_id
integer
Optional
The application ID
application_name
string
Optional

The application name that can be used instead of application_id

rule_id
integer
Required
The rule ID that needs to be launched. Please note, the necessary scenario needs to be attached to the rule
script_custom_data
string
Optional

The script custom data, that can be accessed in the scenario via the VoxEngine.customData() method. Use the application/x-www-form-urlencoded content type with UTF-8 encoding

reference_ip
string
Optional
Specifies the IP from the geolocation of predicted subscribers. It allows selecting the nearest server for serving subscribers
server_location
string
Optional

Specifies the location of the server where the scenario needs to be executed. Has higher priority than reference_ip. Request getServerLocations for possible values

Response
Successful response
result
integer
Optional
Returns 1 if the request has been completed successfully
media_session_access_url
string
Optional

The URL to control a created media session. You can use it for arbitrary tasks such as stopping scenario or passing additional data to it. Making HTTP request on this URL results in the AppEvents.HttpRequest VoxEngine event being triggered for scenario, with HTTP request data passed to it

media_session_access_secure_url
string
Optional

The URL to control a created media session. You can use it for arbitrary tasks such as stopping scenario or passing additional data to it. Making HTTPS request on this URL results in the AppEvents.HttpRequest VoxEngine event being triggered for scenario, with HTTP request data passed to it

call_session_history_id
integer
Optional

The call session history ID. To search a call session result, paste the ID to the GetCallHistory method’s call_session_history_id parameter

## קישורים חיצוניים

- [getServerLocations](https://api.voximplant.com/getServerLocations)
