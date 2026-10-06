# PSTNBlacklist  (ref_folder)


## AddPstnBlackListItem  (api_method)

Add a new phone number to the PSTN blacklist. Use blacklist to block incoming calls from specified phone numbers to numbers purchased from Voximplant. Since we have no control over exact phone number format for calls from SIP integrations, blacklisting such numbers should be done via JavaScript scenarios.

_roles: Owner, Admin_

**Returns:** 

- `pstn_blacklist_phone` — The phone number in format e164 or regex pattern


## DelPstnBlackListItem  (api_method)

Remove phone number from the PSTN blacklist.

_roles: Owner, Admin_

**Returns:** 

- `pstn_blacklist_id` — The PSTN black list item ID


## GetPstnBlackList  (api_method)

Get the whole PSTN blacklist.

_roles: Owner, Admin_

**Returns:** 

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `pstn_blacklist_id` — The PSTN black list item ID for filter

- `pstn_blacklist_phone` — The phone number in format e164 for filter


## SetPstnBlackListItem  (api_method)

Update the PSTN blacklist item. BlackList works for numbers that are purchased from Voximplant only. Since we have no control over exact phone number format for calls from SIP integrations, blacklisting such numbers should be done via JavaScript scenarios.

_roles: Owner, Admin_

**Returns:** 

- `pstn_blacklist_id` — The PSTN black list item ID

- `pstn_blacklist_phone` — The new phone number in format e164
