> מקור: https://docs.voximplant.ai/platform/voxengine/calls-and-sessions
> נשמר: 2026-09-14

# Calls and sessions

VoxEngine Development
Calls and sessions

Understand call legs, sessions, and real-time call control in VoxEngine

Ask a question
|
Copy page
|
View as Markdown
|
More actions

In the telecommunications industry, a call is typically understood as a connection between two endpoints, such as a caller and a callee. However, a call is actually composed of two distinct connections known as “call legs”: one originating from a phone to a telecom operator’s hardware or software, and the other originating from the telecom operator’s hardware or software to another phone.

Within Voximplant, each call leg is simply referred to as “a call,” and each call can be independently controlled by the JavaScript code deployed in the Voximplant cloud. Our cloud functions as a telecom operator in the aforementioned scheme, enabling calls to originate not only from the phone network but also from the IP network (SIP device or application, Voximplant Web or Mobile SDK). You instruct the Voximplant cloud on the actions to be taken for each call using JavaScript: connecting to another call, joining a conference, recording voice or video, and so on. Similarly, a call can be initiated from the Voximplant cloud to various types of endpoints.

Voximplant serverless is implemented using a JavaScript runtime environment called VoxEngine. Developers write JavaScript code to manage calls and then upload it to the cloud. This code is executed on Voximplant media servers where calls are processed. This approach facilitates both real-time call control and real-time debugging. The JavaScript implementation utilized in VoxEngine is compliant with ES2017/2018 standards.

VoxEngine provides a comprehensive suite of classes and functions to implement the necessary call control logic and manage Voximplant built-in features, such as call recording, speech recognition, speech synthesis, and more. Furthermore, since VoxEngine offers robust JavaScript support and built-in functions for data exchange with external web services (for making and receiving HTTP requests or handling WebSocket connections), some business logic can be integrated alongside the call control logic.

The lifespan of a Voximplant session is significantly longer compared to conventional serverless functions, typically exceeding the duration of the function’s control. The session context remains accessible throughout its entire lifetime.

VoxEngine operates entirely asynchronously, eliminating any waiting or blocking operations. Each method call initiates a corresponding operation and promptly returns the result. If a developer executes two methods, such as say, one after the other, the second playback immediately replaces the first. Essentially, it mirrors the event-driven architecture employed by other JavaScript platforms like Node.js. To ensure real-time execution, there are specific limitations imposed on each JavaScript session.

Please note

Voximplant considers each call as a separate session and handles it separately from other calls.

MediaUnit concept

VoxEngine categorizes any object possessing an audio or video stream as a separate media unit. Consequently, a media unit can encompass a call itself, a conference, instances of ASR, Player, and Recorder.

A call can transmit multiple media streams (voice and video) to other calls but can only receive a single stream at a time. A newly sent stream replaces a previously received stream. To combine multiple media streams, utilize a conference instead. A conference simultaneously receives and transmits multiple streams.

Utilize the sendMediaTo method to transmit media from a call to the media unit specified in targetMediaUnit.
