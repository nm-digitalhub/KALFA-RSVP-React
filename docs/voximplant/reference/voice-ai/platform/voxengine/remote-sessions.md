> מקור: https://docs.voximplant.ai/platform/voxengine/remote-sessions
> נשמר: 2026-09-14

# Remote session management

VoxEngine Development
Remote session management
Learn how to interact with an active session via HTTP in Voximplant.
Ask a question
|
Copy page
|
View as Markdown
|
More actions

Learn how to interact with an active session via HTTP.

URL management

If you start a call session with an HTTP request, you receive an object with the media_session_access_url property as a response:

Starting a scenario — Request
curl "https://api.voximplant.com/platform_api/StartScenarios/?api_key=API_KEY&account_id=1&rule_id=1"
Starting a scenario — Response
{
  "result": 1,
  "media_session_access_secure_url": "https:\/\/1.2.3.4:12092\/request\/AF307C280E30CCA6.1580999958.1204800_185.164.149.16\/90ABEE0D64BE5D84",
  "media_session_access_url": "http:\/\/1.2.3.4:12092\/request\/AF307C280E30CCA6.1580999958.1204800_185.164.149.16\/90ABEE0D64BE5D84"
}

This URL can be used for arbitrary tasks such as stopping scenarios or passing additional data to them. This is how you can make an HTTP request with additional data in it:

Managing the request — Request
curl -d '{"param1": "value1", "param2": "value2"}' -H "Content-type: application/json" -X POST http:\/\/1.2.3.4:12092\/request\/F986320151BF8D91.1581003419.1231744_185.164.148.231\/AD12E50B42DD5CE4

Making an HTTP request on this URL results in the AppEvents.HttpRequest VoxEngine event being triggered in a scenario, with HTTP request data passed to it.

For example, if you need to write additional data to the log and then stop the session, you can write the following code in your VoxEngine scenario:

Stopping the scenario
VoxEngine.addEventListener(AppEvents.Started, () => {
  Logger.write('==========> Session is started');
  VoxEngine.addEventListener(AppEvents.HttpRequest, (e) => {
    Logger.write(e.content);
    Logger.write('==========> Session is closing');
    setTimeout(() => VoxEngine.terminate(), 300);
  });
});

After an HTTP request to media_session_access_url is performed, the session is terminated.
