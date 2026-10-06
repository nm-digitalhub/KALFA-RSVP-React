# Status messages webhook reference



This reference describes trigger events and payload contents for WhatsApp Business account status **messages** webhook.

## Triggers

- Your message is sent to a WhatsApp user.
- Your message is delivered to a WhatsApp user&#039;s device.
- Your message is displayed (that is, &quot;read&quot;) in the WhatsApp client on a WhatsApp user&#039;s device.
- Your message is unable to be sent to a WhatsApp user.
- Your message is unable to be delivered to a WhatsApp user&#039;s device.
- Your message is sent to a WhatsApp user in a group chat.
- Your voice message is played by the WhatsApp user&#039;s device.

The triggers above also apply to a WhatsApp user who is part of a group chat.

A status is considered read only if it has been delivered. In some cases, like when a user receives a message while in the chat screen, the message is both delivered and read at the same time. In these cases, the &quot;delivered&quot; webhook is not sent because it&#039;s implied that the message was delivered since it was read. This behavior is due to internal optimization.

## Syntax

```html
&#123;
  &quot;object&quot;: &quot;whatsapp_business_account&quot;,
  &quot;entry&quot;: [
    &#123;
      &quot;id&quot;: &quot;&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;&quot;,
      &quot;changes&quot;: [
        &#123;
          &quot;value&quot;: &#123;
            &quot;messaging_product&quot;: &quot;whatsapp&quot;,
            &quot;metadata&quot;: &#123;
              &quot;display_phone_number&quot;: &quot;&lt;BUSINESS_DISPLAY_PHONE_NUMBER&gt;&quot;,
              &quot;phone_number_id&quot;: &quot;&lt;BUSINESS_PHONE_NUMBER_ID&gt;&quot;
            &#125;,
            &quot;statuses&quot;: [
              &#123;
                &quot;id&quot;: &quot;&lt;WHATSAPP_MESSAGE_ID&gt;&quot;,
                &quot;status&quot;: &quot;&lt;STATUS&gt;&quot;,
                &quot;timestamp&quot;: &quot;&lt;WEBHOOK_TRIGGER_TIMESTAMP&gt;&quot;,
                &quot;recipient_id&quot;: &quot;&lt;USER_PHONE_NUMBER_OR_GROUP_ID&gt;&quot;,
                &quot;recipient_type&quot;: &quot;group&quot;, &lt;!-- Only included if message sent to a group --&gt;
                &quot;recipient_participant_id&quot;: &quot;&lt;GROUP_PARTICIPANT_USER_PHONE_NUMBER&gt;&quot;, &lt;!-- Only included if message sent to a group --&gt;
                &quot;recipient_identity_key_hash&quot;: &quot;&lt;IDENTITY_KEY_HASH&gt;&quot;, &lt;!-- Only included if identity change check enabled --&gt;
                &quot;biz_opaque_callback_data&quot;: &quot;&lt;BUSINESS_OPAQUE_DATA&gt;&quot;, &lt;!-- Only included if message sent with biz_opaque_callback_data --&gt;

                &lt;!-- (1) Only included with sent status, and one of either delivered or read status
                     (2) Omitted entirely for v24.0+ unless webhook is for a free entry point conversation --&gt;
                &quot;conversation&quot;: &#123;
                  &quot;id&quot;: &quot;&lt;CONVERSATION_ID&gt;&quot;,
                  &quot;expiration_timestamp&quot;: &quot;&lt;CONVERSATION_EXPIRATION_TIMESTAMP&gt;&quot;,
                  &quot;origin&quot;: &#123;
                    &quot;type&quot;: &quot;&lt;CONVERSATION_CATEGORY&gt;&quot;
                  &#125;
                &#125;,

                &lt;!-- only included with sent status, and one of either delivered or read status --&gt;
                &quot;pricing&quot;: &#123;
                  &quot;billable&quot;: &lt;IS_BILLABLE?&gt;,
                  &quot;pricing_model&quot;: &quot;&lt;PRICING_MODEL&gt;&quot;,
                  &quot;type&quot;: &quot;&lt;PRICING_TYPE&gt;&quot;,
                  &quot;category&quot;: &quot;&lt;PRICING_CATEGORY&gt;&quot;
                &#125;,

                &lt;!-- only included if failure to send or deliver message --&gt;
                &quot;errors&quot;: [
                  &#123;
                    &quot;code&quot;: &lt;ERROR_CODE&gt;,
                    &quot;title&quot;: &quot;&lt;ERROR_TITLE&gt;&quot;,
                    &quot;message&quot;: &quot;&lt;ERROR_MESSAGE&gt;&quot;,
                    &quot;error_data&quot;: &#123;
                      &quot;details&quot;: &quot;&lt;ERROR_DETAILS&gt;&quot;
                    &#125;,
                    &quot;href&quot;: &quot;&lt;ERROR_CODES_URL&gt;&quot;
                  &#125;
                ]
              &#125;
            ]
          &#125;,
          &quot;field&quot;: &quot;messages&quot;
        &#125;
      ]
    &#125;
  ]
&#125;
```

