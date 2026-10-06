# SMS  (ref_folder)


## A2PGetSmsHistory  (api_method)

Gets the history of sent/or received A2P SMS.

_roles: Owner, Admin, CallsSMS_

**Returns:** 

- `count` — Maximum number of resulting rows fetched. Should be not bigger than 1000. If left blank, then the default value of 1000 is used

- `delivery_status` — The delivery status ID: QUEUED - 1, DISPATCHED - 2, ABORTED - 3, REJECTED - 4, DELIVERED - 5, FAILED - 6, EXPIRED - 7, UNKNOWN - 8

- `destination_number` — The destination phone number

- `from_date` — Date from which the search is to start. Format is 'yyyy-MM-dd HH:mm:ss', time zone is UTC

- `message_id` — Message id list separated by semicolons (;)

- `offset` — The first <b>N</b> records are skipped in the output

- `output` — The output format. The following values available: **json**, **csv**, **xls**. The default value is **json**

- `source_number` — The source phone number

- `to_date` — Date from which the search is to end. Format is 'yyyy-MM-dd HH:mm:ss', time zone is UTC


## A2PSendSms  (api_method)

Sends an A2P SMS message from the application to customers. A SenderID is required for A2P messages. Please contact support for installing a SenderID.

_roles: CallsSMS_

**Returns:** 

- `dst_numbers` — The destination phone numbers separated by semicolons (;). The maximum number of these phone numbers is 100

- `src_number` — The SenderID for outgoing SMS. Please contact support for installing a SenderID

- `store_body` — Whether to store outgoing message texts. Default value is false

- `text` — The message text, up to 1600 characters. We split long messages greater than 160 GSM-7 characters or 70 UTF-16 characters into multiple segments. Each segment is charged as one message


## ControlSms  (api_method)

Enables or disables sending and receiving SMS for the phone number. Can be used only for phone numbers with SMS support, which is indicated by the <b>is_sms_supported</b> property in the objects returned by the [GetPhoneNumbers](/docs/references/httpapi/phonenumbers#getphonenumbers) Management API. Each incoming SMS message is charged according to the <a href='//voximplant.com/pricing'>pricing</a>. If enabled, SMS can be sent from this phone number via the [SendSmsMessage](/docs/references/httpapi/sms#sendsmsmessage) Management API and received via the [InboundSmsCallback](/docs/references/httpapi/structure/inboundsmscallback) property of the HTTP callback. See <a href='/docs/guides/managementapi/callbacks'>this article</a> for HTTP callback details.

_roles: Owner, Admin, Developer, Accountant_

**Returns:** 

- `command` — The SMS control command. The following values are possible: enable, disable

- `phone_number` — The phone number


## GetSmsHistory  (api_method)

Gets the history of sent and/or received SMS.

_roles: Owner, Admin, Developer, Supervisor, Accountant, CallsSMS_

**Returns:** 

- `count` — Maximum number of resulting rows fetched. Should be not bigger than 1000. If left blank, then the default value of 1000 is used

- `destination_number` — The destination phone number

- `direction` — Sent or received SMS. Possible values: 'IN', 'OUT', 'in, 'out'. Leave blank to get both incoming and outgoing messages

- `from_date` — Date from which to perform search. Format is 'yyyy-MM-dd HH:mm:ss', time zone is UTC

- `message_id` — Message id list separated by semicolons (;)

- `offset` — The first <b>N</b> records are skipped in the output

- `output` — The output format. The following values available: **json**, **csv**, **xls**. The default value is **json**

- `source_number` — The source phone number

- `timezone` — The selected timezone or the 'auto' value (the account location)

- `to_date` — Date until which to perform search. Format is 'yyyy-MM-dd HH:mm:ss', time zone is UTC


## SendSmsMessage  (api_method)

Sends an SMS message between two phone numbers. The source phone number should be purchased from Voximplant and support SMS (which is indicated by the <b>is_sms_supported</b> property in the objects returned by the [GetPhoneNumbers](/docs/references/httpapi/phonenumbers#getphonenumbers) Management API) and SMS should be enabled for it via the [ControlSms](/docs/references/httpapi/sms#controlsms) Management API. SMS messages can be received via HTTP callbacks, see <a href='/docs/guides/managementapi/callbacks'>this article</a> for details.

_roles: Owner, Admin, Developer, CallsSMS_

**Returns:** 

- `destination` — The destination phone number

- `sms_body` — The message text, up to 765 characters. We split long messages greater than 160 GSM-7 characters or 70 UTF-16 characters into multiple segments. Each segment is charged as one message

- `source` — The source phone number

- `store_body` — Whether to store outgoing message texts. Default value is false
