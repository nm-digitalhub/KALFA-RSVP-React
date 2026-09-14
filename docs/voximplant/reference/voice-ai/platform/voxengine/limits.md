> מקור: https://docs.voximplant.ai/platform/voxengine/limits
> נשמר: 2026-09-14

# Limits and restrictions

VoxEngine Development
Limits and restrictions
Know the runtime, media, and request limits that shape scenario behavior
Ask a question
|
Copy page
|
View as Markdown
|
More actions

When an incoming call or an HTTP request triggers a cloud Voximplant scenario, a new JavaScript session is initiated. To ensure real-time execution speed, each JavaScript session is subject to resource and action limits.

Max 1000 users per account. Once the limit is reached, Management API will return error code 109 on an attempt to create a new user. Contact us via support@voximplant.com to increase the user limit.
An unanswered incoming call is disconnected in 60 seconds.
A session without calls and without ACD requests is terminated in 60 seconds.
A session without calls and with at least one ACD request is terminated in 120 minutes.
JavaScript scenario size is limited to 256*1024 Unicode chars.
JavaScript memory is limited to 16 megabytes.
JavaScript string length is limited to 8,388,607 Unicode chars.
Callback execution time is limited to 1 second. This means that heavy computations should be moved to your own infrastructure and accessed via HTTP requests.
The maximum number of active timers is 100.
The maximum number of media players per session is 10.
The maximum number of SIP Refers (RFC 3551) per call is 10.
The maximum size of the SIP header is 4095 B.
The maximum size of the SIP packet is 307200 B.
Timers and any other external resources are not available for the application after the ‘Terminating’ event has been triggered, but the application can make one more HTTP request to notify the external system about the fact that the session is finished.
The maximum number of active HTTP requests is 3. Requests over the limit are queued, up to the total HTTP requests limit. Before the ‘Terminating’ event is triggered, VoxEngine will wait up to 90 seconds for pending requests to complete and will execute corresponding callback functions. The rest queued requests are silently dropped without any callback function execution.
The maximum number of simultaneous HTTP requests is 35. The limit includes both pending and queued requests. Initiating more requests will result in the “Exceeded the HTTP connection count limit!” exception.
The maximum number of active SMTP requests is 2. Requests over the limit are queued, up to the total SMTP requests limit. Before the ‘Terminating’ event is triggered, VoxEngine will wait up to 90 seconds for pending requests to complete and will execute corresponding callback functions. The rest of the queued requests are silently dropped without any callback function execution.
The maximum number of simultaneous SMTP requests is 10. This limit counts both pending and queued requests. Initiating more requests will result in the “Exceeded the SMTP connection count limit!” exception.
The size of the HTTP response handled by VoxEngine is limited to 2 megabytes.
Session is limited to a total of 50 incoming and outgoing call attempts. Both successful and failed calls are counted. New calls over the limit will fail with ‘CallEvents.Failed’ event where ‘code’ is 403 and ‘reason’ is a description string like “Call limit reached”. Use the Call list module for a large number of outgoing calls and the Conference module for a large number of participants in a single VoxEngine session.
The maximum number of “progressing” calls that are not answered yet at any given moment is limited to 10. Calls over the limit will fail with ‘CallEvents.Failed’ event where ‘code’ is 403 and ‘reason’ is a description string like “Call limit reached”.
Single SIP header field is limited to 200 bytes.
Destinations that are more expensive than 20 cents per minute and calls to countries in Africa are blocked by default for security reasons. Please contact us at support@voximplant.com to enable them. IMPORTANT: if these settings have been applied to your account, then all child accounts created afterward have these settings too.
All call* methods trigger the Failed event with 408 code if there is no answer after 60 sec. The methods are: callConference, callPSTN, callSIP, callUser and callUserDirect.
Maximum size of data that can be sent using the sendInfo and sendMessage methods of the Call class is 8192 bytes.
Maximum number of incoming WebSocket connections cannot be bigger than the number of calls in one session + 3. Trying to make one more connection will lead to an error and trigger the NewWebSocketFailed event. Note that existing connections are not destroyed after a call is ended.
