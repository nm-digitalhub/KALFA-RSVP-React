# Spec Delta

## Purpose

The agent console lets staff who work as console agents place and take RSVP calls. Agents see the events
in console scope, their guests and RSVP state, campaign targets, call results, colleagues' availability,
their own calls and the team chat. This capability defines who reaches the console layer, which data each
caller sees, and which privileges client sessions hold. A "client session" is a request through the
Supabase Data API (PostgREST, Realtime) as `anon` or `authenticated`; `service_role` is the server.

"Console objects" means:
- the eight views `console_events`, `console_campaigns`, `console_campaign_targets`,
  `console_event_guests`, `console_rsvp_results`, `console_call_analysis`, `console_me` and
  `console_agents_roster`;
- the eleven `public.console_*` tables;
- the three tables gated by `is_console_agent()` that lack the prefix: `agent_status`,
  `call_dispatch_status` and `human_agent_call_legs`.

An "active agent" is a caller for whom `is_console_agent()` is true: platform staff with a
`console_agents` row where `vox_active` is set. An event is "in console scope" when it has AI calls or a
campaign.

## ADDED Requirements

### Requirement: Anonymous callers reach no console object
An anonymous client session SHALL be refused with a permission error on every console object, for every
operation.

#### Scenario: Anonymous read
- **WHEN** an anonymous caller reads any of the eight console views or any console table through the Data API
- **THEN** the request is refused with `42501`

### Requirement: Authenticated callers who are not agents see and change nothing
An authenticated client session whose user has no `console_agents` row SHALL receive no row from any
console view or console table, and SHALL change no console row.

#### Scenario: Regular user and staff member without an agent row
- **WHEN** such a caller reads any console view, or any console table it holds `SELECT` on
- **THEN** zero rows are returned; tables it holds no privilege on answer `42501`

#### Scenario: Write attempts
- **WHEN** such a caller inserts into, updates or deletes from any console table through the Data API
- **THEN** inserts are refused with `42501`, and updates and deletes affect zero rows

### Requirement: An inactive agent keeps only its own profile
An agent whose `console_agents.vox_active` is false SHALL see its own `console_me` row, so the
application can tell "not registered" from "not active". It SHALL see no other console data and SHALL
change no console row, whatever the statement form.

#### Scenario: Own profile
- **WHEN** an inactive agent reads `console_me`
- **THEN** exactly one row is returned, its own

#### Scenario: Other console data
- **WHEN** an inactive agent reads any other console view or console table
- **THEN** zero rows are returned

#### Scenario: Own shift row
- **WHEN** an inactive agent updates its own `console_agent_shift` row, with or without a filter
- **THEN** zero rows change

#### Scenario: Own monitor-leg device columns
- **WHEN** an active agent updates `device_id` and `vox_sdk_call_id` on its own `human_agent_call_legs`
  row, with or without a filter
- **THEN** its own row changes, and no other agent's row changes
- **WHEN** any agent updates another column of `human_agent_call_legs`
- **THEN** the statement is refused with `42501`
- **WHEN** an inactive agent updates `device_id` or `vox_sdk_call_id` on its own leg, in direct SQL
  or in the statement shape the Data API sends (`WHERE` + `RETURNING`), with or without a filter
- **THEN** zero rows change

### Requirement: Active agents see the work data of console-scope events only
For every event in console scope, an active agent SHALL see the work data needed to place and record
calls: the event, its campaigns, campaign targets, guests and their names, RSVP state and answers
including the note, call analysis results, reach state and dial eligibility. No console view SHALL return
rows of events outside console scope.

#### Scenario: Event in scope
- **WHEN** an active agent reads `console_event_guests`, `console_rsvp_results`, `console_campaign_targets` or `console_call_analysis` for an event in console scope
- **THEN** the rows and work columns are returned exactly as before this change

#### Scenario: Event out of scope
- **WHEN** an active agent reads the same views for an event without AI calls and without a campaign
- **THEN** zero rows are returned

### Requirement: Guest contact identifiers require view_customer_data
The phone number of a guest or contact SHALL be returned to an active agent only when the agent holds the
platform permission `view_customer_data`. Otherwise the column SHALL be `NULL` and the row SHALL still be
returned.

