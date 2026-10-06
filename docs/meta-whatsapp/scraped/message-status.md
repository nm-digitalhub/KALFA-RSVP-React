Was this helpful?

# Status messages webhook reference

Updated: Sep 14, 2026

Copy for LLM

[

View as Markdown](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status.md)

This reference describes trigger events and payload contents for Messaging account status **messages** webhook.

## Triggers

-   Your message is sent to a WhatsApp user.
-   Your message is delivered to a WhatsApp user’s device.
-   Your message is displayed (that is, “read”) in the WhatsApp client on a WhatsApp user’s device.
-   Your message is unable to be sent to a WhatsApp user.
-   Your message is unable to be delivered to a WhatsApp user’s device.
-   Your message is sent to a WhatsApp user in a group chat.
-   Your voice message is played by the WhatsApp user’s device.

The triggers above also apply to a WhatsApp user who is part of a group chat.

A status is considered read only if it has been delivered. In some cases, like when a user receives a message while in the chat screen, the message is both delivered and read at the same time. In these cases, the “delivered” webhook is not sent because it’s implied that the message was delivered since it was read. This behavior is due to internal optimization.

## Syntax

```
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "<WHATSAPP_BUSINESS_ACCOUNT_ID>",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "<BUSINESS_DISPLAY_PHONE_NUMBER>",
              "phone_number_id": "<BUSINESS_PHONE_NUMBER_ID>"
            },
            "statuses": [
              {
                "id": "<WHATSAPP_MESSAGE_ID>",
                "status": "<STATUS>",
                "timestamp": "<WEBHOOK_TRIGGER_TIMESTAMP>",
                "recipient_id": "<USER_PHONE_NUMBER_OR_GROUP_ID>",
                "recipient_type": "group", <!-- Only included if message sent to a group -->
                "recipient_participant_id": "<GROUP_PARTICIPANT_USER_PHONE_NUMBER>", <!-- Only included if message sent to a group -->
                "recipient_identity_key_hash": "<IDENTITY_KEY_HASH>", <!-- Only included if identity change check enabled -->
                "biz_opaque_callback_data": "<BUSINESS_OPAQUE_DATA>", <!-- Only included if message sent with biz_opaque_callback_data -->

                <!-- (1) Only included with sent status, and one of either delivered or read status
                     (2) Omitted entirely for v24.0+ unless webhook is for a free entry point conversation -->
                "conversation": {
                  "id": "<CONVERSATION_ID>",
                  "expiration_timestamp": "<CONVERSATION_EXPIRATION_TIMESTAMP>",
                  "origin": {
                    "type": "<CONVERSATION_CATEGORY>"
                  }
                },

                <!-- only included with sent status, and one of either delivered or read status -->
                "pricing": {
                  "billable": <IS_BILLABLE?>,
                  "pricing_model": "<PRICING_MODEL>",
                  "type": "<PRICING_TYPE>",
                  "category": "<PRICING_CATEGORY>"
                },

                <!-- only included if failure to send or deliver message -->
                "errors": [
                  {
                    "code": <ERROR_CODE>,
                    "title": "<ERROR_TITLE>",
                    "message": "<ERROR_MESSAGE>",
                    "error_data": {
                      "details": "<ERROR_DETAILS>"
                    },
                    "href": "<ERROR_CODES_URL>"
                  }
                ]
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## Parameters

| Placeholder | Description | Example value |
| --- | --- | --- |
| 
`<BUSINESS_DISPLAY_PHONE_NUMBER>`

*String*



 | 

Business display phone number.



 | 

`15550783881`



 |
| 

`<BUSINESS_OPAQUE_DATA>`

*String*



 | 

String assigned by the business to the `biz_opaque_callback_data` property in the send message request.

Only included if the business set a `biz_opaque_callback_data` value when [sending](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api#messages) the message.



 | 

`1744434060`



 |
| 

`<BUSINESS_PHONE_NUMBER_ID>`

*String*



 | 

Business phone number ID.



 | 

`106540352242922`



 |
| 

`<CONVERSATION_CATEGORY>`

*String*



 | 

[Conversation category](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#conversation-categories). Values can be:

`authentication` — Indicates an authentication conversation.

`authentication_international` — Indicates an [authentication-international](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/authentication-international-rates) conversation.

`marketing` — Indicates a marketing conversation.

`marketing_lite` — Indicates a [Marketing Messages API for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview) conversation.

`referral_conversion` — Indicates a free entry point conversation.

`service` — Indicates a service conversation.

`utility` — Indicates a utility conversation.



 | 

`service`



 |
| 

`<CONVERSATION_EXPIRATION_TIMESTAMP>`

*String*



 | 

Unix timestamp indicating when the conversation will expire.

The expiration\_timestamp property is only included for `sent` status.



 | 

`1744434060`



 |
| 

`<CONVERSATION_ID>`

*String*



 | 

Version 24.0 and higher:

The `conversation` object will be omitted entirely, unless the webhook is for a message sent within an open free entry point window, in which case the value will be unique per window.

Version 23.0 and lower:

Value will now be set to a unique ID per-message, unless the webhook is for a message sent with an open free entry point window, in which case the value will be unique per window.



 | 

`8f842dbba350821654c9dfed31f5635c`



 |
| 

`<ERROR_CODE>`

*Integer*



 | 

[Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes).



 | 

`131050`



 |
| 

`<ERROR_CODES_URL>`

*String*



 | 

Link to [error code documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes).



 | 

`/docs/whatsapp/cloud-api/support/error-codes/`



 |
| 

`<ERROR_DETAILS>`

*String*



 | 

[Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) details.



 | 

`In order to maintain a healthy ecosystem engagement, the message failed to be delivered.`



 |
| 

`<ERROR_MESSAGE>`

*String*



 | 

[Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) message. This value is the same as the `title` property value.



 | 

`This message was not delivered to maintain healthy ecosystem engagement.`



 |
| 

`<ERROR_TITLE>`

*String*



 | 

[Error code](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes) title. This value is the same as the `message` property value.



 | 

`This message was not delivered to maintain healthy ecosystem engagement.`



 |
| 

`<GROUP_PARTICIPANT_USER_PHONE_NUMBER>`

*String*



 | 

WhatsApp user phone number. Property only included if message was sent to a [group](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups).



 | 

`16505551234`



 |
| 

`<IDENTITY_KEY_HASH>`

*String*



 | 

Identity key hash. Only included if you have enabled the [identity change check](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) feature.



 | 

`DF2lS5v2W6x=`



 |
| 

`<IS_BILLABLE?>`

*Boolean*



 | 

Indicates if the message is billable (`true`) or not (`false`).

The `billable` property will be deprecated in a future versioned release. Use `pricing.type` and `pricing.category` together to determine whether a message is billable and, if so, its billing rate.



 | 

`true`



 |
| 

`<PRICING_CATEGORY>`

*String*



 | 

Pricing category ([rate](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#rates)) applied if billable. Values can be:

`authentication` — Indicates authentication rate applied.

`authentication-international` — Indicates authentication-international rate applied.

`group_marketing` — Indicates a group marketing template message.

`group_service` — Indicates a group non-template message.

`group_utility` — Indicates a group utility template message.

`marketing` — Indicates marketing rate applied.

`marketing_lite` — Indicates a [Marketing Messages API for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview) pricing applied.

`referral_conversion` — Indicates a [free entry point conversation](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#free-entry-point-conversations).

`service` – Indicates service rate applied.

`utility` — Indicates utility rate applied.



 | 

`service`



 |
| 

`<PRICING_MODEL>`

*String*



 | 

Pricing model. Values can be:

`CBP` — Indicates conversation-based pricing applies. Will only be set to this value if the webhook was sent before July 1, 2025.

`PMP` — Indicates [per-message pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) applies.



 | 

`PMP`



 |
| 

`<PRICING_TYPE>`

*String*



 | 

Pricing type.

`regular` — Indicates the message is billable. As of October 1, 2026, this includes 1:1 utility messages sent within an open customer service window, group utility messages sent within an open group customer service window, and 1:1 and group service messages delivered after the business phone number’s free tier has been used.

`free_customer_service` — Through September 30, 2026, indicates a utility template message or non-template message sent within a customer service window. As of October 1, 2026, indicates a 1:1 service delivery within the business phone number’s free tier.

`free_entry_point` — Indicates the message is free because it was sent within an open free entry point window.

`free_group_customer_service` — Through September 30, 2026, indicates a group utility or non-template message delivered within an open group customer service window. As of October 1, 2026, indicates a group service delivery within the business phone number’s free tier.



 | 

`regular`



 |
| 

`<STATUS>`

*String*



 | 

Message status. Values can be:

`delivered` — Indicates message was successfully delivered to the WhatsApp user’s device.

-   WhatsApp UI equivalent: Two checkmarks.

`failed` — Indicates failure to send or deliver the message to the WhatsApp user’s device.

-   WhatsApp UI equivalent: Red error triangle.

`played` — Indicates the first time a voice message is played by the WhatsApp user’s device.

-   WhatsApp UI equivalent: Blue microphone.

`read` — Indicates the message was displayed in an open chat thread in the WhatsApp user’s device.

-   WhatsApp UI equivalent: Two blue checkmarks.

`sent` — Indicates the message was successfully sent from our servers.

-   WhatsApp UI equivalent: One checkmark.



 | 

`read`



 |
| 

`<USER_PHONE_NUMBER_OR_GROUP_ID>`

*String*



 | 

WhatsApp user phone number or group ID.

Value set to the WhatsApp user’s phone number if the message was sent to their phone number, or set to a [group ID](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) if sent to a group ID. If sent to a group ID, the WhatsApp user’s phone number is instead assigned to the `recipient_participant_id` property.



 | 

`16505551234`



 |
| 

`<WEBHOOK_TRIGGER_TIMESTAMP>`

*String*



 | 

Unix timestamp indicating when the webhook was triggered.



 | 

`1739321024`



 |
| 

`<WHATSAPP_BUSINESS_ACCOUNT_ID>`

*String*



 | 

Messaging account ID.



 | 

`102290129340398`



 |
| 

`<WHATSAPP_MESSAGE_ID>`

*String*



 | 

WhatsApp message ID.



 | 

`wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=`



 |

## Examples

This example webhook describes a marketing message that has been successfully sent from our servers.

```
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "statuses": [
              {
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "status": "sent",
                "timestamp": "1750030073",
                "recipient_id": "16505551234",
                "conversation": {
                  "id": "72b14d6bd5407799e66f64d1b338e567",
                  "expiration_timestamp": "1750116480",
                  "origin": {
                    "type": "marketing"
                  }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "PMP",
                  "type": "regular",
                  "category": "marketing"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

This example v24.0 webhook describes a marketing message that has been successfully sent from our servers (that is, “sent”). Notice that in this case, the `conversation` object is omitted because it’s a v24.0 webhook, and the `pricing` object is omitted because it happened to be displayed in an associated delivered status messages webhook (the object can only appear in one or the other).

```
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "statuses": [
              {
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
                "status": "sent",
                "timestamp": "1750030073",
                "recipient_id": "16505551234"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

This example describes a message that failed to be sent.

```
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550783881",
              "phone_number_id": "106540352242922"
            },
            "statuses": [
              {
                "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI0QUQ2MjA4NEYyRkExNjMyREUA",
                "status": "failed",
                "timestamp": "1751142888",
                "recipient_id": "16505551234",
                "errors": [
                  {
                    "code": 131049,
                    "title": "This message was not delivered to maintain healthy ecosystem engagement.",
                    "message": "This message was not delivered to maintain healthy ecosystem engagement.",
                    "error_data": {
                      "details": "In order to maintain a healthy ecosystem engagement, the message failed to be delivered."
                    },
                    "href": "/documentation/business-messaging/whatsapp/support/error-codes"
                  }
                ]
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```
