Was this helpful?

# Service messages

Updated: May 21, 2026

Copy for LLM

[

View as Markdown](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md)

Service messages are free-form messages that you can send to WhatsApp users during a [customer service window](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows). You send them using the [Messages API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api) (part of the [Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform#whatsapp-cloud-api)). Unlike template messages, service messages do not require pre-approval — you can compose and send them as needed in response to a WhatsApp user’s message or call.

Service messages can only be sent via the Messages API. To message WhatsApp users outside of a customer service window, use template messages instead. See [Marketing messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview), [Utility messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates), or [Authentication messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates) to learn about template-based messaging.

## Customer service windows

When a WhatsApp user messages you or [calls you](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/pricing#how-calling-changes-the-24-hour-customer-service-window), a 24-hour timer called a customer service window starts. If the user messages or calls you again before the timer expires, the timer resets to 24 hours.

While the window is open, you can send any of the following service message types to the user. When the window closes, you can only send pre-approved [template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview).

As a reminder, you can only send messages to WhatsApp users who have [opted in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in) to receiving messages from you.

**Known issue:** In rare cases, you may receive a message from a WhatsApp user but be unable to respond within the customer service window.

## Pricing

Service messages are billed under the SERVICE pricing category. See [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) for details.

## Message types

You can send the following types of service messages during an open customer service window.

[Address messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/address-messages) allow you to request a delivery address from WhatsApp users.

![WhatsApp address message asking the user to provide a delivery address, with a Provide address button](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/441384197_454102407352120_3773045747928009795_n.png?_nc_cat=110&ccb=1-7&_nc_sid=e280be&_nc_ohc=CBiGT8V30scQ7kNvwH520z4&_nc_oc=Adr6I6u1JthfsYflOn0JZda8PIkgl-qc1Vb9Yb7gdd7vUPe7FhWSe4oJUidir-8pWb8&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQOs4KVIQ2dW3582XMxo0oXwszA_gCxdgyUZqfYrFw0j5g&oe=6AD40362)

  

[Audio messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages) display an audio icon and a link to an audio file. When the WhatsApp user taps the icon, the WhatsApp client loads and plays the audio file.

![WhatsApp audio message with a music icon, download button, and audio playback timeline](https://scontent-fra5-2.xx.fbcdn.net/v/t39.2365-6/441333612_1102926104368016_6233568143947105840_n.png?_nc_cat=106&ccb=1-7&_nc_sid=e280be&_nc_ohc=qDXko6FEqzIQ7kNvwGm2oWt&_nc_oc=AdolQGkMz02aDg6mIQxJEsSoYzzngqGMec0FD01mGZEdl0d62q7RBshJ1B9JuyUPoAs&_nc_zt=14&_nc_ht=scontent-fra5-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQM62pDFWjHR2yVOO3h-eAYxe25wg0-_KQicIZ7UBITVmw&oe=6AD4076A)

  

[Contacts messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/contacts-messages) allow you to send rich contact information directly to WhatsApp users, such as names, phone numbers, physical addresses, and email addresses.

![WhatsApp contacts message for Barbara Johnson with Message and Save contact buttons](https://scontent-fra3-2.xx.fbcdn.net/v/t39.2365-6/440790666_990559829136435_3259503667945350761_n.png?_nc_cat=104&ccb=1-7&_nc_sid=e280be&_nc_ohc=4jMiPGbG-xUQ7kNvwFj38mo&_nc_oc=AdrNTYF6ycERWtF49wENTs4Ysn09lfdTC4STjMrAnHNBsCtXI5ExThAi3B8P6HxmnDQ&_nc_zt=14&_nc_ht=scontent-fra3-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQO6m2mJLTWUhpFGaUO0KugptKMBXyS23LDcATb8EPzkjA&oe=6AD42B4E)

  

[Document messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/document-messages) display a document icon, linked to a document that a WhatsApp user can tap to download.

![WhatsApp document message showing a PDF file named lucky-shrub-invoice.pdf with a download icon and caption](https://scontent-fra5-2.xx.fbcdn.net/v/t39.2365-6/440797712_455258680228442_8760882695056096687_n.png?_nc_cat=109&ccb=1-7&_nc_sid=e280be&_nc_ohc=GwDyFvpm3fAQ7kNvwHfr_ws&_nc_oc=Adqir1l8VRLeyNhnpzk61gvBiPccDDsiAJbhVb51XUCRhI7ZIqEs_OU_KJZdX7tU_U8&_nc_zt=14&_nc_ht=scontent-fra5-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQODlb6ttrZmxjhJuXlARoa9XNt_RH7Cnv8hfBdPrf4uDg&oe=6AD4334E)

  

[Image messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages) display a single image and an optional caption.

![WhatsApp image message showing a photo of a succulent being trimmed, with the caption The best succulent ever?](https://scontent-fra3-1.xx.fbcdn.net/v/t39.2365-6/439831684_1373893986606126_2007013942518250478_n.png?_nc_cat=108&ccb=1-7&_nc_sid=e280be&_nc_ohc=7h4Y3WrBItcQ7kNvwGKUzp3&_nc_oc=Adoz7TZp7c7Kxw2IZPSEUbtH3VFoiouIyhOE0xkaD64j677nGTth4-I_ozSn2tr7aiI&_nc_zt=14&_nc_ht=scontent-fra3-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQMRIxm6vPmt7lVuapyCEIbgvlRAa7xK7Rw5saM4FW5DyA&oe=6AD4170C)

  

[Interactive CTA URL button messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages) allow you to map any URL to a button, so you don’t have to include lengthy or obscure raw URLs in the message body.

![WhatsApp interactive CTA URL button message with a Lucky Shrub header image and a See Dates button](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/499710913_741192228581303_6833492513238538123_n.png?_nc_cat=102&ccb=1-7&_nc_sid=e280be&_nc_ohc=YhodQkC6xooQ7kNvwHWgFHG&_nc_oc=Adoi2AEgKCgOCC9nso3e5tz6Uv3-KT4HWCCZJzXNxC09nYpaGHfP_4gy_9FKaAV_gsw&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPFtU1TzXDx4mMja8PHThtsXMXI--ylQRcx25bQim1zVw&oe=6AD401CA)

  

[Interactive voice call messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-button-messages-deep-links/#send-interactive-message-with-a-whatsapp-call-button) allow you to trigger a WhatsApp call from users.

![WhatsApp chat with the Spruce Business Account showing a welcome message and a Call on WhatsApp button](https://scontent-fra3-1.xx.fbcdn.net/v/t39.2365-6/561384673_1339318434593474_5721045063886655968_n.jpg?_nc_cat=105&ccb=1-7&_nc_sid=e280be&_nc_ohc=qtUP9ojnS_0Q7kNvwFdA7-x&_nc_oc=AdqIFW7ruyQMQoUVeG7yWXn7sKJvh1fqQt4_I3p1vrYZ7Vz3cWfZwY4ou8Bk4uEl8eA&_nc_zt=14&_nc_ht=scontent-fra3-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQMXPIi47POH1vvm9Om2ekmnNpG67fw3wpv2u482nLMxmg&oe=6AD404F9)

  

[Interactive Flow messages](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-flow-messages) allow you to send structured messages that are more natural or comfortable for your customers. For example, you can use WhatsApp Flows to book appointments, browse products, collect customer feedback, get new sales leads, or anything else.

For details, see the [WhatsApp Flows](https://developers.facebook.com/docs/whatsapp/flows) documentation.

![WhatsApp Flow form titled Join Now with Name and Email fields, agreement checkboxes, and a Continue button](https://scontent-fra5-2.xx.fbcdn.net/v/t39.2365-6/459207270_1257913005205310_7321941208385331189_n.png?_nc_cat=109&ccb=1-7&_nc_sid=e280be&_nc_ohc=bdBgASa93YAQ7kNvwHnN-QR&_nc_oc=AdpMuQsTXn5B79A2CCfzv51kNRmn5_j4_Hq5UUURjp8ZL-NbF0iViTDvbUVENlKA06A&_nc_zt=14&_nc_ht=scontent-fra5-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPEpwFjqXW-6hjT22R79tVP9eLnGRuCcc9eOO1zScrCLQ&oe=6AD40877)

  

[Interactive list messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages) allow you to present WhatsApp users with a list of options to choose from.

![WhatsApp interactive list message titled Choose Shipping Option with a Shipping Options menu button](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/440871648_773297808277279_825530086722343543_n.png?_nc_cat=110&ccb=1-7&_nc_sid=e280be&_nc_ohc=gdURCkqjUKoQ7kNvwHSBCwy&_nc_oc=AdpgBA-VxBjNh_Xf1oluj8KPuzGH2y5WGjLcXrgizS1A_KUo4qFzYHuNL1yb0Akmr8c&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQP2RPsmkGKK4vxn5Ft__SwWJGaXxPm8nJwb3HNFe_XASg&oe=6AD40628)

  

[Interactive location request messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages) display body text and a send location button. When a WhatsApp user taps the button, a location sharing screen appears which the user can use to share their location.

![WhatsApp location request message asking where to be picked up, with a Send location button](https://scontent-fra3-2.xx.fbcdn.net/v/t39.2365-6/440778444_741946064791848_335647298308114961_n.png?_nc_cat=111&ccb=1-7&_nc_sid=e280be&_nc_ohc=dW1cU82u1wUQ7kNvwGYl7o4&_nc_oc=AdpFXfOJ2wwWFQO7-xXEYlw8WlpiPSSv0SGqGKIdQlG_NmLL5vAOtio1wUBqrzvszTE&_nc_zt=14&_nc_ht=scontent-fra3-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQNs2pYCEvsfLkGN5ex_eaLjslAnkWcPvo7zMg6KeZfn5g&oe=6AD40791)

  

[Interactive reply buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages) messages allow you to send up to three predefined replies for users to choose from.

![WhatsApp interactive reply buttons message about a gardening workshop with Change and Cancel buttons](https://scontent-fra5-2.xx.fbcdn.net/v/t39.2365-6/440770231_408356378658790_997875267478158577_n.png?_nc_cat=106&ccb=1-7&_nc_sid=e280be&_nc_ohc=y_Ec6AzzTUMQ7kNvwGgVtOe&_nc_oc=Adr6k8_xqPpLK_H6eWXYvFlp8Sj1k1VeVRru-qJk0n-NdTU1-5TzMALUdG8_Vpmsvj8&_nc_zt=14&_nc_ht=scontent-fra5-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQOSTeosOTHcrUVEQw7bH_XCJwydXY3JFDwWNoqgf1ZmCg&oe=6AD41958)

  

[Location messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-messages) allow you to send a location’s latitude and longitude coordinates to a WhatsApp user.

![WhatsApp location message showing a map with a pin for Philz Coffee and its street address](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/440739359_451301924241746_5496230692221042707_n.png?_nc_cat=102&ccb=1-7&_nc_sid=e280be&_nc_ohc=qSHDQcNrfOsQ7kNvwH5v-Ch&_nc_oc=Adog4OpUDSXnpNk35F7f30U7bMLfn6VPlykusCAHkgzIigdeur89ObbIQ83pA-pINQ8&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPGVx0URJ3GN-U_0TuVd3dcz1u6CUvXca1q1nSide53jg&oe=6AD421D4)

  

[Sticker messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/sticker-messages) display animated or static sticker images in a WhatsApp message.

![WhatsApp sticker message showing a sprouting plant sticker in a chat bubble](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/440786426_1111584576559135_6735562667160992382_n.png?_nc_cat=100&ccb=1-7&_nc_sid=e280be&_nc_ohc=9gG7DBTNSUcQ7kNvwFdxxef&_nc_oc=AdrQ32chswozCE_BbjWA2D5U2qi2qXh0dTSTuTypdz_tCmxHe72wFVQUMhbuXcaJKSY&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPYuoYPNxppM4WR1sCuCIem0nf2GU0ChRwpWxMw5D4_uw&oe=6AD40B6F)

  

[Text messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages) are messages containing only a text body and an optional link preview.

![WhatsApp text message with a Meta Quest 3 link preview and a body containing the product URL](https://scontent-fra3-2.xx.fbcdn.net/v/t39.2365-6/440778097_900237625125034_93345957848876145_n.png?_nc_cat=111&ccb=1-7&_nc_sid=e280be&_nc_ohc=Fk-4Tl5j8p8Q7kNvwEtCPNX&_nc_oc=Adq4NeMc2ZRwpWT0CjRcpyOQNTQG0IiaMTpnQ0yVc5mpy_UoZ_9GbVrw-fYZcDpUffE&_nc_zt=14&_nc_ht=scontent-fra3-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQNShUczXN4YDqAn7zXQnWpXhFx15w0lptboa-WTzhQoog&oe=6AD4128F)

  

[Video messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/video-messages) display a thumbnail preview of a video image with an optional caption. When the WhatsApp user taps the preview, it loads the video and displays it to the user.

![WhatsApp video message showing a thumbnail with a play button and the caption A succulent eclipse!](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/441312822_455518227141854_5770420105763186824_n.png?_nc_cat=110&ccb=1-7&_nc_sid=e280be&_nc_ohc=G3ykr4m43tsQ7kNvwHd0XSu&_nc_oc=AdoHweGRgBmyOr1um8yh5xlSvxy2V-JCxoRc0v9Ic2qfmYlZQt22fhmU3xLwKpV3674&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPYUeFj-PyP-5BbnOFnFLNhs4xJybNaOQ_Qkn-pBVU-Tg&oe=6AD42B67)

  

[Reaction messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages) are emoji-reactions that you can apply to a previous WhatsApp user message that you have received.

![WhatsApp message reading Perfect, thank you! with a smiling face emoji reaction applied below it](https://scontent-fra3-2.xx.fbcdn.net/v/t39.2365-6/440758814_464628532577869_3703934471348865877_n.png?_nc_cat=111&ccb=1-7&_nc_sid=e280be&_nc_ohc=P3R3jtvCkkoQ7kNvwEeJXoR&_nc_oc=AdrMcG2_P7XBcii-twncDbRtzwiPIl17bvfp8z7XaFgX6s7ap5sipRLU-pstqU_Tn4U&_nc_zt=14&_nc_ht=scontent-fra3-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQP1bzjdkHUS6TVBYh2P5rTC314MgV9PQVQ7ki1Dm2m5aA&oe=6AD40C52)

## Message quality

WhatsApp determines message quality from how WhatsApp users have received your messages over the past seven days, weighted by recency. It bases this score on user feedback signals such as blocks, reports, mutes, archives, and reasons users provide when they block you.

Guidelines for sending high-quality messages:

-   Make sure your messages follow the [WhatsApp Business Messaging Policy⁠](https://l.facebook.com/l.php?u=https%3A%2F%2Fbusiness.whatsapp.com%2Fpolicy&h=AUCsVJCCw_e8FSjHQXtR7SRhHAB2a0NcvsOysU-ublqyW8hhFSNRbYjMFiaBdHSSrfjnPWQYdDB6ARjU9dZWrkcJ_lB4cu2NA9q0vFtLUDDR-joqySVv6CHPKmpii88CHucOfi4-RkZ0Bg).
-   Only send messages to WhatsApp users who have opted into receiving messages from your business.
-   Make the messages highly personalized and useful to users.
-   Avoid sending open-ended welcome or introductory messages.
-   Avoid sending too many messages per day.
-   Optimize your messages for content and length.

The [WhatsApp Manager⁠](https://business.facebook.com/wa/manage/home/) > **Account tools** > **Phone numbers** panel displays your business phone number’s status, [quality rating⁠](https://www.facebook.com/business/help/896873687365001), and [messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits).

![WhatsApp Manager Phone numbers panel under Account tools showing status, quality rating, and messaging limit](https://scontent-fra3-1.xx.fbcdn.net/v/t39.2365-6/532273545_1018217176902582_4720629988037795374_n.png?_nc_cat=103&ccb=1-7&_nc_sid=e280be&_nc_ohc=UuTdmI5a32sQ7kNvwFLUN-2&_nc_oc=AdqJlV8jFdhBhl9y8meOpnXskPiqJbl5KtFDGUG-lZ2jTUxIAl5IFZUr-yr0kh7yeMw&_nc_zt=14&_nc_ht=scontent-fra3-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQNR4rbRPh-XqM95NGtESAjZACLMD7VZZTPwfFQh510f1w&oe=6AD405B4)

Numbers with high traffic commonly experience quality changes within short intervals (even within minutes).

## Requests

All send message requests use the [Messages API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api#post-version-phone-number-id-messages):

```
POST /<WHATSAPP_BUSINESS_PHONE_NUMBER_ID>/messages
```

The post body varies depending on the [type of message](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#message-types) you want to send, but the payload uses the following common syntax:

```
{
  "messaging_product": "whatsapp",
  "recipient_type": "<RECIPIENT_TYPE>",
  "to": "<WHATSAPP_USER_PHONE_NUMBER>",
  "type": "<MESSAGE_TYPE>",
  "<MESSAGE_TYPE>": {<MESSAGE_CONTENTS>}
}
```

The `type` property value in the post body payload indicates the [type of message](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#message-types) to send, and a property matching that type must be included that describes the message’s contents.

The `recipient_type` property can be either `individual` for 1:1 messaging, or `group` for group messages.

See the [Groups API documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) for details.

If the access token you are sending with has messaging access to more than one Messaging account on this business phone number, also include a `messaging_account_id` property naming the Messaging account to bill and attribute the message to. If your token has messaging access to exactly one Messaging account on the phone number, omit it and Meta resolves the account for you. See [Managing messaging accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/) for the full rule, the cases it covers, and a sample request.

For example, this is a request to send a [text message](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages) to a WhatsApp user. Note that `type` is set to `text`, and a `text` object follows, which describes the message’s contents:

```
curl 'https://graph.facebook.com/v26.0/106540352242922/messages' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer EAAJB...' \
-d '
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+16505551234",
  "type": "text",
  "text": {
    "preview_url": true,
    "body": "As requested, here is the link to our latest product: https://www.meta.com/quest/quest-3/"
  }
}'
```

If delivered, the message appears like this in the WhatsApp client:

![WhatsApp text message with a Meta Quest 3 link preview and a body containing the product URL](https://scontent-fra3-2.xx.fbcdn.net/v/t39.2365-6/440778097_900237625125034_93345957848876145_n.png?_nc_cat=111&ccb=1-7&_nc_sid=e280be&_nc_ohc=Fk-4Tl5j8p8Q7kNvwEtCPNX&_nc_oc=Adq4NeMc2ZRwpWT0CjRcpyOQNTQG0IiaMTpnQ0yVc5mpy_UoZ_9GbVrw-fYZcDpUffE&_nc_zt=14&_nc_ht=scontent-fra3-2.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQNShUczXN4YDqAn7zXQnWpXhFx15w0lptboa-WTzhQoog&oe=6AD4128F)

## Responses

The Messages API returns the following JSON response when it successfully accepts your send message request. This response only indicates that the API successfully **accepted your request** — it does not indicate successful delivery of your message. You receive delivery status via **messages** webhooks instead.

### Response syntax

```
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "<WHATSAPP_USER_PHONE_NUMBER>",
      "wa_id": "<WHATSAPP_USER_ID>"
    }
  ],
  "messages": [
    {
      "id": "<WHATSAPP_MESSAGE_ID>",
      "group_id": "<GROUP_ID>", <!-- Only included if messaging a group -->
      "message_status": "<PACING_STATUS>" <!-- Only included if sending a template -->
    }
  ]
}
```

### Response contents

| Placeholder | Description | Sample Value |
| --- | --- | --- |
| 
`<GROUP_ID>`

*String*



 | 

The string identifier of a group made using the Groups API.

This field shows when messages are sent, received, or read from a group.

[Learn more about the Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)



 | 

`Y2FwaV9ncm91cDoxNzA1NTU1MDEzOToxMjAzNjM0MDQ2OTQyMzM4MjAZD`



 |
| 

`<PACING_STATUS>`

*String*



 | 

Indicates [template pacing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing) status. The `message_status` property is only included in responses when sending a [template message](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) that uses a template that is being paced.



 | 

`wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI4MjZGRDA0OUE2OTQ3RkEyMzcA`



 |
| 

`<WHATSAPP_USER_PHONE_NUMBER>`

*String*



 | 

WhatsApp user’s WhatsApp phone number. May not match `wa_id` value.



 | 

`+16505551234`



 |
| 

`<WHATSAPP_USER_ID>`

*String*



 | 

WhatsApp user’s WhatsApp ID. May not match `input` value.



 | 

`16505551234`



 |
| 

`<WHATSAPP_MESSAGE_ID>`

*String*



 | 

WhatsApp Message ID. This ID appears in associated **messages** webhooks, such as sent, read, and delivered webhooks.



 | 

`wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI4MjZGRDA0OUE2OTQ3RkEyMzcA`



 |

## Commerce messages

Commerce messages are interactive messages used in conjunction with a product catalog. See [Share Products With Customers](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/share-products) to see how to use these types of messages.

## Read receipts

You can let a WhatsApp user know you have read their message by [marking it as read](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read), which causes two blue check marks (called “read receipts”) to appear below the user’s message:

![WhatsApp message with two blue check marks labeled Read receipt next to the timestamp](https://scontent-fra3-1.xx.fbcdn.net/v/t39.2365-6/491643461_603380552708521_8284248965365504291_n.png?_nc_cat=105&ccb=1-7&_nc_sid=e280be&_nc_ohc=O15g2owvKhgQ7kNvwFHgHZX&_nc_oc=Adr7c-huw6uslNf0N0cKncaqUFc-XxYye7ELQETc145kNwf8IfnNKg44p7l6vMsNZqk&_nc_zt=14&_nc_ht=scontent-fra3-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQOBlJPrIbd-68c2X7G89fJzxBl3s9tRMuPAOnUVDQcKhQ&oe=6AD40FB0)

## Typing indicators

If it may take you a few seconds or more to respond to a WhatsApp user, you can let them know that you are preparing a response by [displaying a typing indicator](https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators) and read receipts in the WhatsApp client:

![WhatsApp chat showing a Typing indicator with three dots and a Read receipt with blue check marks](https://scontent-fra5-1.xx.fbcdn.net/v/t39.2365-6/488360772_654124507349470_2240843625651955811_n.png?_nc_cat=110&ccb=1-7&_nc_sid=e280be&_nc_ohc=MWfE9ovVQOMQ7kNvwGXkxQp&_nc_oc=AdqS2F-BYDtKDifsALQ7O90-pUZtpA6-cmlkaybE2_w3jQU6Mpa3m7tGvU93ih1Zu7o&_nc_zt=14&_nc_ht=scontent-fra5-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQP6L8K6DRuYaCu7vDa6PvrZZZCB55t3HlcmBSQf8BIv8A&oe=6AD435DC)

## Contextual replies

You can send a message to a WhatsApp user as a [contextual reply](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/contextual-replies), which quotes a previous message in a contextual bubble:

![WhatsApp contextual reply quoting a previous message in a contextual bubble above the text message reply](https://scontent-fra3-1.xx.fbcdn.net/v/t39.2365-6/441349069_1363509007609494_6528221959622289637_n.png?_nc_cat=103&ccb=1-7&_nc_sid=e280be&_nc_ohc=RF7jr4dqWT0Q7kNvwEF6T12&_nc_oc=Adr7jW1ksM9ck72fAIn2HM68Oqe90MXyEjLhWaqBX7jT8xqtUsa_g2tZMVBNcbpoPfs&_nc_zt=14&_nc_ht=scontent-fra3-1.xx&_nc_gid=k4rEoQ9wsBrgv7rrGpcq_A&_nc_ss=7b289&oh=00_AQPS9j3KYCB4RHke8QpGDQpcP7Z3b4v1cNOe9m7VDU4sxw&oe=6AD413AB)

This makes it easier for the user to know which specific message you are replying to.

## Webhooks

Messages sent to WhatsApp users trigger **messages** webhooks, so be sure to subscribe to this topic to receive message status notifications.

## WhatsApp user phone number formats

Plus signs (`+`), hyphens (`-`), parenthesis (`(`,`)`), and spaces are supported in send message requests.

We highly recommend that you include both the plus sign and country calling code when sending a message to a customer. If the plus sign is omitted, your business phone number’s country calling code is prepended to the customer’s phone number. This can result in undelivered or misdelivered messages.

For example, if your business is in India (country calling code `91`) and you send a message to the following customer phone number in various formats:

| Number In Send Message Request | Number Message Delivered To | Outcome |
| --- | --- | --- |
| 
`+16315551234`



 | 

`+16315551234`



 | 

Correct number



 |
| 

`+1 (631) 555-1234`



 | 

`+16315551234`



 | 

Correct number



 |
| 

`(631) 555-1234`



 | 

`+916315551234`



 | 

Potentially wrong number



 |
| 

`1 (631) 555-1234`



 | 

`+9116315551234`



 | 

Potentially wrong number



 |

Note: For Brazil and Mexico, the extra added prefix of the phone number may be modified by the Cloud API. This is a standard behavior of the system and is not considered a bug.

## Media caching

If you are using a link (`link`) to a media asset on your server (as opposed to the ID (`id`) of an asset you have uploaded to the Meta servers), the WhatsApp Cloud API internally caches the asset for 10 minutes. The cached asset is reused in subsequent send message requests if the link in subsequent payloads is the same as the link in the initial payload.

If you don’t want the cached asset reused in a subsequent message within the 10 minute time period, append a random query string to the asset link in the new send message request payload. The Cloud API treats this as a new asset, fetches it from your server, and caches it for 10 minutes.

For example:

-   Asset link in first send message request: `https://link.to.media/sample.jpg` — asset fetched, cached for 10 minutes
-   Asset link in second send message request: `https://link.to.media/sample.jpg` — cached asset reused
-   Asset link in third send message request: `https://link.to.media/sample.jpg?abc123` — asset fetched, cached for 10 minutes

## Delivery sequence of multiple messages

When sending a series of messages, the order in which messages are delivered is not guaranteed to match the order of your API requests. If you need to ensure the sequence of message delivery, confirm receipt of a `delivered` status in a [status messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status) webhook before sending the next message in your message sequence.

## Message time-to-live (TTL)

If the Cloud API is unable to deliver a message to a WhatsApp user, it retries delivery for a period of time known as a time-to-live, TTL, or the message validity period.

### Default TTL

-   All messages except authentication templates: **30 days**.
-   Authentication templates: **10 minutes**

### Customizing TTL for templates

You can customize the default TTL for authentication and utility templates, and for marketing templates sent using the Marketing Messages API for WhatsApp. See [Time-to-live](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/time-to-live) for details.

### When TTL is exceeded: Dropped messages

The platform drops messages it cannot deliver within the default or customized TTL.

If you do not receive a status messages webhook with `status` set to `delivered` before the TTL is exceeded, assume the message was dropped.

If you send a message that fails (`status` set to `failed`), there could be a minor delay before you receive the webhook. Build in a small buffer before assuming the message was dropped.

## Troubleshooting

If you are experiencing problems with message delivery, see [Message Not Delivered](https://developers.facebook.com/documentation/business-messaging/whatsapp/support#message-not-delivered).
