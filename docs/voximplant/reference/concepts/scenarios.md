# Scenarios  (tutorial)

Learn about scenarios in Voximplant.

Scenarios in Voximplant are JavaScript documents within a [Voximplant application](/docs/getting-started/basic-concepts/applications), where you can implement logic processing calls and messages. They define when to [answer or make a call](/docs/guides/calls/scenarios), [synthesize](/docs/guides/speech/tts) speech, [recognize](/docs/guides/speech/asr) speech, and more.

To execute a scenario, you need a [routing rule](/docs/getting-started/basic-concepts/routing-rules). You can execute a scenario automatically, for example, by an incoming call, or manually from the [control panel](https://manage.voximplant.com/?utm_source=docs&utm_medium=scenarios&utm_campaign=gettingstarted) or via the [management API](/docs/references/httpapi/scenarios#startscenarios).

**You can have multiple scenarios in one application.**


## Contents


## Creating a scenario

To create a scenario, open your existing or newly created [application](/docs/getting-started/basic-concepts/applications), and select **Scenarios** on the left menu, and click on the plus icon to create a new scenario. Give it a name.

This opens a new tab in the online IDE on the right, where you can write your code. If needed, you can rename the scenario or modify the source code later.

> ALERT: Note — You can automatically upload changes via the [management API](/docs/references/httpapi/scenarios).


## Calling functions from other scenarios

You can use functions from two scenarios in the same application. To achieve this, you need to add two scenarios to the same [routing rule](/docs/getting-started/basic-concepts/routing-rules). Afterward, both scenarios will execute in the same space, allowing you to call functions and access variables from both scenarios without the need to import anything.


## Executing a scenario

To execute a scenario, you need to create a [routing rule](/docs/getting-started/basic-concepts/routing-rules) and launch it.

There are several ways to launch a routing rule:

For more information about routing rules, refer to the [next article](/docs/getting-started/basic-concepts/routing-rules).


## Scenario tips

Almost every [guide](/docs/guides) in this documentation includes a scenario example along with some SDK code examples. For instance, the [voice call](/docs/guides/calls/voice) and the [video call](/docs/guides/calls/video) articles provide **ready-to-use scenario examples** and the code to build a client on Web, iOS, and Android SDKs. Feel free to use the scenario examples in your project.

Every demo client on the [Voximplant GitHub](https://github.com/voximplant) includes a fully functional scenario in the Readme.md file.

Developers can also get started with scenario development on the [Voximplant control panel](https://manage.voximplant.com). The control panel offers ready-to-use [scenario templates](https://manage.voximplant.com/onboarding/templates) that can be used to create a simple project of your choice. Feel free to select a suitable template and follow a step-by-step guide to developing an application for your specific purpose.

For those who prefer manual scenario writing, we provide comprehensive scenario API explanations in the [VoxEngine section](/docs/references/voxengine) of our API reference. Additionally, we offer scenario code examples with detailed comments in our [guides](/docs/guides).

If you encounter any difficulties while writing scenarios, our [support team](https://voximplant.com/help/support) is always ready to assist you.

> ALERT: VoxEngine concepts — We strongly recommend you to read the [VoxEngine concepts](/docs/guides/voxengine/concepts) article before writing any scenario. This article helps you to understand basic concepts and avoid common mistakes when writing a scenario.


## See also


## Frequently asked questions

**Q**: **I have several modules imported in my scenario. Do I need to import them to each scenario as well?**  
**A**: If you bind all of your scenarios to one routing rule, they execute in one context, that is why you do not need to re-import the modules. It is enough to import them to one of the scenarios.

**Q**: **Do I need to create a separate scenario for processing each type of call, or can I describe the logic in one scenario?**  
**A**: It is a best practice to start with one scenario and implement the logic of processing different types of calls within one scenario. You can divide different logic into different scenarios, for example, one scenario sorts and processes incoming calls, and the other scenario processes outgoing calls or call lists.
