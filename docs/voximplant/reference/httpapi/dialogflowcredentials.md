# DialogflowCredentials  (ref_folder)


## AddDialogflowKey  (api_method)

Adds a Dialogflow key.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID

- `application_name` — The application name. Can be used instead of <b>application_id</b>

- `description` — The Dialogflow key's description

- `json_credentials` — Dialogflow credentials, provided by JWK (Json web key)


## BindDialogflowKeys  (api_method)

Binds a Dialogflow key to the specified applications.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;). Use the 'all' value to select all applications

- `bind` — Whether to bind or unbind (set true or false respectively)

- `dialogflow_key_id` — The Dialogflow key's ID 


## DelDialogflowKey  (api_method)

Removes a Dialogflow key.

_roles: Owner, Admin, Developer_

**Returns:** 

- `dialogflow_key_id` — The Dialogflow key's ID


## GetDialogflowKeys  (api_method)

Gets Dialogflow keys.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — ID of the bound application

- `application_name` — Name of the bound application

- `dialogflow_key_id` — Dialogflow key's ID


## SetDialogflowKey  (api_method)

Edits a Dialogflow key.

**Returns:** 

- `description` — The Dialogflow key's description. To clear previously set description leave the parameter blank or put whitespaces only

- `dialogflow_key_id` — The Dialogflow key's ID
