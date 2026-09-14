# Secrets  (ref_folder)


## AddSecret  (api_method)

Adds a new secret.

**Returns:** 

- `application_id` — Application ID to add the secret to. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `description` — Optional. Secret description. When processing, the length is truncated to the first 200 characters

- `secret_name` — Secret name. The name should start with a Latin letter and can contain up to 64 characters, including Latin letters, digits and underscores

- `secret_value` — Secret value. Maximum length is 8192 characters


## DelSecret  (api_method)

Deletes an existing secret.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `secret_id` — IDs to delete. A list separated by semicolons (;). Use the 'all' value to delete all secrets

- `secret_name` — Secret names to delete. List separated by semicolons (;)


## GetSecrets  (api_method)

Gets the list of an application's secrets.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `count` — Maximum returning number of records

- `offset` — First <b>N</b> records to be skipped in the output

- `secret_name_part` — Filter by the secret name part


## GetSecretValue  (api_method)

Gets the value of a specific secret.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `secret_id` — Secret ID. <b>Required</b> unless <b>secret_name</b> is provided.

- `secret_name` — Secret name. <b>Required</b> unless <b>secret_id</b> is provided.


## SetSecretInfo  (api_method)

Edits a secret's parameters.

**Returns:** 

- `application_id` — Application ID. <b>Required</b> unless <b>application_name</b> is provided.

- `application_name` — Application name. <b>Required</b> unless <b>application_id</b> is provided.

- `description` — Secret description. When processing, the length is truncated to the first 200 characters

- `new_secret_name` — New secret name. The name should start with a Latin letter and can contain up to 64 characters, including Latin letters, digits and underscores

- `secret_id` — Secret ID to edit. <b>Required</b> unless <b>secret_name</b> is provided.

- `secret_name` — Secret name. <b>Required</b> unless <b>secret_id</b> is provided.

- `secret_value` — Secret value. Maximum length is 8192 characters
