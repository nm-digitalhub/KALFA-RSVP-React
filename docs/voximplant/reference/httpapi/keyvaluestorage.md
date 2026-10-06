# KeyValueStorage  (ref_folder)


## DelKeyValueItem  (api_method)

Deletes the specified key-value pair from the storage.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID

- `application_name` — The application name

- `key` — Key, up to 200 characters


## GetKeyValueItem  (api_method)

Gets the specified key-value pair from the storage.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID

- `application_name` — The application name

- `key` — Key, up to 200 characters


## GetKeyValueItems  (api_method)

Gets all the key-value pairs in which the keys begin with a pattern.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID

- `application_name` — The application name

- `count` — Number of items to show per page with a maximum value of 50. Default value is 10

- `key` — Namespace that keys should contain, up to 200 characters

- `offset` — Number of items to skip (e.g. if you set count = 20 and offset = 0 the first time, the next time, offset has to be equal to 20 to skip the items shown earlier). Default value is 0


## GetKeyValueKeys  (api_method)

Gets all the keys of key-value pairs.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID

- `application_name` — The application name

- `count` — Number of items to show per page with a maximum value of 50. Default value is 10

- `key` — Namespace that keys should contain, up to 200 characters

- `offset` — Number of items to skip (e.g. if you set count = 20 and offset = 0 the first time, the next time, offset has to be equal to 20 to skip the items shown earlier). Default value is 0


## SetKeyValueItem  (api_method)

Creates or updates a key-value pair. If an existing key is passed, the method returns the existing item and changes the value if needed. The keys should be unique within a Voximplant application.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — Application ID

- `application_name` — Application name

- `expires_at` — Expiration date based on **ttl** (timestamp without milliseconds). Note that one of the two parameters (ttl or expires_at) should be set

- `key` — Key, up to 200 characters. A key can contain a namespace that is written before the ':' symbol, for example, test:1234. Thus, namespace 'test' can be used as a pattern in the [GetKeyValueItems](/docs/references/httpapi/keyvaluestorage#getkeyvalueitems) and [GetKeyValueKeys](/docs/references/httpapi/keyvaluestorage#getkeyvaluekeys) methods to find the keys with the same namespace.<br><br>The key should match the following regular expression: `^[a-zA-Z0-9а-яА-ЯёЁ_\-:;.#+]*$`

- `ttl` — Key expiry time in seconds. The value is in range of 0..7,776,000 (90 days), the default value is 30 days (2,592,000 seconds). The TTL is converted to an **expires_at** Unix timestamp field as part of the storage object. Note that one of the two parameters (ttl or expires_at) should be set

- `value` — Value for the specified key, up to 2000 characters
