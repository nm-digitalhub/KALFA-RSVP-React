# SIPWhiteList  (ref_folder)


## AddSipWhiteListItem  (api_method)

Adds a new network address to the SIP white list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `description` — The network address description

- `sip_whitelist_network` — The network address in format A.B.C.D/L or A.B.C.D/a.b.c.d (example 192.168.1.5/16)


## DelSipWhiteListItem  (api_method)

Deletes the network address from the SIP white list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `sip_whitelist_id` — The SIP white list item ID to delete


## GetSipWhiteList  (api_method)

Gets the SIP white list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `sip_whitelist_id` — The SIP white list item ID to filter


## SetSipWhiteListItem  (api_method)

Edits the SIP white list.

_roles: Owner, Admin, Developer_

**Returns:** 

- `description` — The network address description

- `sip_whitelist_id` — The SIP white list item ID

- `sip_whitelist_network` — The new network address in format A.B.C.D/L or A.B.C.D/a.b.c.d (example 192.168.1.5/16)
