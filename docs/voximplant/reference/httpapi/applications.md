# Applications  (ref_folder)


## AddApplication  (api_method)

Adds a new account's application.

_roles: Owner, Admin_

**Returns:** 

- `application_name` — Short application name in the \[a-z\]\[a-z0-9-\]{1,64} format

- `secure_record_storage` — Whether to enable secure storage for all logs and records of the application


## DelApplication  (api_method)

Deletes the account's application.

_roles: Owner_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;). Use the 'all' value to select all applications. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name list separated by semicolons (;). <b>Required</b> unless <b>application_id</b> is provided.


## GetApplications  (api_method)

Gets the account's applications.

_roles: Owner, Admin, Developer, Supervisor, Call list manager, User manager, Accountant, Support_

**Returns:** 

- `application_id` — The application ID to filter

- `application_name` — The application name part to filter

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `with_rules` — Whether to get bound rules info

- `with_scenarios` — Whether to get bound rules and scenarios info


## SetApplicationInfo  (api_method)

Edits the account's application.

_roles: Owner, Admin_

**Returns:** 

- `application_id` — The application ID. <b>Required</b> unless <b>required_application_name</b> is provided.

- `application_name` — The new short application name in format [a-z][a-z0-9-]{1,79}

- `required_application_name` — The application name. <b>Required</b> unless <b>application_id</b> is provided.

- `secure_record_storage` — Whether to enable secure storage for all logs and records of the application
