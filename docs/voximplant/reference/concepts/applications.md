# Applications  (tutorial)

This article explains what are Voximplant applications, and how to create one.

A Voximplant application is an entity that is designed to perform a **specific task**, similar to any other software application. You can create multiple applications for your needs and store them in the [Voximplant control panel](https://manage.voximplant.com/?utm_source=docs&utm_medium=applications&utm_campaign=gettingstarted).

An application consists of your code (or [scenario](/docs/getting-started/basic-concepts/scenarios)), [users](/docs/getting-started/basic-concepts/users), [routing rules](/docs/getting-started/basic-concepts/routing-rules), and more.

**Before starting any new project or writing code, you must create an application.**


## How to create an application

To create an application, [log in to your Voximplant account](https://manage.voximplant.com/?utm_source=docs&utm_medium=applications&utm_campaign=gettingstarted) or create a new one. Then, navigate to the [application section](https://manage.voximplant.com/applications?utm_source=docs&utm_medium=applications&utm_campaign=gettingstarted) from the upper left corner of the page. Click **New application** in the upper right corner or **Create** at the bottom of the page.

This opens a new application editor window where you can set it up and save by clicking **Create**. The newly created app appears in the application list. To modify its name, icon, or description, click the three dots menu and select **Edit**.

Upon creating an application, you can open it and proceed to the next steps, including creating [users](/docs/getting-started/basic-concepts/users), a [scenario](/docs/getting-started/basic-concepts/scenarios), and more.


## Application sections

After creating an application, you can find various sections within it.

### Overview

Here, you can find a comprehensive summary of your app:

### Call history

This section provides access to your application’s call history. You can filter the history, view the cost, and download the session log.

### Scenarios

In this section, you can write your application’s logic using one or more JavaScript scenarios. Without a scenario, you cannot make or receive calls or utilize any other application functionality. For more information about scenarios, refer [here](/docs/getting-started/basic-concepts/scenarios).

### Users

Here, you can create and manage users, which are essential for authorizing web or mobile applications or SIP calls. For more details about users, please refer [here](/docs/getting-started/basic-concepts/users).

### Numbers

Here, you can purchase testing or real phone numbers for your application to receive calls, use as caller ID, and manage existing numbers. Attach an existing phone number to the application’s routing rule to process incoming calls. For more information about phone numbers, refer [here](/docs/getting-started/basic-concepts/phone-numbers).

### Routing

In this section, you can create and manage routing rules. These rules specify which scenario to choose for making or receiving a call, processing a video conference, or executing any other scenario logic. For more information about routing rules, refer [here](/docs/getting-started/basic-concepts/routing-rules).

### SmartQueue

In this section, you can manage call queues for a contact center based on SmartQueue. SmartQueue helps distribute calls and IM conversations between agents based on their skills and availability, and creates multiple call queues. For more information about SmartQueue, refer [here](/docs/guides/contact-center).

### Call lists

Here, you can create call lists to use in your scenarios and track their results. Call lists are useful when you need to call a list of phone numbers and process them with any scenario logic, such as IVR or connecting to agents. You can also use our Predictive Dialing System to connect the dialed calls to multiple agents in your contact center. For more information about PDS, refer [here](/docs/guides/contact-center/pds).

### SIP registrations

In this section, you can purchase SIP registrations and manage them for usage in your scenarios. SIP registrations enable developers to integrate Voximplant Cloud into a third-party PBX. For more information about SIP, refer to [the SIP article](/docs/guides/calls/sip) in the Guides section.

### WhatsApp numbers

In this section you can add and manage phone numbers for WhatsApp Business accounts. Find more information in the [WhatsApp integration article](/docs/guides/integrations/whatsapp).

### Push certificates

Here, you can manage push certificates for iOS and Android applications. Push notifications are essential for receiving incoming calls on a mobile application when it is closed or for receiving instant message notifications. Create a certificate in your iOS/Android/Huawei control panel and load it into this section.

Find more information about pushes for iOS [here](/docs/guides/sdk/ios-push). For Android, refer to [this guide](/docs/guides/sdk/android-push).

### Dialogflow connector

Here, you can integrate your Dialogflow bot into Voximplant. Download your Dialogflow account JSON file here to use the bot in your scenarios. Learn more about [Dialogflow ES](/docs/guides/integrations/dialogflow-es) and [Dialogflow CX](/docs/guides/integrations/dialogflow-cx) in the Guides section.

### Key-value storage

Voximplant provides a built-in database for storing key-value pairs throughout the application. You can store unlimited key-value pairs in the database. Your keys can be up to 200 characters long, and your values can be up to 2000 characters long. For more information on how to use it, refer to [this article](/docs/guides/voxengine/key-value-storage).

### Secrets

In this section you can access and manage your secret storage, intended for keeping secure data, such as private and API keys, to access them in your scenarios. find more information in the [corresponding article](/docs/guides/voxengine/secrets).

### VoxEngine CI

Here, you can manage Voximplant integration into your third-party IDE. Connect your IDE to manage your scenarios and routing rules remotely. For more information on VoxEngine CI usage, refer to [this guide](/docs/guides/voxengine/ci).
