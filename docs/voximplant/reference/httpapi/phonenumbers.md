# PhoneNumbers  (ref_folder)


## AttachPhoneNumber  (api_method)

Attach the phone number to the account. There are two modes:<br><ol><li>Purchase from the catalog — specify <b>country_code</b>, <b>phone_category_name</b> and <b>phone_region_id</b> together; the platform picks the number. The [GetNewPhoneNumbers](/docs/references/httpapi/phonenumbers#getnewphonenumbers) method with the same three locators lists the numbers available for purchase.</li><li>Attach a specific phone number — pass <b>phone_number</b>; the three locators are not required. The [GetNewPhoneNumbers](/docs/references/httpapi/phonenumbers#getnewphonenumbers) method without the locators returns the numbers already available to the account, which are the ones this mode accepts.</li></ol>Note that phone numbers of some countries may require additional verification steps.<br><br>Please note that when you purchase a phone number, we reserve the subscription fee and taxes for the upcoming month. Read more in the <a href='/docs/gettingstarted/billing'>Billing</a> page.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `country_code` — The country code. <b>Required</b> together with <b>phone_category_name</b> and <b>phone_region_id</b> to purchase from the catalog; not needed when attaching a specific phone number via <b>phone_number</b>

- `country_state` — The country state. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) and [GetPhoneNumberCountryStates](/docs/references/httpapi/phonenumbers#getphonenumbercountrystates) methods

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method. <b>Required</b> together with <b>country_code</b> and <b>phone_region_id</b> to purchase from the catalog; not needed when attaching a specific phone number via <b>phone_number</b>

- `phone_count` — Quantity of phone numbers you want to attach. If neither this parameter nor <b>phone_number</b> is specified, one phone number is attached from the catalog

- `phone_number` — The phone numbers to attach, separated by semicolons (;). See the [GetNewPhoneNumbers](/docs/references/httpapi/phonenumbers#getnewphonenumbers) method. If neither this parameter nor <b>phone_count</b> is specified, one phone number is attached from the catalog

- `phone_region_id` — The phone region ID. See the [GetPhoneNumberRegions](/docs/references/httpapi/phonenumbers#getphonenumberregions) method. <b>Required</b> together with <b>country_code</b> and <b>phone_category_name</b> to purchase from the catalog; not needed when attaching a specific phone number via <b>phone_number</b>

- `regulation_address_id` — The phone regulation address ID


## BindPhoneNumberToApplication  (api_method)

Bind the phone number to the application or unbind the phone number from the application. You should specify the application_id or application_name if you specify the rule_name.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `bind` — Whether to bind or unbind (set true or false respectively)

- `phone_id` — The phone ID list separated by semicolons (;). Use the 'all' value to select all phone ids. <b>Required</b> unless <b>phone_number</b> is provided.

- `phone_number` — The phone number list separated by semicolons (;). <b>Required</b> unless <b>phone_id</b> is provided.

- `rule_id` — The rule ID. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name. Can be used instead of the <b>rule_id</b> parameter


## DeactivatePhoneNumber  (api_method)

Deactivates the phone number.

_roles: Owner_

**Returns:** 

- `phone_id` — The phone ID list separated by semicolons (;). Use the 'all' value to select all phone ids. <b>Required</b> unless <b>phone_number</b> is provided.

- `phone_number` — The phone number list separated by semicolons (;). <b>Required</b> unless <b>phone_id</b> is provided.


## DownloadPhoneNumberReport  (api_method)

Downloads the required phone number report.<br><br>Please note, that the report can return in a compressed state (.gzip). In order for CURL to process a compressed file correctly, add the "--compressed" key.

_roles: Owner, Admin, Support, Supervisor, Developer, Accountant, Payer, PhoneNumberManager_

**Returns:** 

- `report_id` — The phone number report ID


## GetAccountPhoneNumberCountries  (api_method)

Gets all countries where the specific account has phone numbers.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer, Verification_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;) to filter


## GetActualPhoneNumberRegion  (api_method)

Get actual info on the country region of the phone numbers. The response also contains the info about multiple numbers subscription for the child accounts.

**Returns:** 

- `country_code` — The country code

- `country_state` — The country state code (example: AL, CA, ... )

- `locale` — The 2-letter locale code. Supported values are EN, RU

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method

- `phone_region_id` — The phone region ID to filter


## GetNewPhoneNumbers  (api_method)

Gets the new phone numbers.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `count` — The maximum returning record count

- `country_code` — The country code. <b>Required</b> together with <b>phone_category_name</b> and <b>phone_region_id</b> to search the catalog; omit all three to get the phone numbers available locally

- `country_state` — The country state. See the GetPhoneNumberCategories and GetPhoneNumberCountryStates functions

- `offset` — The first <b>N</b> records are skipped in the output

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) function. <b>Required</b> together with <b>country_code</b> and <b>phone_region_id</b> to search the catalog; omit all three to get the phone numbers available locally

- `phone_number_mask` — The phone number searching mask. Asterisk represents zero or more occurrences of any character

- `phone_region_id` — The phone region ID. See the [GetPhoneNumberRegions](/docs/references/httpapi/phonenumbers#getphonenumberregions) method. <b>Required</b> together with <b>country_code</b> and <b>phone_category_name</b> to search the catalog; omit all three to get the phone numbers available locally


## GetPhoneNumberCategories  (api_method)

Gets the phone number categories.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `country_code` — Country code list separated by semicolons (;)

- `locale` — The 2-letter locale code. Supported values are EN, RU

- `sandbox` — Flag allows you to display phone number categories only of the sandbox, real or all .The following values are possible: 'all', 'true', 'false'


## GetPhoneNumberCountryStates  (api_method)

Gets the phone number country states.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `country_code` — The country code

- `country_state` — The country state code (example: AL, CA, ... )

- `phone_category_name` — The phone category name. See the GetPhoneNumberCategories function


## GetPhoneNumberRegions  (api_method)

Get the country regions of the phone numbers. The response also contains the info about multiple numbers subscription for the child accounts.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `country_code` — The country code

- `country_state` — The country state code (example: AL, CA, ... )

- `locale` — The 2-letter locale code. Supported values are EN, RU

- `omit_empty` — Whether not to show all the regions (with and without phone numbers in stock)

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method

- `phone_region_code` — The region phone prefix to filter

- `phone_region_id` — The phone region ID to filter

- `phone_region_name` — The phone region name to filter


## GetPhoneNumberReports  (api_method)

Receives information about the created phone numbers report or list of reports.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer, PhoneNumberManager_

**Returns:** 

- `count` — The maximum returning record count

- `created_from` — The UTC creation from date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `created_to` — The UTC creation to date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `desc_order` — Whether to get records in the descent order

- `is_completed` — Whether the report is completed

- `offset` — The first <b>N</b> records are skipped in the output

- `report_id` — The phone number report ID to filter

- `report_type` — The phone number report type list separated by semicolons (;). The possible values are: phone_numbers, phone_numbers_awaiting_configuration


## GetPhoneNumbers  (api_method)

Gets the account phone numbers.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer_

**Returns:** 

- `activation_status` — Phone number activation statuses to filter, separated by semicolons (;).<br><br>The possible values are: ACTIVE, ACTIVATING, DEACTIVATED, PROVISIONING, AWAITING_BUSINESS_PHONE_NUMBER_CONFIGURATION, LEGAL_OWNERSHIP_LIMIT_REACHED, GOSUSLUGI_DECLINED, SELF_BAN_ENABLED

- `application_id` — Application ID. Can be used instead of the <b>application_name</b> parameter

- `application_name` — Application name. Can be used instead of the <b>application_id</b> parameter

- `auto_charge` — Whether the auto_charge flag is enabled

- `can_be_used` — Whether a not verified account can use the phone

- `canceled` — Whether the subscription is cancelled to filter

- `child_account_id` — Child account ID list separated by semicolons (;). Use the 'all' value to select all child accounts

- `children_phones_only` — Whether to get the children phones only

- `count` — Maximum returning record count

- `country_code` — Country code list separated by semicolons (;)

- `deactivated` — Whether the subscription is frozen to filter

- `from_phone_next_renewal` — UTC 'from' date filter in the following format: YYYY-MM-DD

- `from_phone_purchase_date` — UTC 'from' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `from_unverified_hold_until` — Unverified phone hold until the date (from ...) in the following format: YYYY-MM-DD

- `is_bound_to_application` — Whether the phone number bound to an application

- `is_bound_to_rule` — Whether the phone number is bound to some rule

- `offset` — First <b>N</b> records are skipped in the output

- `order_by` — Following values are available: 'phone_number' (ascent order), 'phone_price' (ascent order), 'phone_country_code' (ascent order), 'deactivated' (deactivated first, active last), 'purchase_date' (descent order), 'phone_next_renewal' (ascent order), 'verification_status', 'unverified_hold_until' (ascent order), 'verification_name'

- `phone_category_name` — Phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method

- `phone_id` — Particular phone ID to filter

- `phone_number` — Phone number list separated by semicolons (;) that can be used instead of <b>phone_id</b>

- `phone_region_name` — Region names list separated by semicolons (;)

- `phone_template` — Phone number start to filter

- `rule_id` — Rule ID list separated by semicolons (;)

- `rule_name` — Rule names list separated by semicolons (;). Can be used only if __application_id__ or __application_name__ is specified

- `sandbox` — Flag allows you to display only the numbers of the sandbox, real numbers, or all numbers. The following values are possible: 'all', 'true', 'false'

- `to_phone_next_renewal` — UTC 'to' date filter in the following format: YYYY-MM-DD

- `to_phone_purchase_date` — UTC 'to' date filter in 24-h format: YYYY-MM-DD HH:mm:ss

- `to_unverified_hold_until` — Unverified phone hold until the date (... to) in the following format: YYYY-MM-DD

- `verification_name` — Required account verification name to filter

- `verification_status` — Account verification status list separated by semicolons (;). The following values are possible: REQUIRED, IN_PROGRESS, VERIFIED


## GetPhoneNumbersAsync  (api_method)

Gets the asynchronous report regarding purchased phone numbers.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer, PhoneNumberManager_

**Returns:** 

- `with_header` — Whether to get a CSV file with the column names


## IsAccountPhoneNumber  (api_method)

Checks if the phone number belongs to the authorized account.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support, Payer_

**Returns:** 

- `phone_number` — Phone number to check in the international format without `+`


## SetPhoneNumberInfo  (api_method)

Set the phone number information.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `incoming_sms_callback_url` — If set, the callback of an incoming SMS is sent to this url, otherwise, it is sent to the general account URL

- `phone_id` — The phone ID list separated by semicolons (;). Use the 'all' value to select all phone ids. <b>Required</b> unless <b>phone_number</b> is provided.

- `phone_number` — The phone number list separated by semicolons (;). <b>Required</b> unless <b>phone_id</b> is provided.
