# SIPRegistration  (ref_folder)


## BindSipRegistration  (api_method)

Bind the SIP registration to the application/user or unbind the SIP registration from the application/user. You should specify the application_id or application_name if you specify the rule_name or user_id, or user_name. You should specify the sip_registration_id if you set bind=true. You can bind only one SIP registration to the user (the previous SIP registration is automatically unbound).

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID which the SIP registration is to be bound to. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name which the SIP registration is to be bound to. Can be used instead of the <b>application_id</b> parameter

- `bind` — Whether to bind or unbind (set true or false respectively)

- `rule_id` — The rule ID which the SIP registration is to be bound to. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name which the SIP registration is to be bound to. Can be used instead of the <b>rule_id</b> parameter

- `sip_registration_id` — The registration ID

- `user_id` — The user ID which the SIP registration is to be bound to. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name which the SIP registration is to be bound to. Can be used instead of the <b>user_id</b> parameter


## CreateSipRegistration  (api_method)

Creates a new SIP registration (the platform registers as a user on a 3rd party SIP server).<br><br>There are two modes of SIP registration:<br><ol><li>Persistent registration, when the platform registers on a 3rd party SIP server as a user and the registration lasts until deleted (or there are network/technical issues with it — see the corresponding callback)</li><li>Non-persistent registration (set `is_persistent` to false) which is initiated only when the specificed user (with `user_id` or `user_name`) logs in via one of Voximplant SDKs. As soon the user logs off, the registration goes offline. This mode helps to implement SIP softphone-like apps using Voximplant’s SDKs.</li></ol><br>Please note that when you create a SIP registration, we reserve the subscription fee and taxes for the upcoming month. Read more in the <a href='/docs/gettingstarted/billing'>Billing</a> page.

_roles: Owner, Admin, Accountant_

**Returns:** 

- `application_id` — The application ID which a new SIP registration is to be bound to. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name which a new SIP registration is to be bound to. Can be used instead of the <b>application_id</b> parameter

- `auth_user` — The SIP authentications user

- `is_persistent` — Whether SIP registration is persistent. Set false to activate it only on the user login

- `outbound_proxy` — The outgoing SIP proxy

- `password` — The SIP password

- `proxy` — The SIP proxy

- `rule_id` — The rule ID which a new SIP registration is to be bound to. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name which a new SIP registration is to be bound to. Can be used instead of the <b>rule_id</b> parameter

- `sip_username` — The user name

- `user_id` — The user ID which a new SIP registration is to be bound to. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name which a new SIP registration is to be bound to. Can be used instead of the <b>user_id</b> parameter


## DeleteSipRegistration  (api_method)

Delete SIP registration.

_roles: Owner, Admin_

**Returns:** 

- `sip_registration_id` — The registration ID


## GetSipRegistrations  (api_method)

Get active SIP registrations.

_roles: Owner, Admin, Developer, Supervisor, Accountant, Support_

**Returns:** 

- `application_id` — The application ID list separated by semicolons (;) to filter. Can be used instead of <b>application_name</b>

- `application_name` — The application name list separated by semicolons (;) to filter. Can be used instead of <b>application_id</b>

- `count` — The maximum returning record count

- `deactivated` — Whether to show the frozen SIP registrations only

- `in_progress` — Whether SIP registration is still in progress

- `is_bound_to_application` — Whether SIP registration bound to an application

- `is_persistent` — Whether the SIP registration is persistent to filter

- `offset` — The first <b>N</b> records are skipped in the output

- `proxy` — The list of proxy servers to use, divided by semicolon (;)

- `rule_id` — The rule ID list separated by semicolons (;) to filter. <b>Required</b> unless <b>rule_name</b> is provided.

- `rule_name` — The rule name list separated by semicolons (;) to filter. <b>Required</b> unless <b>rule_id</b> is provided.

- `sip_registration_id` — The SIP registration ID

- `sip_username` — The SIP user name to filter

- `status_code` — The list of SIP response codes. The __code1:code2__ means a range from __code1__ to __code2__ including; the __code1;code2__ meanse either __code1__ or __code2__. You can combine ranges, e.g., __code1;code2:code3__

- `successful` — Whether to show the successful SIP registrations only

- `user_id` — The user ID list separated by semicolons (;) to filter. <b>Required</b> unless <b>user_name</b> is provided.


## UpdateSipRegistration  (api_method)

Update SIP registration. You should specify the application_id or application_name if you specify the rule_name or user_id, or user_name. You can bind only one SIP registration to the user (the previous SIP registration is automatically unbound).

_roles: Owner, Admin, Developer_

**Returns:** 

- `application_id` — The application ID which the SIP registration is to be bound to. Can be used instead of the <b>application_name</b> parameter

- `application_name` — The application name which the SIP registration is to be bound to. Can be used instead of the <b>application_id</b> parameter

- `auth_user` — The SIP authentications user

- `outbound_proxy` — The outgoing SIP proxy

- `password` — The SIP password

- `proxy` — The SIP proxy

- `rule_id` — The rule ID which the SIP registration is to be bound to. Can be used instead of the <b>rule_name</b> parameter

- `rule_name` — The rule name which the SIP registration is to be bound to. Can be used instead of the <b>rule_id</b> parameter

- `sip_registration_id` — The registration ID

- `sip_username` — The user name

- `user_id` — The user ID which the SIP registration is to be bound to. Can be used instead of the <b>user_name</b> parameter

- `user_name` — The user name which the SIP registration is to be bound to. Can be used instead of the <b>user_id</b> parameter
