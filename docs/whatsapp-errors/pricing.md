# Set a max price for marketing messages (BETA)



**Note:** The max price feature on the MM API for WhatsApp enables businesses to **increase ROI** and have **more control over their marketing message spend**. Max price enters open beta on October 1, 2026. View our [explainer asset on Highspot](https://meta.highspot.com/items/69aedbc000c74039fc1633d7#1) for go-to-market details.

## What is a max price?

In 2026, Meta is introducing new pricing features on the Marketing Messages API for WhatsApp to enable businesses to control and optimize spend for their marketing messaging campaigns.

The first pricing feature allows you to **set a maximum price (max price) per marketing message delivery; when a max price is set, Meta will charge that max price or lower for delivery**. Businesses can choose to set a max price the same as, lower than, or higher than the published rate to achieve their objectives per campaign.

- *Lower costs while maintaining delivery rates similar to current WhatsApp campaigns*, by setting max prices the same as published rates.
- Reach more customer cohorts on WhatsApp at lower cost, by setting max prices lower than published rates.
- Increase delivery rates during periods such as holidays and peak sales periods, by setting max prices higher than published rates.

The second pricing feature is the **reach estimation tool**, which helps businesses set the right max price by helping them understand estimated delivery rates and costs at different max prices.

### Max price explainer

The max price feature allows you to set the maximum price you are willing to pay per message delivery. Meta charges your max price or lower. In the API, you express this as a `bid_amount` value per 1,000 deliveries within the `optimization_spec` object.

- [Max price explainer PDF](https://meta.highspot.com/items/69c54bf9ee04590bb215a1b5?lfrm=srp.1#1)

**Note:** A max price is a bid cap, not a budget. The `bid_amount` you set in `optimization_spec` is the most Meta charges per 1,000 message deliveries, and `bid_strategy` must be `LOWEST_COST_WITH_BID_CAP` whenever you set a `bid_amount`. A bid cap is independent of a `daily_budget` or `lifetime_budget`, which cap how much a campaign spends over a day or over its lifetime, so a template with a max price can send in a campaign that also sets a budget. The two are not mutually exclusive.

## Phased roll-out of the max price feature

The max price feature rolls out in three phases:

1. Limited Beta starting **May 15, 2026** -- Any partner and any directly integrated business can integrate and use the max price feature and reach estimation tool. Each partner can enable these features for a limited number of clients.
2. Open Beta starting **October 2026** -- Any partner can enable these features for all their clients.
3. General Availability (GA) as of **Q2 2027** -- The max price feature will become required in eligible geographies and fixed, published rates for marketing messages will only apply on the Cloud API.

## Before you begin

To use the max price feature, you must:

- Have an active Messaging account that has been [onboarded](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding) to the Marketing Messages API for WhatsApp.
- Be in a [country eligible for MM API for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started#geographic-availability-of-features).

## Recommendations

**Note:** Max price is an early-stage feature; performance may vary as Meta&#039;s systems learn and improve.

1. **Set your max price at the template level.** The `bid_amount` in `optimization_spec` is what Meta&#039;s delivery system optimizes against. Setting the right max price when you create the template gives the system the best signal for delivery optimization.

2. **Set `bid_amount` to your highest acceptable price and use `per_message_bid_multiplier` to scale down.** Set the template&#039;s `bid_amount` to the highest amount you are willing to pay per 1,000 deliveries, then apply a `per_message_bid_multiplier` of less than 1 to lower the effective max price for individual messages. This gives the delivery system the widest range to optimize against and generally improves overall performance.

   For example, if you set a template&#039;s `bid_amount` to 100,000 and apply a multiplier of 0.5 to a message, the effective max price for that message is 50,000.

3. **Ramp up traffic gradually.** When sending messages with a new max price template for the first time, increase volume slowly before sending at scale. This aligns with [Template pacing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing) best practices and helps the delivery system optimize effectively.

4. **Start with A/B tests.** This helps you assess the impact of different bidding rates on your delivery rates and cost per delivery. Run a four-arm test (10,000 send requests per arm) with a similar audience and time window, with the following conditions:
   - Arm A: No max price set
   - Arm B: Max price set at rate card
   - Arm C: Max price set at 1.5x rate card (1.2x for India and Saudi Arabia)
   - Arm D: Max price set at 0.9x rate card

## Create templates with max price

Use the [Message Templates API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api#post-version-waba-id-message-templates) to set a maximum price and include the `optimization_spec` object in the request body.

**Note:** `optimization_spec` replaces `bid_spec` as of June 18, 2026. `bid_spec` continues to be accepted until July 31, 2026, after which it is no longer supported. The `bid_amount` and `bid_strategy` fields are identical in both objects.

### Request syntax

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;/message_templates&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039; \
  -H &#039;Content-Type: application/json&#039; \
  -d &#039;
  &#123;
    &quot;name&quot;: &quot;seasonal_sale_promo&quot;,
    &quot;category&quot;: &quot;MARKETING&quot;,
    &quot;language&quot;: &quot;en&quot;,
    &quot;components&quot;: [
      &#123;
        &quot;type&quot;: &quot;BODY&quot;,
        &quot;text&quot;: &quot;Shop our seasonal sale! Up to 50% off selected items.&quot;
      &#125;
    ],
    &quot;optimization_spec&quot;: &#123;
      &quot;bid_amount&quot;: &lt;BID_AMOUNT&gt;,
      &quot;bid_strategy&quot;: &quot;LOWEST_COST_WITH_BID_CAP&quot;,
      &quot;bid_country_multiplier_overrides&quot;: &#123; &quot;IN&quot;: 1.2, &quot;MX&quot;: 0.8 &#125;
    &#125;
&#125;&#039;
```

If `optimization_spec` is not included, the template uses standard rate card pricing.

### Request parameters

| Placeholder | Description | Example Value |
| --- | --- | --- |
| `&lt;ACCESS_TOKEN&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;[System token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#system-user-access-tokens) or [business token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens). | `EAAA...` |
| `&lt;API_VERSION&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Optional.**&lt;br&gt;&lt;br&gt;Graph API version. | v27.0 |
| `&lt;WABA_ID&gt;`&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;Messaging account ID. | `102290129340398` |
| `&lt;BID_AMOUNT&gt;`&lt;br&gt;&lt;br&gt;_int32_ | **Required.**&lt;br&gt;&lt;br&gt;Maximum price per 1,000 message deliveries, expressed in your Messaging account currency&#039;s smallest unit (cents for USD, paise for INR, peso for MXN). See [supported currencies](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing#updates-to-rate-cards) for a list of currencies. | `87000` |
| `&lt;BID_STRATEGY&gt;`&lt;br&gt;&lt;br&gt;_Enum_ | **Required.**&lt;br&gt;&lt;br&gt;The bid strategy to use. Currently supports only `LOWEST_COST_WITH_BID_CAP`. | `LOWEST_COST_WITH_BID_CAP` |
| `bid_country_multiplier_overrides`&lt;br&gt;&lt;br&gt;_Object (map of String to Float)_ | **Optional.**&lt;br&gt;&lt;br&gt;Map of destination country to a bid multiplier, set inside `optimization_spec`. Keys are ISO 3166-1 alpha-2 country codes; each value is the multiplier applied to `bid_amount` for sends to that country. Countries you do not list use a multiplier of `1.0` (the unmodified `bid_amount`).&lt;br&gt;&lt;br&gt;**Constraints on `bid_country_multiplier_overrides`**&lt;br&gt;&lt;br&gt;- Up to **240** entries.&lt;br&gt;- Each multiplier must be **greater than `0` and at most `10`**.&lt;br&gt;- Keys must be valid **ISO 3166-1 alpha-2** country codes (for example, `MX`, `IN`, `BR`). | `&#123;&quot;IN&quot;: 1.2, &quot;BR&quot;: 1.5, &quot;MX&quot;: 0.8&#125;` |

### Calculating max price amounts

The `bid_amount` represents your max price per 1,000 deliveries in your Messaging account currency&#039;s smallest unit. To convert from your desired per-delivery price:

- Convert your desired per-delivery price to your Messaging account currency&#039;s smallest unit
- Multiply by 1,000 to express the value per 1,000 deliveries

**Example**: To set a max price of ₹0.87 per delivery:

- Convert to paise: 0.87 Rupees = 87 paise
- Multiply by 1,000: 87 x 1,000 = 87,000

Set `bid_amount` to `87000`.

**Example**: To set a max price of $0.05 USD per delivery:

- Convert to cents: $0.05 = 5 cents
- Multiply by 1,000: 5 x 1,000 = 5,000

Set `bid_amount` to `5000`.

### How &quot;optional&quot; per-country bid multipliers work

A per-country bid multiplier scales the template&#039;s `bid_amount` (max price) for a specific destination country, so you can bid more or less in some countries without creating a separate template for each one. You set the multipliers in the `bid_country_multiplier_overrides` map inside `optimization_spec`.

When a message is sent, Meta determines the recipient&#039;s country from their phone number and applies the matching multiplier to the template&#039;s `bid_amount` to produce the effective bid for that message:

Effective bid = `bid_amount` x `country_multiplier`

If the recipient&#039;s country is not listed in the map, the multiplier is `1.0`, so the template&#039;s `bid_amount` is used unchanged. The effective bid is the maximum price Meta uses for that delivery — as with any max price, Meta charges that amount or lower per message delivered. A higher multiplier raises the max price for that country (which can increase delivery rates and cost per delivery); a lower multiplier lowers it.

**Example**

A template has `bid_amount = 1000` (per 1,000 deliveries, in your Messaging account currency&#039;s smallest unit) and this override map:

`&quot;bid_country_multiplier_overrides&quot;: &#123; &quot;IN&quot;: 1.2, &quot;MX&quot;: 0.8 &#125;`

The effective bid then depends on where each message is sent:

| Recipient country | Multiplier applied | Effective bid (per 1,000 messages delivered) |
| --- | --- | --- |
| India (`IN`) | 1.2 | 1000 x 1.2 = **1,200** |
| Mexico (`MX`) | 0.8 | 1000 x 0.8 = **800** |
| Brazil (`BR`) — not listed | 1.0 (default) | 1000 x 1.0 = **1,000** |

## Retrieve max price information

Use the [Template API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api#get-version-template-id) to get the max price setting on an existing template by querying the `optimization_spec` field.

**Note:** Query `optimization_spec` as of June 18, 2026. Querying `bid_spec` continues to return the max price configuration until July 31, 2026, after which only `optimization_spec` is supported.

### Request syntax

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;TEMPLATE_ID&gt;/?fields=optimization_spec&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039;
```

### Request parameters

| Placeholder | Description | Example Value |
| --- | --- | --- |
| `&lt;ACCESS_TOKEN&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;[System token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#system-user-access-tokens) or [business token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens). | `EAAA...` |
| `&lt;API_VERSION&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Optional.**&lt;br&gt;&lt;br&gt;Graph API version. | v27.0 |
| `&lt;TEMPLATE_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;ID of the WhatsApp message template. | `1733678867511493` |

### Example response

```json
&#123;
  &quot;optimization_spec&quot;: &#123;
    &quot;bid_strategy&quot;: &quot;LOWEST_COST_WITH_BID_CAP&quot;,
    &quot;bid_amount&quot;: 87000,
    &quot;bid_country_multiplier_overrides&quot;: [
      &#123;&quot;key&quot;: &quot;IN&quot;, &quot;value&quot;: 1.2&#125;,
      &#123;&quot;key&quot;: &quot;BR&quot;, &quot;value&quot;: 1.5&#125;,
      &#123;&quot;key&quot;: &quot;MX&quot;, &quot;value&quot;: 0.8&#125;
    ]
  &#125;,
  &quot;id&quot;: &quot;1733678867511493&quot;
&#125;
```

**Note:** **Reading `bid_country_multiplier_overrides`.** When you **read** `bid_country_multiplier_overrides`, it is returned as a list of `&#123;&quot;key&quot;: &lt;country_code&gt;, &quot;value&quot;: &lt;multiplier&gt;&#125;` objects. When you **write** it, you pass a map (`&#123;&quot;IN&quot;: 1.2&#125;`). This is expected: the read and write formats differ. The field returns an empty list if the template has no multipliers set.

## Update max price for templates

Use the [Template API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api#post-version-template-id) to update the max price setting on an existing template.

Templates can switch between rate card pricing and max price without creating a new template when the Messaging account is [enrolled in the max price feature](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/pricing/enroll-max-price):

- **Rate card pricing:** The template has no maximum price configured and uses the applicable published rate.
- **Max price:** The template has a maximum price per 1,000 message deliveries.

**Note:** Send updates using `optimization_spec` as of June 18, 2026. Updates sent with `bid_spec` continue to be accepted until July 31, 2026, after which only `optimization_spec` is supported.

Other constraints follow the standard [template editing limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview):

- **Approved templates**: Up to 100 edits per hour, 2,400 per day. Content edits still follow the existing limit of 1 per day and 10 per 30 days.
- **Rejected or paused templates**: Unlimited edits

### Set or update a max price

Set both `bid_amount` and `bid_strategy` in `optimization_spec`. Use the same request to change the amount when the template already has a max price.

#### Request syntax &#123;#set-or-update-max-price-request-syntax&#125;

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;TEMPLATE_ID&gt;/&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039; \
  -H &#039;Content-Type: application/json&#039; \
  -d &#039;&#123;
  &quot;optimization_spec&quot;: &#123;
    &quot;bid_strategy&quot;: &quot;LOWEST_COST_WITH_BID_CAP&quot;,
    &quot;bid_amount&quot;: &lt;BID_AMOUNT&gt;,
    &quot;bid_country_multiplier_overrides&quot;: &#123; &quot;IN&quot;: 1.4, &quot;MX&quot;: 0.9 &#125;
  &#125;
&#125;&#039;
```

**Note:** After you update a template, it can take up to one hour for the new bid values to propagate through our system. Messages sent during this period may experience reduced performance.

### Remove a max price and return to rate card pricing

Set both `bid_amount` and `bid_strategy` to `null`. This clears the template-level maximum price and returns the template to standard rate card pricing.

This action also clears all `bid_country_multiplier_overrides`, if any. If you later switch back to max price, include any country overrides you want to restore.

#### Request syntax &#123;#remove-max-price-request-syntax&#125;

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;TEMPLATE_ID&gt;/&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039; \
  -H &#039;Content-Type: application/json&#039; \
  -d &#039;&#123;
  &quot;optimization_spec&quot;: &#123;
    &quot;bid_strategy&quot;: null,
    &quot;bid_amount&quot;: null
  &#125;
&#125;&#039;
```

**Warning:** Omitting `optimization_spec` from an update does not request a pricing-mode change. To return to rate card pricing, `optimization_spec` must contain exactly `bid_amount` and `bid_strategy`, with both explicitly set to `null`. Do not include any other fields.

### Request parameters

| Placeholder | Description | Example Value |
| --- | --- | --- |
| `&lt;ACCESS_TOKEN&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;[System token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#system-user-access-tokens) or [business token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens). | `EAAA...` |
| `&lt;API_VERSION&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Optional.**&lt;br&gt;&lt;br&gt;Graph API version. | v27.0 |
| `&lt;TEMPLATE_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;ID of the WhatsApp message template. | `1733678867511493` |
| `&lt;BID_AMOUNT&gt;`&lt;br&gt;&lt;br&gt;_int32_ | **Required for max price.**&lt;br&gt;&lt;br&gt;Maximum price per 1,000 message deliveries, expressed in your Messaging account currency&#039;s smallest unit. | `5000` |
| `&lt;BID_STRATEGY&gt;`&lt;br&gt;&lt;br&gt;_Enum_ | **Required for max price.**&lt;br&gt;&lt;br&gt;The bid strategy to use. Currently supports only `LOWEST_COST_WITH_BID_CAP`. | `LOWEST_COST_WITH_BID_CAP` |
| `bid_country_multiplier_overrides`&lt;br&gt;&lt;br&gt;_Object (map of String to Float)_ | **Optional.**&lt;br&gt;&lt;br&gt;Map of destination country to a bid multiplier (ISO 3166-1 alpha-2 keys). Same constraints as create: up to 240 entries, each multiplier greater than `0` and at most `10`.&lt;br&gt;&lt;br&gt;**Update behavior for `bid_country_multiplier_overrides`**&lt;br&gt;&lt;br&gt;- Whenever you send `optimization_spec` to set or update a max price, you must include `bid_amount` and `bid_strategy`.&lt;br&gt;- When setting or updating a max price, **omit** `bid_country_multiplier_overrides` to keep the current map unchanged.&lt;br&gt;- When setting or updating a max price, send an **empty object** (`&#123;&#125;`) to remove all overrides.&lt;br&gt;- A non-empty map **fully replaces** the existing map — it is not merged with it. Send the complete set of countries you want each time.&lt;br&gt;- When returning to rate card pricing, omit this field. The reset clears all overrides even when this field is omitted. | `&#123;&quot;IN&quot;: 1.4, &quot;MX&quot;: 0.9&#125;` |

### Update behavior while using max price

| Current pricing mode | Update | Result |
| --- | --- | --- |
| Rate card pricing | Non-null `bid_amount` and supported `bid_strategy` | The template switches to max price. |
| Max price | Different non-null `bid_amount` and supported `bid_strategy` | The template remains in max price mode with the updated amount. |
| Max price | Both bid fields explicitly set to `null` | The template switches to rate card pricing and clears all country multiplier overrides. |
| Either mode | `optimization_spec` omitted | The pricing mode does not change. |

### Common errors

| Condition | Resolution |
| --- | --- |
| Only one bid field is supplied. | Send both `bid_amount` and `bid_strategy`, or set both to `null` when returning to rate card pricing. |
| A reset request includes any other non-null field in `optimization_spec`. | Send an `optimization_spec` object that contains only `bid_amount` and `bid_strategy`, with both set to `null`. |
| An unsupported bid strategy is supplied. | Use `LOWEST_COST_WITH_BID_CAP`. |
| Pricing-mode switching is unavailable for the account or template, and you try to set a max price on a rate-card template. | Confirm that the Messaging account is enrolled in the max price feature and the template was not created for campaign sends. The API returns `You are not allowed to update bid_spec for a template that does not have bid_spec.` |
| Pricing-mode switching is unavailable for the account or template, and you try to remove an existing max price. | Confirm that the Messaging account is enrolled in the max price feature and the template was not created for campaign sends. The request fails with `bid_strategy is required`. |

## Adjust max price when sending messages

**Warning:** The message-level max price multiplier is subject to change during the beta period.

Use the [Marketing Messages API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/marketing-messages-api-for-whatsapp) to apply a multiplier at sending time to adjust the template-level max price for individual messages. This allows you to adjust the max price for individual messages without editing the template.

### Request syntax

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;WHATSAPP_BUSINESS_PHONE_NUMBER_ID&gt;/marketing_messages&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039; \
  -H &#039;Content-Type: application/json&#039; \
  -d &#039;&#123;
  &quot;recipient_type&quot;: &quot;individual&quot;,
  &quot;messaging_product&quot;: &quot;whatsapp&quot;,
  &quot;to&quot;: &quot;&lt;WHATSAPP_USER_PHONE_NUMBER&gt;&quot;,
  &quot;type&quot;: &quot;template&quot;,
  &quot;template&quot;: &#123;
    &quot;name&quot;: &quot;seasonal_sale_promo&quot;,
    &quot;language&quot;: &#123;
      &quot;code&quot;: &quot;en&quot;
    &#125;
  &#125;,
  &quot;bid_spec&quot;: &#123;
    &quot;per_message_bid_multiplier&quot;: &quot;&lt;PER_MESSAGE_BID_MULTIPLIER&gt;&quot;
  &#125;
&#125;&#039;
```

In this example, the multiplier of 1.5 increases the template&#039;s `bid_amount` by 50%. If the template&#039;s `bid_amount` is 2000, the effective max price for this message becomes 3000.

### Request parameters

| Placeholder | Description | Example Value |
| --- | --- | --- |
| `&lt;ACCESS_TOKEN&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;[System token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#system-user-access-tokens) or [business token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens). | `EAAA...` |
| `&lt;API_VERSION&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Optional.**&lt;br&gt;&lt;br&gt;Graph API version. | v27.0 |
| `&lt;WHATSAPP_BUSINESS_PHONE_NUMBER_ID&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;WhatsApp business phone number ID. | `106540352242922` |
| `&lt;WHATSAPP_USER_PHONE_NUMBER&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;WhatsApp user phone number. | `+16505551234` |
| `&lt;PER_MESSAGE_BID_MULTIPLIER&gt;`&lt;br&gt;&lt;br&gt;_Float_ | **Optional.** Default: `1`&lt;br&gt;&lt;br&gt;A positive multiplier applied to the template&#039;s `bid_amount`. For example, `1.5` increases the max price by 50%, `0.5` decreases it by 50%, and `1` (default) uses the template&#039;s max price amount unchanged. | `1.5` |

## Estimate reach and costs

The Reach estimation helps you understand your expected deliveries and costs at different max price levels.

### Request syntax

Use the [WhatsApp Business Account API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api#get-version-waba-id) to get the estimated delivery ranges and cost ranges at various max price amounts.

Meta generates estimates from historical data, and they are for informational and planning purposes only. They do not guarantee future delivery outcomes, costs, or performance. Actual results may differ due to changes in platform conditions or other variables.

The `targeting_spec` value must be serialized JSON. For example:

```html
curl &#039;https://graph.facebook.com/&lt;API_VERSION&gt;/&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;/reachestimate?targeting_spec=&#123;&quot;geo_locations&quot;:&#123;&quot;countries&quot;:[&quot;IN&quot;]&#125;&#125;&amp;date_interval=&lt;DATE_INTERVAL&gt;&#039; \
  -H &#039;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&#039;
```

### Request parameters

| Placeholder | Description | Example Value |
| --- | --- | --- |
| `&lt;ACCESS_TOKEN&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;[System token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#system-user-access-tokens) or [business token](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens). | `EAAA...` |
| `&lt;API_VERSION&gt;`&lt;br&gt;&lt;br&gt;_String_ | **Optional.**&lt;br&gt;&lt;br&gt;Graph API version. | v27.0 |
| `&lt;WABA_ID&gt;`&lt;br&gt;_String_ | **Required.**&lt;br&gt;&lt;br&gt;Messaging account ID. | `102290129340398` |
| `&lt;DATE_INTERVAL&gt;`&lt;br&gt;&lt;br&gt;_Enum_ | **Required.**&lt;br&gt;&lt;br&gt;Lookback period for the historical data used to generate estimates. One of: `L1D` (last 1 day), `L7D` (last 7 days), `L14D` (last 14 days), `L28D` (last 28 days). | `L7D` |
| `&lt;TARGETING_SPEC&gt;`&lt;br&gt;&lt;br&gt;_JSON_ | **Required.**&lt;br&gt;&lt;br&gt;Serialized JSON specifying geographic targeting. Must include `geo_locations` with a `countries` array. | `&#123;&quot;geo_locations&quot;:&#123;&quot;countries&quot;:[&quot;IN&quot;]&#125;&#125;` |

### Example response

```json
&#123;
  &quot;waba_currency&quot;: &quot;USD&quot;,
  &quot;estimates&quot;: [
    &#123;
      &quot;bid_amount&quot;: 400,
      &quot;users&quot;: 1000,
      &quot;deliveries_lower_bound&quot;: 500,
      &quot;deliveries_upper_bound&quot;: 570,
      &quot;cost_lower_bound&quot;: 389.74,
      &quot;cost_upper_bound&quot;: 390.74
    &#125;,
    &#123;
      &quot;bid_amount&quot;: 520,
      &quot;users&quot;: 1000,
      &quot;deliveries_lower_bound&quot;: 600,
      &quot;deliveries_upper_bound&quot;: 650,
      &quot;cost_lower_bound&quot;: 400.74,
      &quot;cost_upper_bound&quot;: 510.74
    &#125;
  ]
&#125;
```

The response contains multiple `estimates` entries at different max price amounts, allowing you to compare expected delivery volumes and costs across price points.

### Response fields

| Field | Description |
| --- | --- |
| `waba_currency` | The currency of your Messaging account. |
| `bid_amount` | Max price per 1,000 message deliveries, in the Messaging account currency&#039;s smallest unit. |
| `users` | Targeted user count. Fixed at 1,000 during beta. |
| `deliveries_lower_bound` | Lower bound of the estimated delivery range for this max price amount. |
| `deliveries_upper_bound` | Upper bound of the estimated delivery range for this max price amount. |
| `cost_lower_bound` | Lower bound of the estimated average cost per 1,000 deliveries, in the Messaging account currency&#039;s smallest unit. |
| `cost_upper_bound` | Upper bound of the estimated average cost per 1,000 deliveries, in the Messaging account currency&#039;s smallest unit. |

## Metrics and billing

Starting November 1, 2026, max price traffic uses a separate billing SKU and reporting identifiers from published-rate traffic. See [Max price billing SKU](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/pricing/max-price-billing-sku) for invoice examples and migration guidance.

Marketing messages sent with max price appear in analytics with the following identifiers:

- **Pricing Analytics** [`/&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;?fields=pricing_analytics`](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#pricing-analytics): `pricing_category` = `MARKETING_LITE_DYNAMIC`
- **Template Analytics** [`/&lt;WHATSAPP_BUSINESS_ACCOUNT_ID&gt;?fields=template_analytics`](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#template-analytics): `product_type` = `MARKETING_MESSAGES_LITE_API` and `cost[].type` = `amount_spent_max_price`

Webhooks use lowercase `marketing_lite_dynamic` for `pricing.category`, while the Pricing Analytics API uses uppercase `MARKETING_LITE_DYNAMIC` for `pricing_category`. When max price is enabled, the delivered and read status webhooks also include a `cost` object with the estimated charge for the message.

### Delivered/read webhook example (with max price)

```json
&quot;pricing&quot;: &#123;
  &quot;billable&quot;: true,
  &quot;pricing_model&quot;: &quot;PMP&quot;,
  &quot;category&quot;: &quot;marketing_lite_dynamic&quot;,
  &quot;type&quot;: &quot;regular&quot;,
  &quot;cost&quot;: &#123;
    &quot;amount&quot;: 0.035,
    &quot;currency&quot;: &quot;USD&quot;
  &#125;
&#125;
```

#### Webhook cost fields

| Field | Type | Description |
| --- | --- | --- |
| `amount` | Float | Cost of the delivered or read message. Appears on `delivered` and `read` events. The unit is the currency base unit (dollar for USD, rupee for INR), consistent with the analytics API `cost` field. |
| `currency` | String | Messaging account-supported currency in ISO format. |

*The price reported in the delivered/read webhook may differ from the final charge on your invoice due to small variations in data processing (same as Analytics API). Your billing invoice is the source of truth for final pricing.*

### Pricing analytics response example

```json
&#123;
  &quot;pricing_analytics&quot;: &#123;
    &quot;data&quot;: [
      &#123;
        &quot;data_points&quot;: [
          &#123;
            &quot;start&quot;: 1748761200,
            &quot;end&quot;: 1748847600,
            &quot;country&quot;: &quot;IN&quot;,
            &quot;pricing_type&quot;: &quot;REGULAR&quot;,
            &quot;pricing_category&quot;: &quot;MARKETING_LITE_DYNAMIC&quot;,
            &quot;volume&quot;: 1,
            &quot;cost&quot;: 10
          &#125;
        ]
      &#125;
    ]
  &#125;
&#125;
```

### Template analytics response example

```json
&#123;
  &quot;data&quot;: [
    &#123;
      &quot;granularity&quot;: &quot;DAILY&quot;,
      &quot;product_type&quot;: &quot;MARKETING_MESSAGES_LITE_API&quot;,
      &quot;data_points&quot;: [
        &#123;
          &quot;template_id&quot;: &quot;1421988012088524&quot;,
          &quot;start&quot;: 1718064000,
          &quot;end&quot;: 1718150400,
          &quot;sent&quot;: 1,
          &quot;delivered&quot;: 1,
          &quot;read&quot;: 1,
          &quot;cost&quot;: [
            &#123;
              &quot;type&quot;: &quot;amount_spent&quot;,
              &quot;value&quot;: 0.01
            &#125;,
            &#123;
              &quot;type&quot;: &quot;amount_spent_max_price&quot;,
              &quot;value&quot;: 0.01
            &#125;,
            &#123;
              &quot;type&quot;: &quot;cost_per_delivered&quot;,
              &quot;value&quot;: 0.01
            &#125;
          ]
        &#125;
      ]
    &#125;
  ]
&#125;
```

For more details on metrics, see [Viewing metrics](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/view-metrics).

## Error codes

| Code | Message | Possible reasons and solutions |
| --- | --- | --- |
| 131061 | Marketing templates containing bid_spec are not supported by the Cloud API. To use templates with bid_spec, please use the Marketing Messages API for WhatsApp. | You are sending a template that has a max price set (`optimization_spec`, or `bid_spec` before its July 31, 2026 deprecation) to the Cloud API `/messages` endpoint. Send to the `/marketing_messages` endpoint instead. |
| 131065 | Templates using bid_spec are not supported for recipients in this country. | You sent a max price template (`optimization_spec`) to a WhatsApp user in a country where max price delivery is unavailable. Send the template to a WhatsApp user in a supported country, or use a rate-card template without `optimization_spec`. See [Geographic availability of features](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started#geographic-availability-of-features). |
| 100 | You need to sign the testing legal agreement before sending out messages. | You have not signed the testing legal agreement. Please sign the agreement to gain access to this feature. |

For a full list of error codes, see [Error codes](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes).


---

Full documentation index for this product: https://developers.facebook.com/documentation/business-messaging/whatsapp/llms.txt
