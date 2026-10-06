# Users  (ref_folder)


## AddUser  (api_method)

Adds a new user.

_roles: Owner, Admin, User manager_

**Returns:** 

- `application_id` — The application ID which a new user is to be bound to. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — The application name which a new user is to be bound to. <b>Required</b> unless <b>application_id</b> is provided.

- `parent_accounting` — Whether the user uses the parent account's money, 'false' if the user has a separate balance

- `user_active` — Whether the user is active. Inactive users cannot log in to applications

- `user_custom_data` — Any string

- `user_display_name` — The user display name. The length should be less than 256

- `user_name` — The user name in format [a-z0-9][a-z0-9_-]{2,49}

- `user_password` — The user password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character


## DelUser  (api_method)

Deletes the specified user(s).

_roles: Owner, Admin, User manager_

**Returns:** 

- `application_id` — Delete the specified users bound to the application ID. It is required if the <b>user_name</b> is specified

- `application_name` — Delete the specified users bound to the application name. Can be used instead of the <b>application_id</b> parameter

- `user_id` — The user ID list separated by semicolons (;). Use the 'all' value to select all users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — The user name list separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## GetUsers  (api_method)

Shows the users of the specified account.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `acd_queue_id` — The ACD queue ID to filter

- `acd_status` — The ACD status list separated by semicolons (;) to filter. The following values are possible: OFFLINE, ONLINE, READY, BANNED, IN_SERVICE, AFTER_SERVICE, TIMEOUT, DND

- `application_id` — The application ID to filter

- `application_name` — The application name part to filter

- `count` — The maximum returning record count

- `excluded_acd_queue_id` — The excluded ACD queue ID to filter

- `excluded_skill_id` — The excluded skill ID to filter

- `offset` — The first <b>N</b> records are skipped in the output

- `order_by` — The following values are available: 'user_id', 'user_name' and 'user_display_name'

- `return_live_balance` — Whether to get the user live balance

- `showing_skill_id` — The skill to show in the 'skills' field output

- `skill_id` — The skill ID to filter

- `user_active` — Whether the user is active to filter. Inactive users cannot log in to applications

- `user_display_name` — The user display name part to filter

- `user_id` — The user ID to filter

- `user_name` — The user name part to filter

- `with_queues` — Whether to get the bound queues

- `with_skills` — Whether to get the bound skills


## SetUserInfo  (api_method)

Edits the user.

_roles: Owner, Admin, User manager_

**Returns:** 

- `application_id` — The application ID. It is required if the <b>user_name</b> is specified

- `application_name` — The application name that can be used instead of <b>application_id</b>

- `new_user_name` — The new user name in format [a-z0-9][a-z0-9_-]{2,49}

- `parent_accounting` — Whether to use the parent account's money, 'false' to use a separate user balance

- `user_active` — Whether the user is active. Inactive users cannot log in to applications

- `user_custom_data` — Any string

- `user_display_name` — The new user display name. The length should be less than 256

- `user_id` — The user to edit. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — The user name. <b>Required</b> unless <b>user_id</b> is provided.

- `user_password` — The new user password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character
