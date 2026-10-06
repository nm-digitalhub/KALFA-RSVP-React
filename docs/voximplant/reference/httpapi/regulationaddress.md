# RegulationAddress  (ref_folder)


## GetAvailableRegulations  (api_method)

Searches for the available regulation for a link.

_roles: Owner, Accountant_

**Returns:** 

- `country_code` — The country code according to the <b>ISO 3166-1 alpha-2</b>

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method

- `phone_region_code` — The phone region code. See the [GetRegions](/docs/references/httpapi/regulationaddress#getregions) method


## GetCountries  (api_method)

Gets all countries.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `country_code` — The country code according to the <b>ISO 3166-1 alpha-2</b>


## GetRegions  (api_method)

Gets available regions in a country.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `city_name` — The pattern of city's name

- `count` — The returned regions count

- `country_code` — The country code according to the <b>ISO 3166-1 alpha-2</b>

- `offset` — The first <b>N</b> records are skipped in the output

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method


## GetRegulationsAddress  (api_method)

Searches for the user's regulation address.

_roles: Owner, Admin, Accountant, Payer, PayerNoVerify_

**Returns:** 

- `country_code` — The country code according to the <b>ISO 3166-1 alpha-2</b>

- `in_progress` — Whether to show only in progress regulation address

- `phone_category_name` — The phone category name. See the [GetPhoneNumberCategories](/docs/references/httpapi/phonenumbers#getphonenumbercategories) method

- `phone_region_code` — The phone region code. See the [GetRegions](/docs/references/httpapi/regulationaddress#getregions) method

- `regulation_address_id` — The regulation address ID

- `verified` — Whether to show only verified regulation address


## GetZIPCodes  (api_method)

Searches for available zip codes.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `count` — The maximum returning record count

- `country_code` — The country code according to the <b>ISO 3166-1 alpha-2</b>

- `offset` — The first <b>N</b> records are skipped in the output

- `phone_region_code` — The phone region code


## LinkregulationAddress  (api_method)

Links the regulation address to a phone.

_roles: Owner, Admin, Accountant, Payer_

**Returns:** 

- `phone_id` — The phone ID for link

- `phone_number` — The phone number for link

- `regulation_address_id` — The regulation address ID
