# AuthorizedIPs  (ref_folder)


## AddAuthorizedAccountIP  (api_method)

Adds a new authorized IP4 or network to the white/black list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `allowed` — Whether to remove the IP from the blacklist

- `authorized_ip` — The authorized IP4 or network

- `description` — The IP address description


## CheckAuthorizedAccountIP  (api_method)

Tests whether the IP4 is banned or allowed.

_roles: Owner, Admin, Developer_

**Returns:** 

- `authorized_ip` — The IP4 to test


## DelAuthorizedAccountIP  (api_method)

Removes the authorized IP4 or network from the white/black list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `allowed` — Whether to remove the network from the white list. Set false to remove the network from the black list. Omit the parameter to remove the network from all lists

- `authorized_ip` — The authorized IP4 or network to remove. Set to 'all' to remove all items. <b>Required</b> unless <b>contains_ip</b> is provided.

- `contains_ip` — Specify the parameter to remove the networks that contains the particular IP4. <b>Required</b> unless <b>authorized_ip</b> is provided.


## GetAuthorizedAccountIPs  (api_method)

Gets the authorized IP4 or network.

_roles: Owner, Admin, Developer_

**Returns:** 

- `allowed` — Whether the IP is allowed

- `authorized_ip` — The authorized IP4 or network to filter

- `contains_ip` — Specify the parameter to filter the networks that contains the particular IP4

- `count` — The maximum returning record count

- `description` — The IP address description

- `offset` — The first <b>N</b> records are skipped in the output
