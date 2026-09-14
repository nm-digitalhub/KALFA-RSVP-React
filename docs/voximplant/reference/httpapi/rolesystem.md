# RoleSystem  (ref_folder)


## AddSubUser  (api_method)

Creates a subuser.

_roles: Owner_

**Returns:** 

- `description` — Description of a new subuser

- `new_subuser_name` — The new subuser login for management api authentication, should be unique within the Voximplant account. The login specified is always converted to lowercase

- `new_subuser_password` — The new subuser password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `role_id` — The role id list separated by semicolons (;)

- `role_name` — The role name list separated by semicolons (;)


## CreateKey  (api_method)

Creates a public/private key pair. You can optionally specify one or more roles for the key. You can find all available service account roles [here](/docs/getting-started/basic-concepts/management-api#service-account-roles).

**Returns:** 

- `description` — The key's description

- `key_name` — The key's name, up to 50 characters. Cannot be empty

- `role_id` — The role ID list separated by semicolons (;). Use it instead of **role_name**, but not combine with

- `role_name` — The role name list separated by semicolons (;). Use it instead of **role_id**, but not combine with


## DeleteKey  (api_method)

Deletes the specified key.

**Returns:** 

- `key_id` — The key's ID


## DelSubUser  (api_method)

Deletes a subuser.

_roles: Owner_

**Returns:** 

- `subuser_id` — The subuser's ID


## GetKeyRoles  (api_method)

Gets roles of the specified key.

**Returns:** 

- `key_id` — The key's ID

- `with_expanded_roles` — Whether to show the roles' additional properties


## GetKeys  (api_method)

Gets key info of the specified account.

**Returns:** 

- `count` — The maximum returning record count

- `key_id` — The key's ID

- `offset` — The first <b>N</b> records are skipped in the output

- `with_roles` — Whether to show roles for the key


## GetRoleGroups  (api_method)

Gets role groups.

**Returns:** 


## GetRoles  (api_method)

Gets all roles.

**Returns:** 

- `group_name` — The role group


## GetSubUserRoles  (api_method)

Gets the subuser's roles.

_roles: Owner_

**Returns:** 

- `subuser_id` — The subuser's ID

- `with_expanded_roles` — Whether to show the roles' additional properties


## GetSubUsers  (api_method)

Gets subusers.

_roles: Owner_

**Returns:** 

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `subuser_id` — The subuser's ID

- `with_roles` — Whether to show subuser's roles


## RemoveKeyRoles  (api_method)

Removes the specified roles of a key.

**Returns:** 

- `key_id` — The key's ID

- `role_id` — The role id list separated by semicolons (;)

- `role_name` — The role name list separated by semicolons (;)


## RemoveSubUserRoles  (api_method)

Removes the specified roles of a subuser.

_roles: Owner_

**Returns:** 

- `force` — Whether to remove roles from all subuser keys

- `role_id` — The role id list separated by semicolons (;)

- `role_name` — The role name list separated by semicolons (;)

- `subuser_id` — The subuser's ID


## SetKeyRoles  (api_method)

Set roles for the specified key.

**Returns:** 

- `key_id` — The key's ID

- `role_id` — The role id list separated by semicolons (;)

- `role_name` — The role name list separated by semicolons (;)


## SetSubUserInfo  (api_method)

Edits a subuser.

**Returns:** 

- `description` — The new subuser description

- `new_subuser_password` — The new user password. Should be at least 8 characters long and contain at least one uppercase and lowercase letter, one number, and one special character

- `old_subuser_password` — The subuser old password. It is required if __new_subuser_password__ is specified

- `subuser_id` — The subuser's ID


## SetSubUserRoles  (api_method)

Adds the specified roles for a subuser.

_roles: Owner_

**Returns:** 

- `role_id` — The role id list separated by semicolons (;)

- `role_name` — The role name list separated by semicolons (;)

- `subuser_id` — The subuser's ID


## UpdateKey  (api_method)

Updates info of the specified key.

**Returns:** 

- `description` — The key's description

- `key_id` — The key's ID

- `key_name` — The key's name, up to 50 characters. Cannot be empty
