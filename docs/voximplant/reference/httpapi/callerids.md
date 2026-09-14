# CallerIDs  (ref_folder)


## DelCallerID  (api_method)

Deletes the CallerID. Note: you cannot delete a CID permanently (the antispam defence).

_roles: Owner, Admin_

**Returns:** 

- `callerid_id` — ID of the callerID object. <b>Required</b> unless <b>callerid_number</b> is provided.

- `callerid_number` — The callerID number. <b>Required</b> unless <b>callerid_id</b> is provided.


## GetCallerIDs  (api_method)

Gets the account callerIDs.

_roles: Owner, Admin_

**Returns:** 

- `active` — Whether the account is active to filter

- `callerid_id` — ID of the callerID object to filter

- `callerid_number` — The phone number to filter

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `order_by` — The following values are available: 'caller_number' (ascent order), 'verified_until' (ascent order)