## Parameters

| Placeholder | Description | Example value |
| --- | --- | --- |
| `&lt;BUSINESS_DISPLAY_PHONE_NUMBER&gt;`&lt;br&gt;&lt;br&gt;_String_ | Business display phone number. | `15550783881` |
| `&lt;BUSINESS_OPAQUE_DATA&gt;`&lt;br&gt;&lt;br&gt;_String_ | String assigned by the business to the `biz_opaque_callback_data` property in the send message request.&lt;br&gt;&lt;br&gt;Only included if the business set a `biz_opaque_callback_data` value when [sending](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api#messages) the message. | `1744434060` |
| `&lt;BUSINESS_PHONE_NUMBER_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | Business phone number ID. | `106540352242922` |
| `&lt;CONVERSATION_CATEGORY&gt;`&lt;br&gt;&lt;br&gt;_String_ | [Conversation category](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#conversation-categories). Values can be:&lt;br&gt;&lt;br&gt;`authentication` — Indicates an authentication conversation.&lt;br&gt;&lt;br&gt;`authentication_international` — Indicates an [authentication-international](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/authentication-international-rates) conversation.&lt;br&gt;&lt;br&gt;`marketing` — Indicates a marketing conversation.&lt;br&gt;&lt;br&gt;`marketing_lite` — Indicates a [Marketing Messages API for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview) conversation.&lt;br&gt;&lt;br&gt;`referral_conversion` — Indicates a free entry point conversation.&lt;br&gt;&lt;br&gt;`service` — Indicates a service conversation.&lt;br&gt;&lt;br&gt;`utility` — Indicates a utility conversation. | `service` |
| `&lt;CONVERSATION_EXPIRATION_TIMESTAMP&gt;`&lt;br&gt;&lt;br&gt;_String_ | Unix timestamp indicating when the conversation will expire.&lt;br&gt;&lt;br&gt;The expiration_timestamp property is only included for `sent` status. | `1744434060` |
| `&lt;CONVERSATION_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | Version 24.0 and higher:&lt;br&gt;&lt;br&gt;The `conversation` object will be omitted entirely, unless the webhook is for a message sent within an open free entry point window, in which case the value will be unique per window.&lt;br&gt;&lt;br&gt;Version 23.0 and lower:&lt;br&gt;&lt;br&gt;Value will now be set to a unique ID per-message, unless the webhook is for a message sent with an open free entry point window, in which case the value will be unique per window. | `8f842dbba350821654c9dfed31f5635c` |
| `&lt;ERROR_CODE&gt;`&lt;br&gt;&lt;br&gt;_Integer_ | [Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes). | `131050` |
| `&lt;ERROR_CODES_URL&gt;`&lt;br&gt;&lt;br&gt;_String_ | Link to [error code documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes). | `/docs/whatsapp/cloud-api/support/error-codes/` |
| `&lt;ERROR_DETAILS&gt;`&lt;br&gt;&lt;br&gt;_String_ | [Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) details. | `In order to maintain a healthy ecosystem engagement, the message failed to be delivered.` |
| `&lt;ERROR_MESSAGE&gt;`&lt;br&gt;&lt;br&gt;_String_ | [Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) message. This value is the same as the `title` property value. | `This message was not delivered to maintain healthy ecosystem engagement.` |
| `&lt;ERROR_TITLE&gt;`&lt;br&gt;&lt;br&gt;_String_ | [Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) title. This value is the same as the `message` property value. | `This message was not delivered to maintain healthy ecosystem engagement.` |
| `&lt;GROUP_PARTICIPANT_USER_PHONE_NUMBER&gt;`&lt;br&gt;&lt;br&gt;_String_ | WhatsApp user phone number. Property only included if message was sent to a [group](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups). | `16505551234` |
| `&lt;IDENTITY_KEY_HASH&gt;`&lt;br&gt;&lt;br&gt;_String_ | Identity key hash. Only included if you have enabled the [identity change check](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) feature. | `DF2lS5v2W6x=` |
| `&lt;IS_BILLABLE?&gt;`&lt;br&gt;&lt;br&gt;_Boolean_ | Indicates if the message is billable (`true`) or not (`false`).&lt;br&gt;&lt;br&gt;The `billable` property will be deprecated in a future versioned release. Use `pricing.type` and `pricing.category` together to determine whether a message is billable and, if so, its billing rate. | `true` |
| `&lt;PRICING_CATEGORY&gt;`&lt;br&gt;&lt;br&gt;_String_ | Pricing category ([rate](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rates)) applied if billable. Values can be:&lt;br&gt;&lt;br&gt;`authentication` — Indicates authentication rate applied.&lt;br&gt;&lt;br&gt;`authentication-international` — Indicates authentication-international rate applied.&lt;br&gt;&lt;br&gt;`marketing` — Indicates marketing rate applied.&lt;br&gt;&lt;br&gt;`marketing_lite` — Indicates a [Marketing Messages API for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview) pricing applied.&lt;br&gt;&lt;br&gt;`referral_conversion` — Indicates a [free entry point conversation](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#free-entry-point-conversations).&lt;br&gt;&lt;br&gt;`service` – Indicates service rate applied.&lt;br&gt;&lt;br&gt;`utility` — Indicates utility rate applied. | `service` |
| `&lt;PRICING_MODEL&gt;`&lt;br&gt;&lt;br&gt;_String_ | Pricing model. Values can be:&lt;br&gt;&lt;br&gt;`CBP` — Indicates conversation-based pricing applies. Will only be set to this value if the webhook was sent before July 1, 2025.&lt;br&gt;&lt;br&gt;`PMP` — Indicates [per-message pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) applies. | `PMP` |
| `&lt;PRICING_TYPE&gt;`&lt;br&gt;&lt;br&gt;_String_ | Pricing type.&lt;br&gt;&lt;br&gt;`regular` — Indicates the message is billable.&lt;br&gt;&lt;br&gt;`free_customer_service` — Indicates the message is free because it was either a utility template message or non-template message sent within a customer service window.&lt;br&gt;&lt;br&gt;`free_entry_point` — Indicates the message is free because it was sent within an open free entry point window. | `regular` |
| `&lt;STATUS&gt;`&lt;br&gt;&lt;br&gt;_String_ | Message status. Values can be:&lt;br&gt;&lt;br&gt;`delivered` — Indicates message was successfully delivered to the WhatsApp user&#039;s device.&lt;br&gt;&lt;br&gt;- WhatsApp UI equivalent: Two checkmarks.&lt;br&gt;&lt;br&gt;`failed` — Indicates failure to send or deliver the message to the WhatsApp user&#039;s device.&lt;br&gt;&lt;br&gt;- WhatsApp UI equivalent: Red error triangle.&lt;br&gt;&lt;br&gt;`played` — Indicates the first time a voice message is played by the WhatsApp user&#039;s device.&lt;br&gt;&lt;br&gt;- WhatsApp UI equivalent: Blue microphone.&lt;br&gt;&lt;br&gt;`read` — Indicates the message was displayed in an open chat thread in the WhatsApp user&#039;s device.&lt;br&gt;&lt;br&gt;- WhatsApp UI equivalent: Two blue checkmarks.&lt;br&gt;&lt;br&gt;`sent` — Indicates the message was successfully sent from our servers.&lt;br&gt;&lt;br&gt;- WhatsApp UI equivalent: One checkmark. | `read` |
| `&lt;USER_PHONE_NUMBER_OR_GROUP_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | WhatsApp user phone number or group ID.&lt;br&gt;&lt;br&gt;Value set to the WhatsApp user&#039;s phone number if the message was sent to their phone number, or set to a [group ID](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) if sent to a group ID. If sent to a group ID, the WhatsApp user&#039;s phone number is instead assigned to the `recipient_participant_id` property. | `16505551234` |
| `&lt;WEBHOOK_TRIGGER_TIMESTAMP&gt;`&lt;br&gt;&lt;br&gt;_String_ | Unix timestamp indicating when the webhook was triggered. | `1739321024` |
| `&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | WhatsApp Business Account ID. | `102290129340398` |
| `&lt;WHATSAPP_MESSAGE_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | WhatsApp message ID. | `wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=` |

## Examples

This example webhook describes a marketing message that has been successfully sent from our servers.

```json
&#123;
  &quot;object&quot;: &quot;whatsapp_business_account&quot;,
  &quot;entry&quot;: [
    &#123;
      &quot;id&quot;: &quot;102290129340398&quot;,
      &quot;changes&quot;: [
        &#123;
          &quot;value&quot;: &#123;
            &quot;messaging_product&quot;: &quot;whatsapp&quot;,
            &quot;metadata&quot;: &#123;
              &quot;display_phone_number&quot;: &quot;15550783881&quot;,
              &quot;phone_number_id&quot;: &quot;106540352242922&quot;
            &#125;,
            &quot;statuses&quot;: [
              &#123;
                &quot;id&quot;: &quot;wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=&quot;,
                &quot;status&quot;: &quot;sent&quot;,
                &quot;timestamp&quot;: &quot;1750030073&quot;,
                &quot;recipient_id&quot;: &quot;16505551234&quot;,
                &quot;conversation&quot;: &#123;
                  &quot;id&quot;: &quot;72b14d6bd5407799e66f64d1b338e567&quot;,
                  &quot;expiration_timestamp&quot;: &quot;1750116480&quot;,
                  &quot;origin&quot;: &#123;
                    &quot;type&quot;: &quot;marketing&quot;
                  &#125;
                &#125;,
                &quot;pricing&quot;: &#123;
                  &quot;billable&quot;: true,
                  &quot;pricing_model&quot;: &quot;PMP&quot;,
                  &quot;type&quot;: &quot;regular&quot;,
                  &quot;category&quot;: &quot;marketing&quot;
                &#125;
              &#125;
            ]
          &#125;,
          &quot;field&quot;: &quot;messages&quot;
        &#125;
      ]
    &#125;
  ]
&#125;
```

This example v24.0 webhook describes a marketing message that has been displayed in the WhatsApp client (that is, &quot;read&quot;). Notice that in this case, the `conversation` object is omitted because it&#039;s a v24.0 webhook, and the `pricing` object is omitted because it happened to be displayed in an associated delivered status messages webhook (the object can only appear in one or the other).

```json
&#123;
  &quot;object&quot;: &quot;whatsapp_business_account&quot;,
  &quot;entry&quot;: [
    &#123;
      &quot;id&quot;: &quot;102290129340398&quot;,
      &quot;changes&quot;: [
        &#123;
          &quot;value&quot;: &#123;
            &quot;messaging_product&quot;: &quot;whatsapp&quot;,
            &quot;metadata&quot;: &#123;
              &quot;display_phone_number&quot;: &quot;15550783881&quot;,
              &quot;phone_number_id&quot;: &quot;106540352242922&quot;
            &#125;,
            &quot;statuses&quot;: [
              &#123;
                &quot;id&quot;: &quot;wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=&quot;,
                &quot;status&quot;: &quot;sent&quot;,
                &quot;timestamp&quot;: &quot;1750030073&quot;,
                &quot;recipient_id&quot;: &quot;16505551234&quot;
              &#125;
            ]
          &#125;,
          &quot;field&quot;: &quot;messages&quot;
        &#125;
      ]
    &#125;
  ]
&#125;
```

This example describes a message that failed to be sent.

```json
&#123;
  &quot;object&quot;: &quot;whatsapp_business_account&quot;,
  &quot;entry&quot;: [
    &#123;
      &quot;id&quot;: &quot;102290129340398&quot;,
      &quot;changes&quot;: [
        &#123;
          &quot;value&quot;: &#123;
            &quot;messaging_product&quot;: &quot;whatsapp&quot;,
            &quot;metadata&quot;: &#123;
              &quot;display_phone_number&quot;: &quot;15550783881&quot;,
              &quot;phone_number_id&quot;: &quot;106540352242922&quot;
            &#125;,
            &quot;statuses&quot;: [
              &#123;
                &quot;id&quot;: &quot;wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI0QUQ2MjA4NEYyRkExNjMyREUA&quot;,
                &quot;status&quot;: &quot;failed&quot;,
                &quot;timestamp&quot;: &quot;1751142888&quot;,
                &quot;recipient_id&quot;: &quot;16505551234&quot;,
                &quot;errors&quot;: [
                  &#123;
                    &quot;code&quot;: 131049,
                    &quot;title&quot;: &quot;This message was not delivered to maintain healthy ecosystem engagement.&quot;,
                    &quot;message&quot;: &quot;This message was not delivered to maintain healthy ecosystem engagement.&quot;,
                    &quot;error_data&quot;: &#123;
                      &quot;details&quot;: &quot;In order to maintain a healthy ecosystem engagement, the message failed to be delivered.&quot;
                    &#125;,
                    &quot;href&quot;: &quot;/documentation/business-messaging/whatsapp/support/error-codes&quot;
                  &#125;
                ]
              &#125;
            ]
          &#125;,
          &quot;field&quot;: &quot;messages&quot;
        &#125;
      ]
    &#125;
  ]
&#125;
```


---

Full documentation index for this product: https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt
