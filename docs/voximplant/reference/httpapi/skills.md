# Skills  (ref_folder)


## AddSkill  (api_method)

Adds a new operator's skill. Works only for ACDv1. For SmartQueue/ACDv2, use <a href="#how-auth-works">this reference</a>.

_roles: Owner, Admin, Developer, User manager_

**Returns:** 

- `skill_name` — The ACD operator skill name. The length should be less than 512


## BindSkill  (api_method)

Binds the specified skills to the users (ACD operators) and/or the ACD queues. Works only for ACDv1. For SmartQueue/ACDv2, use <a href="#how-auth-works">this reference</a>.

_roles: Owner, Admin, Developer, User manager_

**Returns:** 

- `acd_queue_id` — The ACD queue ID list separated by semicolons (;). Use the 'all' value to select all ACD queues. <b>Required</b> unless <b>acd_queue_name</b> is provided.

- `acd_queue_name` — The ACD queue name. The ACD queue name list separated by semicolons (;). <b>Required</b> unless <b>acd_queue_id</b> is provided.

- `application_id` — The application ID. It is required if the <b>user_name</b> is specified

- `application_name` — The application name that can be used instead of <b>application_id</b>

- `bind` — Whether to bind or unbind (set true or false respectively)

- `skill_id` — The skill ID list separated by semicolons (;). Use the 'all' value to select all skills. <b>Required</b> unless <b>skill_name</b> is provided.

- `skill_name` — The skill name list separated by semicolons (;). <b>Required</b> unless <b>skill_id</b> is provided.

- `user_id` — The user ID list separated by semicolons (;). Use the 'all' value to select all users. <b>Required</b> unless <b>user_name</b> is provided.

- `user_name` — The user name list separated by semicolons (;). <b>Required</b> unless <b>user_id</b> is provided.


## DelSkill  (api_method)

Deletes an operator's skill. Works only for ACDv1. For SmartQueue/ACDv2, use <a href="#how-auth-works">this reference</a>.

_roles: Owner, Admin, Developer, User manager_

**Returns:** 

- `skill_id` — The skill ID. <b>Required</b> unless <b>skill_name</b> is provided.

- `skill_name` — The skill name. <b>Required</b> unless <b>skill_id</b> is provided.


## GetSkills  (api_method)

Gets the skills of an operator. Works only for ACDv1. For SmartQueue/ACDv2, use <a href="#how-auth-works">this reference</a>.

_roles: Owner, Admin, Developer, Supervisor, User manager_

**Returns:** 

- `count` — The maximum returning record count

- `offset` — The first <b>N</b> records are skipped in the output

- `skill_id` — The skill ID to filter

- `skill_name` — The skill name part to filter


## SetSkillInfo  (api_method)

Edits an operator's skill. Works only for ACDv1. For SmartQueue/ACDv2, use <a href="#how-auth-works">this reference</a>.

_roles: Owner, Admin, Developer, User manager_

**Returns:** 

- `new_skill_name` — The new skill name. The length should be less than 512

- `skill_id` — The skill ID. <b>Required</b> unless <b>skill_name</b> is provided.

- `skill_name` — The skill name. <b>Required</b> unless <b>skill_id</b> is provided.
