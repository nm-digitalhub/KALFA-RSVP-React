# PushCredentials  (ref_folder)


## AddPushCredential  (api_method)

Adds push credentials.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application id

- `application_name` — The application name that can be used instead of <b>application_id</b>

- `cert_content` — Public and private keys in PKCS12 format. Credentials for APPLE push

- `cert_file_name` — The parameter is required, when set 'cert_content' as POST body. Credentials for APPLE push

- `cert_password` — The secret password for private key. Credentials for APPLE push

- `credential_bundle` — The bundle of Android/iOS/Huawei application

- `huawei_application_id` — The application id, provided by Huawei. Credentials for HUAWEI push

- `huawei_client_id` — The client id, provided by Huawei. Credentials for HUAWEI push

- `huawei_client_secret` — The client secret, provided by Huawei. Credentials for HUAWEI push

- `is_dev_mode` — Whether to use this certificate in apple's sandbox environment. Credentials for APPLE push

- `push_provider_id` — The push provider id. The possible values are: 1 — APPLE, 2 — GOOGLE, 3 — APPLE_VOIP, 5 — HUAWEI. <b>Required</b> unless <b>push_provider_name</b> is provided.

- `push_provider_name` — The push provider name. The possible values are APPLE, APPLE_VOIP, GOOGLE, HUAWEI. <b>Required</b> unless <b>push_provider_id</b> is provided.

- `sender_id` — The sender id, provided by Google. Credentials for GOOGLE push

- `server_key` — The server key, provided by Google. Credentials for GOOGLE push

- `service_account_file` — The service account key file, provided by Google. Can be used instead of <b>server_key</b>. Credentials for GOOGLE push


## BindPushCredential  (api_method)

Binds push credentials to applications.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;). Use the 'all' value to select all applications

- `bind` — Whether to bind or unbind (set true or false respectively)

- `push_credential_id` — The push credentials ID list separated by semicolons (;)


## DelPushCredential  (api_method)

Removes push credentials.

_roles: Owner, Admin, Developer_

**Returns:** 

- `push_credential_id` — The push credentials id


## GetPushCredential  (api_method)

Gets push credentials.

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — ID of the bound application

- `application_name` — Name of the bound application

- `push_credential_id` — The push credentials id

- `push_provider_id` — The push provider id. Can be used instead of <b>push_provider_name</b>. The possible values are: 1 — APPLE, 2 — GOOGLE, 3 — APPLE_VOIP, 5 — HUAWEI.

- `push_provider_name` — The push provider name. The possible values are APPLE, APPLE_VOIP, GOOGLE, HUAWEI

- `with_cert` — Whether to get the user's certificate


## SetPushCredential  (api_method)

Modifies push credentials.

_roles: Owner, Admin, Developer_

**Returns:** 

- `cert_content` — Public and private keys in PKCS12 format. Credentials for APPLE push

- `cert_password` — The secret password for private key. Credentials for APPLE push

- `huawei_application_id` — The application id, provided by Huawei. Credentials for HUAWEI push

- `huawei_client_id` — The client id, provided by Huawei. Credentials for HUAWEI push

- `huawei_client_secret` — The client secret, provided by Huawei. Credentials for HUAWEI push

- `is_dev_mode` — Whether to use this certificate in apple's sandbox environment. Credentials for APPLE push

- `push_credential_id` — The push credentials id

- `sender_id` — The sender id, provided by Google. Credentials for GOOGLE push

- `server_key` — The server key, provided by Google. Credentials for GOOGLE push

- `service_account_file` — The service account key file, provided by Google. Can be used instead of <b>server_key</b>. Credentials for GOOGLE push
