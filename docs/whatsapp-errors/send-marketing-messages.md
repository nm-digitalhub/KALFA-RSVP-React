# Send Marketing Messages



Marketing Messages API for WhatsApp allows you to send marketing template messages only. To send other message types or receive messages, use Cloud API in parallel with Marketing Messages API for WhatsApp on the same business phone number.

If you use a partner&#039;s UI portals or APIs to configure and send marketing messages, you can continue to do so, and do not need to use any of the capabilities described in this document - your partner will take care of integrating with MM API for WhatsApp&#039;s message sending functions on your behalf.

## Prerequisites

Before you can send marketing messages via Marketing Messages API for WhatsApp, ensure the following:

- A Messaging account with [MM API for WhatsApp onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding) complete
- At least one registered business phone number in the WhatsApp account hierarchy associated with your Messaging account
- At least one approved marketing template
- An access token with the `whatsapp_business_messaging` permission
- A Meta Pixel or Conversions API integration (required for [conversion measurement](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/measure-conversion))

## Create marketing templates

You can create marketing templates in several ways:

1. Via WhatsApp Business Manager UI
1. Via the Business Management API &quot;Message Templates&quot; endpoint
1. If you work with a partner, your partner may offer their own API or user interfaces for template creation, which leverage the &quot;Message Templates&quot; endpoint

See documentation on how to [Create and manage templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview).

When you create a new marketing template, it takes up to 10 minutes to sync with the corresponding Ad account. This sync enables message optimization and measurement of clicks and downstream conversions.

Templates inactive for longer than 7 days also require 10 minutes to sync after first use. Wait 10 minutes after creating new marketing templates or reactivating dormant templates before sending marketing traffic.

Marketing Messages API for WhatsApp supports all marketing templates. In addition, Marketing Messages API for WhatsApp provides the following features that are not available to marketing templates on Cloud API:

