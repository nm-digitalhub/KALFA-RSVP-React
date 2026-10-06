> מקור: https://docs.voximplant.ai/platform/voxengine/routing-rules
> נשמר: 2026-09-14

# Routing rules

VoxEngine Development
Routing rules
Route inbound and outbound traffic to the right scenarios
Ask a question
|
Copy page
|
View as Markdown
|
More actions

Routing rules in Voximplant enable developers to launch one or multiple scenarios and make and receive calls. When a call arrives on the platform, or you make a call through an SDK client, routing rules select the appropriate scenario(s) to execute. Launching a routing rule initiates the execution of all attached scenarios.

In this guide, you will learn how to create routing rules, attach scenarios, set up patterns for incoming calls, and execute routing rules and scenarios.

Warning

Without a routing rule you cannot make or receive a call, create a conference, and execute any scenario logic.

Creating a routing rule

To create a routing rule, navigate to the Routing tab in your application. You can either click Create in the center of the screen or New rule in the upper right corner:

This opens the New rule editor, where you can specify the rule name, properties, and attach one or more scenarios:

If you intend to use the scenario for video conferencing, enable the Video conference switch. Without this parameter, all video conferences fail with an error.

Warning

With the Video conference switch enabled, all the calls made via SDKs or softphones are billed as video conferences.

The Pattern field checks if the call’s destination (the dialed number or username specified in the e.destination property of the incoming call) matches any rule’s pattern. If the call’s destination aligns with the pattern, the attached scenario(s) are executed. If the call’s destination doesn’t match the pattern, the attached scenario(s) remain inactive, and the call proceeds to the next routing rule.

The application systematically evaluates the routing rules from top to bottom, with higher-priority rules taking precedence. When the call’s destination matches one of the rules, the rule is executed, and the application disregards any subsequent rules, ensuring that only one rule is executed at a time.

Note

If the destination phone number meets several rules’ patterns, only the first rule executes.

The Pattern field employs regular expressions to create masks for phone numbers or usernames. Common expressions include:

.* means any quantity of any symbols, so all the numbers or usernames match the rule.
+?[1-9]\d{1,14} matches any phone number
123.+ matches 1234, 12356, etc., and so on.

For more information on building regular expressions, refer to Wikipedia.

The Available scenarios dropdown list enables you to attach one or more scenarios to execute when the rule is triggered.

You can attach multiple scenarios to a single rule. In this scenario, the rule executes all the attached scenarios sequentially within a single context, promoting code reuse. This allows you to encapsulate all the functions within a scenario and utilize them in another scenario.

You can view all the attached scenarios in the Assigned scenarios field.

After specifying all the settings, click the Create rule button to create a rule.

Checking a routing rule

To verify if a specific phone number or username aligns with any rule’s pattern, navigate to the Testing tools section in the top right corner and select Rule checker.

Enter a phone number or username and click Test. If the entered data matches any rule, the corresponding rule and its pattern appear below.

Furthermore, you can utilize the integrated Softphone to initiate calls to your applications. To access the Softphone, click Testing tools in the top right corner and select Softphone. To make calls through the Softphone, you need to authorize with the username and password.

Launching a routing rule

There are several methods for initiating a scenario.

An incoming call to the platform. If the call’s destination aligns with any rule’s pattern, the corresponding scenario(s) are triggered, and the call proceeds according to the selected scenario.
An outgoing call from an SDK also generates an incoming call to the platform (a call leg). If the destination property of the SDK’s call method matches any rule’s pattern, the corresponding scenario(s) are triggered.
Management API methods: Use the StartScenarios to launch a common scenario, such as audio/video calls or a voice conference; or the StartConference to launch a video conference.
Manual launch from the control panel: In your application, navigate to the Routing tab, select the appropriate routing rule, and click the Run button.
Frequently asked questions
Can I execute a scenario without a routing rule?
Can I attach more than one scenario to a routing rule?
Do patterns work for outgoing calls?
Do patterns work for SIP calls?
Does a pattern check the caller ID or the destination number?
What if a phone number matches several rule patterns?
What if I do not enable the "Video conference" switch in the routing rule settings?
What if I enable the "Video conference" switch in the routing rule settings but will make only voice calls?
How can I pass custom data to the scenario?
How do I set up two different rules for incoming and outgoing calls?
How do I prioritize the routing rules?

## קישורים חיצוניים

- [Wikipedia](https://en.wikipedia.org/wiki/Regular_expression)
