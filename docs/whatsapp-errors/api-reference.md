# Direct Send API reference


## Endpoints

| Endpoint | Method | Description | Details |
|----------|--------|-------------|---------|
| `/&lt;WHATSAPP_BUSINESS_PHONE_NUMBER_ID&gt;/messages` | `POST` | Send a utility or authentication message with the `category` field | [Send messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/send-utility-and-authentication-messages) |
| `/&lt;WABA_ID&gt;/message_templates` | `GET` | List generated templates; filter by `source=AUTO_GENERATED` and `correct_category` | [View generated templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/view-generated-templates) |

## Authentication

Direct Send uses standard WhatsApp Business Platform authentication. Include your access token with each request, the same way you do for other Cloud API calls. See [Get started with the Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).

## Rate limits

Direct Send supports standard Cloud API throughput. See [Cloud API throughput eligibility](https://developers.facebook.com/docs/whatsapp/throughput) and [Supported features and limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/supported-features-and-limits).

## Error codes

| Error code | Description |
|------------|-------------|
| `100` | The request included one or more unsupported or misspelled parameters. Returned when you provide a TTL value on a message that doesn&#039;t use Direct Send. |
| `100` | The time-to-live value must be lower than or equal to 43200 (TTL over 12 hours). |
| `100` | The time-to-live value must be higher than or equal to 30 (TTL under 30 seconds). |
| `100` | Direct Send isn&#039;t enabled for this account. Returned synchronously when an ineligible Messaging account sends a message with a `category` value. See [Sending a message with an ineligible account](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/send-utility-and-authentication-messages#sending-a-message-with-an-ineligible-account). |
| `131062` | Authentication messages don&#039;t support business-scoped user ID recipients. Address the message with `to` and the WhatsApp user&#039;s phone number. The message isn&#039;t delivered. |
| `2388330` | Can&#039;t delete a Direct Send template. |
| `2388318` | Can&#039;t update a Direct Send template. |
| `139200` | Direct Send utility or authentication access is blocked. Direct Send messaging capability is not available for this Messaging account due to misclassification-based enforcement. |
| `131064` | Direct Send messaging limit reached due to category-misclassification enforcement. The WABA is rate-limited for the current 24h window; further utility Direct Send messages are blocked until the next window opens. |
| `132015` | Template is temporarily unavailable because it was paused due to low quality. |
| `132021` | A template with the same name already exists. The `template_name` in `direct_send_config` conflicts with an existing template not created by Direct Send. Choose a different name. Delivered asynchronously via the error webhook. |
| `131000` | Generic infrastructure failure (&quot;Something went wrong&quot;). Returned when a `template_name` template can&#039;t be created after retries — see [Business-named templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/business-named-templates). |

## Related

- [Integrity and content guidelines](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/integrity-and-content-guidelines)
- [FAQ](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/faq)


---

Full documentation index for this product: https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt
