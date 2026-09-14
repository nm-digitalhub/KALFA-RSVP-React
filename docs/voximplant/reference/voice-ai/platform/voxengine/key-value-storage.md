> מקור: https://docs.voximplant.ai/platform/voxengine/key-value-storage
> נשמר: 2026-09-14

# Key-value storage

VoxEngine Development

Key-value storage

Learn how to use key-value storage in Voximplant.

Ask a question
|
Copy page
|
View as Markdown
|
More actions

Voximplant provides a built-in database for key-value pairs, available throughout the application.

You can store unlimited key-value pairs in the database, your keys can be up to 200 characters string, your values can be up to 2000 characters string.

You can use the Key-Value Storage module to mask phone numbers, for example, when creating a delivery service solution. An order number can be a key, and a courier’s and customer’s phone numbers – the values. Thus, the courier and the customer are connected by the order number and do not know each other’s phone numbers.

In this article, we create a simple scenario that “knows” how many times a user calls a number.

Prerequisites
Create an application.
Create a scenario.
Create a routing rule and attach it to the scenario.
Create a user to log in your client.

You need a working web or mobile application to make calls. Refer to the Web & Mobile guide to learn how to create it.

You can use our web phone to make a call.

Scenario setup

In the scenario, require the ApplicationStorage module that manages the key-value storage. Use the put method to create or update the value and the get method to get the current value.

Learn more about the methods in our API reference.

Take a look at the scenario code for our task:

Scenario code
require(Modules.ApplicationStorage);
VoxEngine.addEventListener(AppEvents.CallAlerting, async (e) => {
  let r = { value: -1 };
  try {
    r = await ApplicationStorage.get('totalCalls');
    if (r === null) {
      r = await ApplicationStorage.put('totalCalls', 0);
    }
  } catch (e) {
    Logger.write('Failure while getting totalCalls value');
  }
  try {
    await ApplicationStorage.put('totalCalls', (r.value | 0) + 1);
  } catch (e) {
    Logger.write('Failure while updating totalCalls value');
  }
  e.call.answer();
  e.call.say(`Hello.  You call ${r.value} times`, { voice: VoiceList.Amazon.en_US_Joanna });
  e.call.addEventListener(CallEvents.PlaybackFinished, VoxEngine.terminate);
});

We declare a variable to make a comparison between a call counter and the initial value possible. Then we try to retrieve the totalCalls value from the application storage. If there is no value, we create such a variable in the storage:

Compare the call counter and the initial value
try {
  r = await ApplicationStorage.get('totalCalls');
  if (r === null) {
    r = await ApplicationStorage.put('totalCalls', 0);
  }
}

The next action to perform is to increment the value in the storage.

Increment the value
try {
  await ApplicationStorage.put('totalCalls', (r.value | 0) + 1);
}
Pay attention

Each promise rejection should be handled as has been shown in the example above, otherwise, your scenario fails during the execution. See the details here.

After working with the storage, the scenario answers a call with a synthesized message of how many times you called before. When the robotic speech is over, the scenario terminates a call session.

Test your application

Open https://phone.voximplant.com/ and log in with your credentials. After successful login, enter an arbitrary string and click Call. If everything goes properly, you hear a synthesized greeting!

## קישורים חיצוניים

- [our web phone](https://phone.voximplant.com/)
- [here](https://voximplant.com/blog/cloud-side-javascript-promise-handling-update)
- [robotic speech](https://voximplant.com/blog/what-is-rpa-technology)
