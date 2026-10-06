# WABPhoneNumbers  (ref_folder)


## AddWABPhoneNumber  (api_method)

Adds a new WhatsApp Business phone number.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `application_id` — Bound application ID

- `application_name` — Bound application name that can be used instead of <b>application_id</b>

- `description` — WhatsApp Business phone number description

- `rule_id` — Bound rule ID

- `rule_name` — Bound rule name that can be used instead of <b>rule_id</b>

- `voice_password` — WhatsApp Business SIP password

- `wab_phone_number` — WhatsApp Business phone number


## DeleteWABPhoneNumber  (api_method)

Deletes a WhatsApp Business phone number.

_roles: Owner_

**Returns:** 

- `wab_phone_number` — WhatsApp Business phone number to delete


## GetWABPhoneNumbers  (api_method)

Gets the account's WhatsApp Business phone numbers.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer_

**Returns:** 

- `application_id` — Application ID that is bound to the WhatsApp Business phone number

- `application_name` — Bound application name that can be used instead of <b>application_id</b>

- `count` — Maximum returning records count

- `country_code` — Country code filter (2 symbols) for the WhatsApp Business phone number

- `offset` — Number of records to be skipped in the result

- `wab_phone_number` — WhatsApp Business phone number


## SetWABPhoneNumberInfo  (api_method)

Sets details for the specified WhatsApp Business phone number.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `application_id` — Bound application ID

- `application_name` — Bound application name that can be used instead of <b>application_id</b>

- `description` — New WhatsApp Business phone number description

- `rule_id` — Bound rule ID

- `rule_name` — Bound rule name that can be used instead of <b>rule_id</b>

- `voice_password` — New WhatsApp Business SIP password

- `wab_phone_number` — WhatsApp Business phone number to change details for