* **Time-To-Live (TTL) for Marketing template messages:** If Meta is unable to deliver a message to a WhatsApp user, Meta will retry the delivery for a period of time known as a time-to-live, TTL, or the message validity period. TTL is available for Authentication and Utility template messages on Cloud API, but TTL for Marketing template messages is exclusively available on MM API for WhatsApp. See documentation on how to [Create and Manage Templates via API](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview#time-to-live--ttl---customization--defaults--min-max-values--and-compatibility) or [How to set a custom message validity period via UI](https://www.facebook.com/business/help/1305007343713790) for details on how to set TTLs for Marketing template messages.

## Automatic creative optimizations

Automatic creative optimizations test variations with different creative treatments and optimize marketing messages based on practices observed from high-performing creatives. You can disable them using the [template-level opt-out](#configure-automatic-creative-optimizations-template-level) or [WhatsApp Business Account-level opt-out](#configure-automatic-creative-optimizations-whatsapp-business-account-level), giving you flexibility and control over how creative enhancements are applied. These are similar to [Advantage+ creative](https://www.facebook.com/business/help/297506218282224?id=649869995454285) for ads.

Automatic creative optimizations like text extraction and highlighting have driven an average increase of 13.9%\* in click-through rates (CTR).

This feature introduces creative variability for performance optimization, meaning the output may vary between messages even with the same input. This capability tests minor variations of your existing image header and automatically selects the variant getting the highest click-through rate over time, with no input needed from you. We are continuously exploring and testing new automatic creative optimizations to help maximize your campaign performance. As new variations become available, they may be applied to opted-in templates to drive better business results.

### Image filtering

For some campaigns, Meta automatically applies the most effective filters to header images in order to enhance the images&#039; quality and appeal:

### Headline extraction

For some campaigns, Meta extracts keywords or phrases from your message to create a headline for your body text to highlight key information.

### Tap-target title extraction

For some campaigns, Meta extracts keywords or phrases from your message to create a title for the tap-target area to highlight key information.

### Text formatting

For some campaigns, Meta updates the formatting of text (for example, removing unnecessary spaces, bolding phrases) to increase performance and message digestibility. No text content is changed - format only.

### Coming soon

We are continuously exploring and testing new automatic creative optimizations to help maximize your campaign performance. While we expect to make these enhancements available in the future, our plans are subject to change.

#### Product extensions

Meta enhances single-image creatives by appending a set of additional catalog products users are likely to engage or convert with, creating more personalized and relevant experiences.

#### Auto promotion tag

For some campaigns, Meta will automatically extract the promotion tag, like &quot;30% off&quot;, &quot;50% discount&quot;, &quot;Free shipping&quot; from messages to create a promotion tag and put it into the image to highlight promotion information.

#### Image banner

For some campaigns, Meta will apply colorful paddings to transform the image creative to the optimal aspect ratio to enhance visual appeal and improve media digestibility.

#### Dynamic CTA

For some campaigns, Meta will dynamically tailor CTA text to match the message or URL&#039;s value prop, driving higher engagement through relevance.

#### Hyperlink formatting

For some campaigns, Meta will detect meaningful promotional keyphrases (such as discounts, offers, and incentives) to convert into a hyperlink mapped to the CTA, or transform URL links in the message body by shortening the link or applying hyperlink formatting to adjacent keyphrases to improve message digestibility.

#### Profile end card

For some campaigns, Meta may append a business profile card at the end of a single-image marketing message, displaying WhatsApp business profile details to help WhatsApp users learn more about the sender and encourage engagement. The end card features publicly available details from a business profile, such as business category, short description, and website URL.

### Paused or deprecated

We have paused the following automatic creative optimizations, and you should not expect these to be applied to your marketing messages. We will update documentation if we restart any of these in the future:

- **Image cropping**: Meta automatically crops header images to an optimal dimension, ensuring your visuals are always perfectly framed without cutting off image text.
- **Text overlays**: Meta automatically adds a text overlay onto your image using your message content.
- **Image animation**: Meta automatically transforms your header image into an animated GIF.
- **Image background generation**: Meta automatically generates a new image background.


#### Footnotes
\*This finding is based on an A/B test conducted with over 50 million delivered marketing messages sent by about 200 advertisers on MM API for WhatsApp between December 1, 2025, and January 7, 2026. It compared CTR for messages with automatic creative optimizations applied to messages without any applied, and the results were statistically significant at 95% confidence.

### Configure automatic creative optimizations (template-level)

All optimization features are enabled by default, but you can use the `creative_features_spec` object to specify which optimizations you want to enable (&quot;opt-in&quot;) or disable (&quot;opt-out&quot;) on a given template. To do this, set each optimization&#039;s `enroll_status` property to either `OPT_IN` or `OPT_OUT` upon template creation, or when editing an existing template.

### Request syntax

Use the [Message Templates API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api#post-version-waba-id-message-templates) to configure automatic creative optimizations at a template level.

```html
POST /&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;/message_templates
&#123;
  &quot;name&quot;: &quot;&lt;TEMPLATE_NAME&gt;&quot;,
  &quot;language&quot;: &quot;&lt;TEMPLATE_LANGUAGE_AND_LOCALE_CODE&gt;&quot;,
  &quot;components&quot;: [&lt;TEMPLATE_COMPONENTS&gt;],
  &quot;degrees_of_freedom_spec&quot;: &#123;
    &quot;creative_features_spec&quot;: &#123;
      &quot;image_brightness_and_contrast&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_OUT&quot;
      &#125;,
      &quot;image_touchups&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;add_text_overlay&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_OUT&quot;
      &#125;,
      &quot;image_animation&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;image_background_gen&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;auto_promotion_tag&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
     &quot;text_extraction_for_headline&quot;: &#123;
       &quot;enroll_status&quot;: &quot;OPT_IN&quot;
     &#125;,
     &quot;text_extraction_for_tap_target&quot;: &#123;
       &quot;enroll_status&quot;: &quot;OPT_IN&quot;
     &#125;,
      &quot;product_extensions&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_OUT&quot;
      &#125;,
      &quot;text_formatting_optimization&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_OUT&quot;
      &#125;
    &#125;
  &#125;
&#125;
```
Use the [Template API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api#get-version-template-id) to retrieve automatic creative optimizations statuses at a template level.

### Request syntax

```html
GET /&lt;TEMPLATE_ID&gt;?fields=degrees_of_freedom_spec
```

### Example response

```json
&#123;
  &quot;degrees_of_freedom_spec&quot;: &#123;
    &quot;creative_features_spec&quot;: [
      &#123;
        &quot;key&quot;: &quot;IMAGE_BRIGHTNESS_AND_CONTRAST&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;IMAGE_TOUCHUPS&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;ADD_TEXT_OVERLAY&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_IN&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;IMAGE_ANIMATION&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;IMAGE_BACKGROUND_GEN&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;AUTO_PROMOTION_TAG&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;TEXT_EXTRACTION_FOR_HEADLINE&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;TEXT_EXTRACTION_FOR_TAP_TARGET&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_OUT&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;PRODUCT_EXTENSIONS&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_IN&quot; &#125;
      &#125;,
      &#123;
        &quot;key&quot;: &quot;TEXT_FORMATTING_OPTIMIZATION&quot;,
        &quot;value&quot;: &#123; &quot;enroll_status&quot;: &quot;OPT_IN&quot; &#125;
      &#125;
    ]
  &#125;,
  &quot;id&quot;: &quot;123456789&quot;
&#125;
```
### Configure automatic creative optimizations (WhatsApp Business Account-level)

All optimization features are disabled by default, but you can use the `creative_features_spec` object to specify which optimizations you want to enable (&quot;opt-in&quot;) or disable (&quot;opt-out&quot;) for the entire Messaging account. To do this, set each optimization&#039;s `enroll_status` property that you wish to modify to either `OPT_IN` or `OPT_OUT`.

### Request syntax

Use the [WhatsApp Business Account API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api#post-version-waba-id) to configure automatic creative optimizations at a Messaging account level.

```html
POST /&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;
&#123;
  &quot;degrees_of_freedom_spec&quot;: &#123;
    &quot;creative_features_spec&quot;: &#123;
      &quot;image_touchups&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;image_animation&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;image_brightness_and_contrast&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;add_text_overlay&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;image_background_gen&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;auto_promotion_tag&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;text_extraction_for_headline&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;product_extensions&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;text_extraction_for_tap_target&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_IN&quot;
      &#125;,
      &quot;text_formatting_optimization&quot;: &#123;
        &quot;enroll_status&quot;: &quot;OPT_OUT&quot;
      &#125;
    &#125;
  &#125;
&#125;
```
### Request syntax

Use the [WhatsApp Business Account API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api#get-version-waba-id) to retrieve automatic creative optimizations statuses at a Messaging account level.

```html
GET /&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;?fields=degrees_of_freedom_spec
```

### Example response

```json
&#123;
  &quot;degrees_of_freedom_spec&quot;: &#123;
    &quot;data&quot;: [
      &#123;
        &quot;creative_features_spec&quot;: [
          &#123;
            &quot;image_brightness_and_contrast&quot;: &quot;OPT_IN&quot;,
            &quot;image_touchups&quot;: &quot;OPT_IN&quot;,
            &quot;add_text_overlay&quot;: &quot;OPT_IN&quot;,
            &quot;image_animation&quot;: &quot;OPT_IN&quot;,
            &quot;image_background_gen&quot;: &quot;OPT_IN&quot;,
            &quot;auto_promotion_tag&quot;: &quot;OPT_IN&quot;,
            &quot;text_extraction_for_headline&quot;: &quot;OPT_IN&quot;,
            &quot;product_extensions&quot;: &quot;OPT_IN&quot;,
            &quot;text_extraction_for_tap_target&quot;: &quot;OPT_IN&quot;,
            &quot;text_formatting_optimization&quot;: &quot;OPT_IN&quot;
          &#125;
        ]
      &#125;
    ]
  &#125;,
  &quot;id&quot;: &quot;1234567890&quot;
&#125;
```


## Other optimizations

### Text truncation

Meta truncates text to a specific line-count to increase performance. No text content is changed, the original text is still accessible through the &quot;Read more&quot; button. The exact line count truncation rules are as follows:

- **Messages without any CTA, but with a link in the message body** (overrides the below rules): truncated to 5 lines
- **Messages with a media header** ([Image](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages), [Video](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/video-messages), [Document](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/document-messages), [Location](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components#media-header), and [GIF](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components#media-header)): truncated to 3 lines
- **Messages without a header** (that is, [Text messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components#body)): truncated to 4 lines

## Send marketing template messages

Sending messages follows the same API payload syntax as Sending Messages on Cloud API, and requires the same permissions.

The `/marketing_messages` endpoint supports **only** marketing template messages for MM API for WhatsApp and Cloud API. All other message types (freeform, Authentication, Service, Utility) are not supported, and will produce an error.

Marketing messages will only be sent via MM API for WhatsApp when the business customer has met all [onboarding requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding). If onboarding requirements are not met, the marketing messages will still be routed via Cloud API. You may disable the ability to route to Cloud API by setting the optional field `product_policy` to `STRICT`.

Note: You may still use the `/messages` endpoint to send marketing messages through the Cloud API, unless you have [disabled marketing messages on Cloud API](#disable-marketing-messages-on-cloud-api).

| Endpoint | Authentication |
| --- | --- |
| `/PHONE_NUMBER_ID/marketing_messages` | Developers can authenticate their API calls with the access token generated in the **App Dashboard &gt; WhatsApp &gt; API Setup**.&lt;br&gt;&lt;br&gt;If you are a business messaging service provider, you must authenticate with an access token with the `whatsapp_business_messaging` permission. |

### Request syntax

```html
POST /&lt;WHATSAPP_BUSINESS_PHONE_NUMBER_ID&gt;/marketing_messages
&#123;
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;recipient_type&quot;: &quot;individual&quot;,
  &quot;to&quot;: &quot;&lt;WHATSAPP_USER_PHONE_NUMBER&gt;&quot;,
  &quot;type&quot;: &quot;&lt;MESSAGE_TYPE&gt;&quot;,
  &quot;&lt;MESSAGE_TYPE&gt;&quot;: &#123;
    &lt;MESSAGE_CONTENTS&gt;
  &#125;,
  &lt;!-- Optional --&gt;
  &quot;product_policy&quot;: &quot;&lt;PRODUCT_POLICY&gt;&quot;,
  &quot;message_activity_sharing&quot;: &lt;SHARE_MESSAGING_ACTIVITY?&gt;
&#125;
```

MM API for WhatsApp provides the following additional features that are not available to Marketing template messages on Cloud API:

- **Product fallback policy:** Set `product_policy` to `CLOUD_API_FALLBACK` to have the API send the outgoing message via Cloud API, if [onboarding requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding) have not been met. Set to `STRICT` if you do not want the API to fallback to sending the message via Cloud API.

- **Message activity sharing:** `message_activity_sharing` is an optional parameter at the message level that enables or disables sharing message activities (for example, message read) for that specific marketing message to Meta to help optimize marketing messages. If this parameter is not provided, the default Messaging account-level setting will be applied. You can always edit your default setting in Business Settings (see Changelog for a screenshot of this).

For details on message types, reference the Cloud API [Message Types documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#message-types), as MM API for WhatsApp uses the same message send formatting.

### Sending to a BSUID (business-scoped user ID)

Marketing Messages API for WhatsApp supports sending messages using a phone number, a BSUID (or parent BSUID), or both. Sending to phone numbers is recommended where available, primarily so you continue to receive phone numbers in webhooks. See [Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids) for an overview of BSUIDs.

#### Request

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;BUSINESS_PHONE_NUMBER_ID&gt;/marketing_messages&#039; \
-H &#039;Content-Type: application/json&#039; \
-H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039; \
-d &#039;
&#123;
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;recipient_type&quot;: &quot;individual&quot;,
  &quot;to&quot;: &quot;&lt;USER_PHONE_NUMBER&gt;&quot;,
  &quot;recipient&quot;: &quot;&lt;BSUID&gt;&quot;,
  &quot;type&quot;: &quot;template&quot;,
  &quot;template&quot;: &#123;
    &lt;EXPECTED_TEMPLATE_PARAMETERS&gt;
  &#125;
&#125;&#039;
```

#### Field reference

| Field | Change | Description |
|---|---|---|
| `to` | Now optional | WhatsApp user phone number (individual) or group ID (group). If provided, takes precedence over `recipient`. |
| `recipient` | New (optional) | User BSUID or parent BSUID for individual messages. Used only when `to` is omitted. |

#### Precedence and validation

- At least one of `to` or `recipient` must be provided. Requests omitting both fail.
- If both are provided, `to` (phone number) is used for processing and delivery, and `recipient` is ignored.
- Sending by BSUID disables Marketing Messages Lite API delivery optimization for that send. See [limitations](#limitations-when-sending-by-bsuid) below.

#### Response

The response adds a `user_id` field and changes the semantics of `input` and `wa_id`:

```html
&#123;
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;contacts&quot;: [
    &#123;
      &quot;input&quot;: &quot;&lt;USER_PHONE_NUMBER_OR_BSUID&gt;&quot;,
      &quot;wa_id&quot;: &quot;&lt;USER_PHONE_NUMBER&gt;&quot;,
      &quot;user_id&quot;: &quot;&lt;BSUID&gt;&quot;
    &#125;
  ],
  &quot;messages&quot;: [
    &#123;
      &quot;id&quot;: &quot;&lt;WHATSAPP_MESSAGE_ID&gt;&quot;
    &#125;
  ]
&#125;
```

| Field | Description |
|---|---|
| `input` | The user&#039;s phone number if the message was sent by phone number, the user&#039;s BSUID (or parent BSUID) if sent by BSUID, or the group ID if sent to a group. |
| `wa_id` | The user&#039;s phone number. Omitted when the message was sent using a BSUID. |
| `user_id` | The user&#039;s BSUID (or parent BSUID) when the message was sent using a BSUID. Omitted when only a phone number is provided or when both phone number and BSUID are provided. |

#### Example — send to phone number

```json
&#123;
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;contacts&quot;: [
    &#123; &quot;input&quot;: &quot;+16505551234&quot;, &quot;wa_id&quot;: &quot;16505551234&quot; &#125;
  ],
  &quot;messages&quot;: [
    &#123; &quot;id&quot;: &quot;wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA&quot; &#125;
  ]
&#125;
```

#### Example — send to BSUID

```json
&#123;
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;contacts&quot;: [
    &#123;
      &quot;input&quot;: &quot;US.13491208655302741918&quot;,
      &quot;user_id&quot;: &quot;US.13491208655302741918&quot;
    &#125;
  ],
  &quot;messages&quot;: [
    &#123; &quot;id&quot;: &quot;wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA&quot; &#125;
  ]
&#125;
```

#### Example — when both phone number and BSUID are omitted

```json
&#123;
  &quot;error&quot;: &#123;
    &quot;message&quot;: &quot;The parameter to is required.&quot;,
    &quot;type&quot;: &quot;OAuthException&quot;,
    &quot;code&quot;: 100,
    &quot;fbtrace_id&quot;: &quot;ANPlYYIqhnaWG-FIJ-rABkS&quot;
  &#125;
&#125;
```

### Limitations when sending by BSUID

- **Delivery optimization is not applied.** Marketing Messages Lite API delivery optimization does not run for sends addressed by BSUID.
- **Dynamic pricing (`bid_spec`) is not supported with BSUID recipients.** Sending a marketing template that includes `bid_spec` to a BSUID recipient returns error `131062`. To use `bid_spec`, send to the user&#039;s phone number, or use a template without `bid_spec`.

### Error: `131062` — BSUID recipients not supported for this message

| Field | Value |
|---|---|
| **Code** | `131062` |
| **Type** | `OAuthException` |
| **Message** | &quot;Business-scoped User ID (BSUID) recipients are not supported for this message.&quot; |

This error is returned when:

- The template uses `bid_spec` (dynamic pricing) and the recipient is a BSUID.
- An authentication template is sent to a BSUID recipient.

```json
&#123;
  &quot;error&quot;: &#123;
    &quot;message&quot;: &quot;(#131062) Business-scoped User ID (BSUID) recipients are not supported for this message.&quot;,
    &quot;type&quot;: &quot;OAuthException&quot;,
    &quot;code&quot;: 131062,
    &quot;error_data&quot;: &#123;
      &quot;messaging_product&quot;: &quot;whatsapp&quot;,
      &quot;details&quot;: &quot;The template specified in the request uses bid_spec, which is not supported for Business-scoped user ID (BSUID) recipients. To send this template, please provide the phone number of recipients or use a template without the bid_spec field.&quot;
    &#125;
  &#125;
&#125;
```

## Disable marketing messages on Cloud API

If your business has onboarded to MM API for WhatsApp, you can disable the ability to send Marketing category templates through the Cloud API `/messages` endpoint. When this option is activated, the `/messages` endpoint rejects Marketing category templates. You can decide whether to send marketing messages through the `/marketing_messages` endpoint or disable this option.

This setting has no effect on Messaging accounts that have not started the MM API for WhatsApp onboarding process; it only takes effect on Messaging accounts that have fully onboarded. Messaging accounts that have started the onboarding process but have not signed the Terms of Service (ToS) may experience blocked marketing messages, as described in [Fallback behavior on `/marketing_messages`](#mm-api-fallback-behavior).

### Request syntax &#123;#disable-mm-request-syntax&#125;

Use the [WhatsApp Business Account API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api#post-version-waba-id) to enable or disable marketing messages on Cloud API.

```html
POST /&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;
&#123;
  &quot;disable_marketing_messages_on_cloud_api&quot;: true | false
&#125;
```

Set `disable_marketing_messages_on_cloud_api` to `true` to block Marketing category templates on the Cloud API `/messages` endpoint. Set to `false` to allow Marketing category templates on Cloud API (default).

### Example request &#123;#disable-mm-example-request&#125;

The following request disables marketing messages on Cloud API for the specified Messaging account.

```curl
curl &#039;https://graph.facebook.com/v27.0/102290129340398&#039; \
-H &#039;Content-Type: application/json&#039; \
-H &#039;Authorization: Bearer EAAJB...&#039; \
-d &#039;
&#123;
  &quot;disable_marketing_messages_on_cloud_api&quot;: true
&#125;&#039;
```

### Example response &#123;#disable-mm-example-response&#125;

```json
&#123;
  &quot;id&quot;: &quot;102290129340398&quot;
&#125;
```

### Request syntax &#123;#check-current-value-request-syntax&#125;

Use the [WhatsApp Business Account API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api#get-version-waba-id) to check the current value.

```html
GET /&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;?fields=disable_marketing_messages_on_cloud_api
```

### Example response &#123;#check-value-example-response&#125;

```json
&#123;
  &quot;disable_marketing_messages_on_cloud_api&quot;: true,
  &quot;id&quot;: &quot;102290129340398&quot;
&#125;
```

### Error response

If `disable_marketing_messages_on_cloud_api` is set to `true` and you attempt to send a Marketing category template through the Cloud API `/messages` endpoint, the API returns the following error:

```json
&#123;
  &quot;error&quot;: &#123;
    &quot;message&quot;: &quot;(#131063) Marketing templates disabled for Cloud API&quot;,
    &quot;type&quot;: &quot;OAuthException&quot;,
    &quot;code&quot;: 131063,
    &quot;error_data&quot;: &#123;
      &quot;messaging_product&quot;: &quot;whatsapp&quot;,
      &quot;details&quot;: &quot;Your template is categorized as Marketing, but marketing templates are currently disabled for your Cloud API configuration. To send this template, use the Marketing Messages API for WhatsApp or enable marketing templates on Cloud API by turning off disable_marketing_messages_on_cloud_api.&quot;
    &#125;,
    &quot;fbtrace_id&quot;: &quot;ABzNMWIqsLJ7hbj8xd5ytay&quot;
  &#125;
&#125;
```

### Fallback behavior on `/marketing_messages` &#123;#mm-api-fallback-behavior&#125;

When `disable_marketing_messages_on_cloud_api` is set to `true`, the fallback to Cloud API for the `/marketing_messages` endpoint is also affected:

- **MM API ToS signed**: The `/marketing_messages` endpoint works normally. No change in behavior.
- **MM API ToS not signed**: Marketing template messages sent to `/marketing_messages` would normally fall back to Cloud API, but the fallback is now rejected with error `131063` because the opt-in blocks marketing templates on Cloud API.

To avoid this error, ensure your Messaging account has completed all [onboarding requirements](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding) before enabling this setting.

**Note:** When the per-message `product_policy` is set to `STRICT`, no fallback to Cloud API is attempted regardless of the `disable_marketing_messages_on_cloud_api` setting. The fallback behavior described above only applies when `product_policy` is set to the default of `CLOUD_API_FALLBACK`.

### Re-enable marketing messages on Cloud API

To restore the ability to send Marketing category templates through the Cloud API `/messages` endpoint, set `disable_marketing_messages_on_cloud_api` to `false`:

```curl
curl &#039;https://graph.facebook.com/v27.0/102290129340398&#039; \
-H &#039;Content-Type: application/json&#039; \
-H &#039;Authorization: Bearer EAAJB...&#039; \
-d &#039;
&#123;
  &quot;disable_marketing_messages_on_cloud_api&quot;: false
&#125;&#039;
```

This restores the default behavior — Marketing category templates are accepted on the `/messages` endpoint again.

## Receiving message status webhooks

MM API for WhatsApp triggers status [messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status) webhooks (sent, delivered, read). In addition, status messages webhooks that describe a message sent via MM API for WhatsApp, and that include pricing information, will have `pricing.category` and `conversation.type` set to `marketing_lite`. If the message is routed via Cloud API, `pricing.category` will be set to `marketing`.

```https
&#123;
  &quot;conversation&quot;: &#123;
    &quot;id&quot;: &quot;&lt;CONVERSATION_ID&gt;&quot;,
    &quot;origin&quot;: &#123;
      &quot;type&quot;: &quot;marketing_lite&quot;
    &#125;
  &#125;,
  &quot;pricing&quot;: &#123;
    &quot;billable&quot;: true,
    &quot;pricing_model&quot;: &quot;PMP&quot;,
    &quot;category&quot;: &quot;marketing_lite&quot;
  &#125;
&#125;
```

Maintain logs of each outgoing message ID, and whether that ID was sent via Cloud API or MM API for WhatsApp, in order to use the unique message ID returned in message status webhooks to identify the origin of the sent message.

## Receiving incoming messages

MM API for WhatsApp is a send-only API. It does not receive incoming messages from consumers. To receive incoming messages on a business phone number, use Cloud API in parallel with MM API for WhatsApp on the same phone number.


---

Full documentation index for this product: https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt
