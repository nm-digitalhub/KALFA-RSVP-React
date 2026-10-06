> מקור: https://docs.voximplant.ai/platform/voxengine/custom-data
> נשמר: 2026-09-14

# Custom data

VoxEngine Development
Custom data
Learn how to use custom data properties in Voximplant.
Ask a question
|
Copy page
|
View as Markdown
|
More actions

You can store short string values to use them in your scenario in the customData functions of a VoxEngine instance and a Call object.

In a VoxEngine scenario

There is a custom data function in the VoxEngine instance, where you can store a string of up to 200 bytes associated with the current JS session. You can set it and access it throughout your scenario to keep any data you may need.

To set up a value, pass the value to the function. To get a value, call the function without arguments. See the code example of how it works.

Custom data usage
// set value
VoxEngine.customData('Hello world!');
// get value and write it to a log
Logger.write(VoxEngine.customData());

You can pass any string to the custom data function at the session start in the routing rule. When you start a rule, a popup window appears asking for the custom data value (optional).

Alternatively, you can set custom data when launching a scenario with management API. When you call the StartScenarios API request to launch a scenario, specify the optional script_custom_data parameter. You can later retrieve the value in your scenario.

You can search call history with specific custom data values. To do so, make a GetCallHistory management API request and specify an optional call_session_history_custom_data parameter with the value you want to search.

In the Call instance

In the Call object instance, there is another independent custom data function, where you can store up to 200 bytes, associated with a particular call object.

To set up a value, pass the value to the function. To get a value, call the function without arguments. See the code example of how it works.

Call custom data usage
// set value
Call.customData('Hello world!');
// get value and write it to a log
Logger.write(Call.customData());

You can also access this function from the Call object in a mobile or web SDK and use it to transfer data between the scenario and the SDK.

## קישורים חיצוניים

- [mobile or web SDK](https://voximplant.com/docs/references/websdk/voximplant/callsettings#customdata)