#### Scenario: Agent without the key
- **WHEN** an active agent without `view_customer_data` reads `console_event_guests` or `console_campaign_targets`
- **THEN** every in-scope row is returned with `phone` set to `NULL`

#### Scenario: Agent with the key
- **WHEN** an active agent with `view_customer_data` reads the same views
- **THEN** `phone` holds the stored normalized phone

### Requirement: Agent profile and colleague directory
`console_me` SHALL return only the caller's own agent row. The colleague directory
(`console_agents_roster` and `console_agents`) SHALL be visible to every active agent, because transfer,
consult and conference need each colleague's identity and status, and whether they can be dialled.

#### Scenario: Two agents
- **WHEN** agent A reads `console_me` while agent B also exists
- **THEN** exactly one row is returned, with A's `user_id`

#### Scenario: Directory
- **WHEN** an active agent reads `console_agents_roster`
- **THEN** every agent is listed with `display_name`, `status` and `provisioned`

### Requirement: Console secrets are reachable by no client
No client session SHALL read any row or column of `console_agent_secrets`, whether directly or through a
view or function it can execute. The roster's `provisioned` flag SHALL keep its meaning for every agent:
the agent has a telephony username and a stored secret.

#### Scenario: Direct read
- **WHEN** any client session selects any column of `console_agent_secrets`
- **THEN** the request is refused with `42501`

#### Scenario: Provisioned flag unchanged
- **WHEN** an active agent reads `console_agents_roster` after the change
- **THEN** `provisioned` equals its value before the change, for every agent

### Requirement: Server-only console tables stay closed
`console_call_pii` and `console_agent_commands` SHALL have row level security enabled, no policy, and no
privilege for `anon`, `authenticated` or `PUBLIC`.

#### Scenario: Closed shape
- **WHEN** the catalog entries of the two tables are read
- **THEN** RLS is enabled, no policy exists, and the ACL holds only `postgres` and `service_role`

#### Scenario: Any client operation
- **WHEN** any client session selects, inserts, updates or deletes on either table
- **THEN** the request is refused with `42501`

### Requirement: Client privileges equal the console access map
For every console object, `anon` and `PUBLIC` SHALL hold no privilege. `authenticated` SHALL hold exactly
the table and column privileges listed in the console access map of the design, and no `TRUNCATE`,
`TRIGGER`, `REFERENCES` or `MAINTAIN`. Helper functions used by the console SHALL run with an empty
`search_path`.

#### Scenario: Privilege inventory
- **WHEN** `has_table_privilege` and `has_column_privilege` are evaluated for every combination of role (`anon`, `authenticated`), console object and privilege (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, and the column privileges)
- **THEN** the result equals the access map, and each difference is reported as `<object>[.<column>] <role> <privilege>`

### Requirement: Console workflows keep working
Every console workflow an active agent performs SHALL return the same rows and columns as before this
change, except where the work-scope requirement removes rows of events outside console scope.

#### Scenario: Profile, lists and directory
- **WHEN** an active agent loads `console_me`, the in-scope events, campaigns, targets, guests, RSVP results and call analysis, and the roster with `provisioned`
- **THEN** each returns the same rows and columns as before the change

#### Scenario: Calls and dispatch
- **WHEN** an active agent reads its own `console_calls` rows, `call_dispatch_status` and its own `human_agent_call_legs`, and claims and updates a call in `console_call_feed`
- **THEN** the reads return the same rows and the claim and update succeed as before

#### Scenario: Own state and chat
- **WHEN** an active agent upserts its own `console_agent_shift` and `agent_status` in the shape the client sends, and reads and inserts `console_chat_messages`
- **THEN** each statement succeeds and returns the row as before

#### Scenario: Realtime
- **WHEN** a row changes in `console_calls`, `console_call_feed` or `console_chat_messages`
- **THEN** an active agent subscribed through Realtime receives the change as before

### Requirement: The behaviour is proven by local integration tests
An integration test suite SHALL execute every requirement above against the local database, in a
transaction rolled back at the end, as each caller kind: anonymous, regular user, staff member without an
agent row, inactive agent, and active agent with and without `view_customer_data`. The suite SHALL also
include a Data API test for the anonymous and regular callers.

#### Scenario: Behaviour drift
- **WHEN** a policy, view or grant change alters any expected result
- **THEN** the suite fails and names the object, the caller and the operation
