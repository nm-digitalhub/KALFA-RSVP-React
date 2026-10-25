# Database access map: every `public` table and view (production, 25.10.2026)

**What this is.** The map task 1.2 asks for, extended from the 25 tables of this change to the whole `public` schema, so
the parts this change does not fix are named instead of assumed. Every row of the appendix comes from one read-only query,
[`db-access-map.sql`](db-access-map.sql), run with `supabase db query --linked` against production (PG 17.6) on
25.10.2026, plus the follow-up probes quoted where they are used. The local chain and production both hold 386 migrations,
latest `20261022124922`.

**How to read the evidence.** "Measured" means read from production catalogues (`pg_policies`, `pg_class`,
`information_schema.*_privileges`, `pg_proc`) or from an anon Data API call. "Inferred" means it follows from policy text
and grants but no write was attempted: nothing was written on production. The Data API applies three layers (Supabase,
[Data REST API](https://supabase.com/docs/guides/api): RLS, roles and grants); each row lists all three.

## 1. Totals

134 objects: 125 tables, 9 views. Every table has RLS enabled (none forced). `anon` holds a table grant on two tables
only, both in group A: `faq_items` and `packages` (`SELECT`), each matched by a policy `TO anon, authenticated` on
`published = true` / `active = true`. Nine policies are written `TO public` (`channels`, `workflows` as `ALL`; `fleet_*`,
`webhook_deliveries`, `workflow_run*` as `SELECT`); all nine are on group A tables and gate on `is_platform_staff()`, so
`anon` passes none of them. No client-facing `UPDATE`/`ALL` policy lacks a `WITH CHECK`.

| Group | Objects | Gate in the database | Status |
|---|---:|---|---|
| A. This change | 25 | 14 let **any** platform staff write (`is_platform_staff()`), 9 let any staff read, 2 already check a key | **open: the change fixes these** |
| B. Closed: no grant to `anon`/`authenticated` | 43 | none needed; only `service_role` and the server reach them | correct by construction |
| C. Event ownership | 18 | `can_access_event(event_id, resource, action)` / `owns_event` | reads correct; two findings (2.1, 2.3) |
| D. Organization | 8 | `has_org_permission` / `is_org_member` / `is_org_owner` | one finding (2.2) |
| E. Own rows, catalogues | 7 | `auth.uid()`, or any signed-in user for the role catalogues | correct for what they hold |
| F. Console agents | 11 | `is_console_agent()` | any agent sees every row (3.2) |
| G. Platform owner / one key | 13 | `is_platform_owner()` or `has_platform_permission(key)` | correct |
| H. Views | 9 | 7 run as their owner (no `security_invoker`), each with its own gate in the `WHERE` | correct; same breadth as F |

The one class this change exists for, a policy whose only condition is "is platform staff" on a table the client can
write, appears **only** in group A. Outside the 25 there is none (measured: no `is_platform_staff()`-only policy with
`INSERT`/`UPDATE`/`DELETE`/`ALL` on any table outside the list). So the scope of the change is complete for that class.

## 2. Findings outside this change's class

### 2.1 `activity_log`: any signed-in user can insert into any event's log (inferred, not executed)

- Grants: `authenticated` has `SELECT` and column `INSERT (action, event_id, meta, user_id)`.
- Policy: `INSERT WITH CHECK (user_id = auth.uid())`. Nothing ties `event_id` to the caller; only the foreign key.
- The row then shows to that event's owner (`SELECT USING (user_id = auth.uid() OR can_access_event(event_id, 'events', 'view'))`).
- **Server code trusts these rows for decisions**, reading through the service client:
  - `src/lib/payments/activate-paid-package.ts:90` `hasActivationRow`: `campaign.activated` decides whether the repair
    writes the activation row.
  - `src/lib/data/payment-orphans.ts:279` `retriedRecently`: `campaign.activation_retried` suppresses a retry and its
    alert for a day.
  - `src/lib/data/events.ts:576`: the latest closure action decides the closure reason shown.
- Practical reach: an event id is a UUID, so another customer's event is hard to target; the caller's **own** events are
  not. A customer can forge `campaign.activation_retried` on their own campaign and silence a retry.
- A legitimate client path exists: `src/lib/data/activity.ts:54` inserts through the user session. Closing the policy
  needs that path moved to the server first.
- Scope: event ownership, not platform staff. Not part of this change.

### 2.2 `organization_members`: `members.manage` can assign any role, including the owner role (inferred)

- Policy: `FOR ALL USING/WITH CHECK (has_org_permission(organization_id, 'members', 'manage'))`. No condition on
  `role_id`, and no trigger on `organization_members` (measured: `pg_trigger` lists none; `organization_role_permissions`
  has four protecting triggers, this table has none).
- So a member whose role holds `members.manage` may insert or update a membership with the org owner role, theirs included.
- Today: 4 organizations, 5 memberships (4 owner role, 1 not); one non-owner role holds `members.manage`; **0 members hold
  it**. Latent, not live.
- Scope: organization permissions. Not part of this change.

### 2.3 `events`: the owner writes columns the server treats as controlled (measured grants)

- `authenticated` holds column `UPDATE` on 14 columns, among them `with_ai_calls`, `event_date`, `rsvp_deadline`; the policy is
  `can_access_event(id, 'events', 'edit')`.
- `with_ai_calls` is the open item already tracked (client-writable); `event_date` also moves through
  `admin_reschedule_event` (`manage_billing`), so the direct column write bypasses that path. Whether a trigger
  constrains these after payment was not checked here.
- Scope: event ownership. Not part of this change.

## 3. Groups that are correct but deserve a note

### 3.1 Role catalogues readable by any signed-in user

`org_roles`, `permission_definitions`, `role_permissions`: `SELECT USING (auth.uid() IS NOT NULL)`. They hold role names
and permission keys, no customer data. Intended for the role editor; listed so it is a decision, not an accident.

### 3.2 Console agents see every row of their tables and views

Group F and the 7 owner-run views gate on `is_console_agent()` (plus `auth.uid()` in `console_me`). Any provisioned agent
reads all events, guests and calls in scope (`console_event_in_scope`: events with `with_ai_calls` or a campaign), not a
per-agent subset. Production has 2 rows in `console_agents`. Whether agents should be scoped further is a product
decision, outside this change.

## 4. Functions, Storage, Realtime (measured)

- 115 non-trigger functions in `public`; 31 executable by `authenticated`, 3 by `anon`.
  - The 3 anon ones are `SECURITY INVOKER` with no table access of their own: `new_cancellation_request_code`,
    `scatter_internal`, `scatter_sfunc`.
  - Of the 24 `SECURITY DEFINER` ones callable by `authenticated`, none lacks a gate: 11 check `auth.uid()` (the helpers
    themselves, `accept_invitation`, `create_organization`), 10 check the platform (8 a key: `fleet_*` →
    `manage_settings`, `admin_reschedule_event` → `manage_billing`; `ops_db_health`/`ops_job_health` → owner), 2 the console,
    1 events (`can_access_event`).
  - **`integrations_configured_flags` gates on `is_platform_staff()` only** (returns which integrations are configured,
    no secrets). Same class as group A; add it to this change's function list.
  - `upsert_provider_number` is `SECURITY INVOKER`, so it inherits `provider_numbers` RLS (group A, already in design.md).
- Storage: 5 buckets, all private; **no policies on `storage.objects`**, so only `service_role` reaches files.
- Realtime: one policy on `realtime.messages`, `staff:<own uid>` broadcast topic only (the permission-change signal).

## 5. What this means for the plan

1. Group A (25 tables) plus `integrations_configured_flags` is the complete set for the staff-floor class. Task 1.2 can
   proceed on that list.
2. Findings 2.1 to 2.3 are event and organization rules. They are recorded here so they are not lost; the change does not
   fix them (proposal: "no other table"), and the owner decides whether they become their own work.
3. Groups B, E, G and Storage need nothing.
4. The closed default for new tables (this change's third part) protects against the class recurring; it does not touch
   2.1 to 2.3, which are policies on existing tables.

## Appendix: every object, as measured

Policies are shown as `cmd · roles · USING / WITH CHECK`, truncated at 200/160 characters. `+column` lists column
grants beyond the table grant.

### A. In this change (25): 25

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `agreement_documents` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `call_compliance_settings` | on | – | SELECT,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `call_dnc_list` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `callback_schedule_policies` | on | – | SELECT,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `channels` | on | – | DELETE,INSERT,SELECT,UPDATE | ALL · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff)<br>SELECT · {authenticated} · true / – |
| `faq_items` | on | SELECT | DELETE,INSERT,SELECT,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff)<br>SELECT · {anon,authenticated} · (published = true) / – |
| `fleet_goals` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `fleet_request_slack_threads` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `fleet_requests` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `message_templates` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `ops_alerts` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `otp_challenges` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `outreach_template_failures` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `packages` | on | SELECT | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff)<br>SELECT · {anon,authenticated} · (active = true) / – |
| `provider_number_roles` | on | – | DELETE,INSERT,SELECT,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `provider_numbers` | on | – | DELETE,INSERT,SELECT,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `voice_purpose_attempts` | on | – | SELECT | SELECT · {authenticated} · ( SELECT has_platform_permission('manage_voice'::text) AS has_platform_permission) / – |
| `voice_purposes` | on | – | DELETE,INSERT,SELECT,UPDATE | ALL · {authenticated} · ( SELECT has_platform_permission('manage_voice'::text) AS has_platform_permission) / ( SELECT has_platform_permission('manage_voice'::text) AS has_platform_permission) |
| `vox_log_exports` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `webhook_deliveries` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `webhook_inbox` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |
| `workflow_run_events` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `workflow_run_steps` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `workflow_runs` | on | – | SELECT | SELECT · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / – |
| `workflows` | on | – | DELETE,INSERT,SELECT,UPDATE | ALL · {public} · ( SELECT is_platform_staff() AS is_platform_staff) / ( SELECT is_platform_staff() AS is_platform_staff) |

### B. Closed: no client grant (server only): 43

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `approval_requests` | on | – | – | – |
| `call_attempts` | on | – | – | – |
| `callback_request_attempts` | on | – | – | – |
| `campaign_pricing` | on | – | – | – |
| `cardcom_config` | on | – | – | – |
| `cardcom_payment_sessions` | on | – | – | – |
| `console_agent_commands` | on | – | – | – |
| `console_agent_secrets` | on | – | – | – |
| `console_call_pii` | on | – | – | – |
| `coupon_assignment_events` | on | – | – | – |
| `coupon_assignment_options` | on | – | – | – |
| `coupon_assignments` | on | – | – | – |
| `dnc_registry_checks` | on | – | – | – |
| `exchange_availability_blocks` | on | – | – | – |
| `exchange_calendar_links` | on | – | – | – |
| `exchange_connections` | on | – | – | – |
| `fleet_social_posts` | on | – | – | – |
| `inbound_agent_attempts` | on | – | – | – |
| `inquiry_messages` | on | – | – | – |
| `integration_connections` | on | – | – | – |
| `integration_oauth_states` | on | – | – | – |
| `integration_provider_configs` | on | – | – | – |
| `marketing_consent_events` | on | – | – | – |
| `message_template_routes` | on | – | – | – |
| `offer_packages` | on | – | – | – |
| `offers` | on | – | – | – |
| `owner_agent_intake` | on | – | –; +authenticated:SELECT | SELECT · {authenticated} · ( SELECT is_platform_owner() AS is_platform_owner) / – |
| `payment_operation_kinds` | on | – | – | – |
| `payment_operation_lines` | on | – | – | – |
| `payment_operations` | on | – | – | – |
| `push_delivery_log` | on | – | – | – |
| `rdp_access_events` | on | – | – | – |
| `rdp_access_grants` | on | – | –; +authenticated:SELECT | SELECT · {authenticated} · ((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_platform_permission('rdp.request'::text) AS has_platform_permission)) / – |
| `rdp_access_requests` | on | – | –; +authenticated:SELECT | SELECT · {authenticated} · ((requester_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_platform_permission('rdp.request'::text) AS has_platform_permission)) / – |
| `sales_call_attempts` | on | – | – | – |
| `signed_agreements` | on | – | – | – |
| `signup_terms_acceptances` | on | – | – | – |
| `sumit_customers` | on | – | – | – |
| `sumit_test_transactions` | on | – | – | – |
| `test_events` | on | – | – | – |
| `whatsapp_message_templates` | on | – | – | – |
| `whatsapp_template_parameters` | on | – | – | – |
| `whatsapp_template_settings` | on | – | – | – |

### C. Event ownership (can_access_event / owns_event): 18

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `activity_log` | on | – | SELECT; +authenticated:INSERT | SELECT · {authenticated} · ((user_id = ( SELECT auth.uid() AS uid)) OR can_access_event(event_id, 'events'::text, 'view'::text)) / –<br>INSERT · {authenticated} · – / (user_id = ( SELECT auth.uid() AS uid)) |
| `billed_results` | on | – | INSERT,REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · can_access_event(event_id, 'billing'::text, 'view'::text) / – |
| `billing_credits` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'billing'::text, 'view'::text) / – |
| `call_analysis` | on | – | SELECT | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / – |
| `campaign_authorized_contacts` | on | – | INSERT,REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / – |
| `campaign_authorized_set_audit` | on | – | INSERT,REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / –<br>INSERT · {service_role} · – / true |
| `campaign_quota_alerts` | on | – | SELECT | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / – |
| `campaign_quota_changes` | on | – | SELECT | SELECT · {authenticated} · can_access_event(event_id, 'billing'::text, 'view'::text) / – |
| `campaigns` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / – |
| `contact_interactions` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · ((event_id IS NOT NULL) AND can_access_event(event_id, 'contacts'::text, 'view'::text)) / – |
| `contacts` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'contacts'::text, 'view'::text) / – |
| `event_cancellation_requests` | on | – | REFERENCES,SELECT,TRIGGER; +authenticated:INSERT | INSERT · {authenticated} · – / ((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_cancellation_requests.event_id) AND (e.owner_id = ( SELECT a<br>SELECT · {authenticated} · (owner_id = ( SELECT auth.uid() AS uid)) / – |
| `event_questions` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | INSERT · {authenticated} · – / can_access_event(event_id, 'events'::text, 'edit'::text)<br>SELECT · {authenticated} · can_access_event(event_id, 'events'::text, 'view'::text) / –<br>UPDATE · {authenticated} · can_access_event(event_id, 'events'::text, 'edit'::text) / can_access_event(event_id, 'events'::text, 'edit'::text)<br>DELETE · {authenticated} · owns_event(event_id) / – |
| `guest_groups` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | DELETE · {authenticated} · can_access_event(event_id, 'guests'::text, 'delete'::text) / –<br>INSERT · {authenticated} · – / can_access_event(event_id, 'guests'::text, 'create'::text)<br>SELECT · {authenticated} · can_access_event(event_id, 'guests'::text, 'view'::text) / –<br>UPDATE · {authenticated} · can_access_event(event_id, 'guests'::text, 'edit'::text) / can_access_event(event_id, 'guests'::text, 'edit'::text) |
| `guest_import_staging` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'guests'::text, 'view'::text) / –<br>UPDATE · {authenticated} · can_access_event(event_id, 'guests'::text, 'create'::text) / can_access_event(event_id, 'guests'::text, 'create'::text) |
| `guests` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | DELETE · {authenticated} · can_access_event(event_id, 'guests'::text, 'delete'::text) / –<br>INSERT · {authenticated} · – / can_access_event(event_id, 'guests'::text, 'create'::text)<br>SELECT · {authenticated} · can_access_event(event_id, 'guests'::text, 'view'::text) / –<br>UPDATE · {authenticated} · can_access_event(event_id, 'guests'::text, 'edit'::text) / can_access_event(event_id, 'guests'::text, 'edit'::text) |
| `outreach_state` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'campaigns'::text, 'view'::text) / – |
| `rsvp_responses` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · can_access_event(event_id, 'guests'::text, 'view'::text) / – |

### D. Organization (has_org_permission / is_org_member / is_org_owner): 8

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `events` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE; +authenticated:UPDATE | SELECT · {authenticated} · ((owner_id = ( SELECT auth.uid() AS uid)) OR ((org_id IS NOT NULL) AND has_org_permission(org_id, 'events'::text, 'view'::text))) / –<br>UPDATE · {authenticated} · can_access_event(id, 'events'::text, 'edit'::text) / can_access_event(id, 'events'::text, 'edit'::text)<br>DELETE · {authenticated} · ((owner_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::event_status)) / –<br>INSERT · {authenticated} · – / ((owner_id = ( SELECT auth.uid() AS uid)) AND ((org_id IS NULL) OR has_org_permission(org_id, 'events'::text, 'create'::text))) |
| `organization_audit_log` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · has_org_permission(organization_id, 'organization'::text, 'manage'::text) / – |
| `organization_invitations` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · has_org_permission(organization_id, 'members'::text, 'manage'::text) / has_org_permission(organization_id, 'members'::text, 'manage'::text) |
| `organization_members` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | ALL · {authenticated} · has_org_permission(organization_id, 'members'::text, 'manage'::text) / has_org_permission(organization_id, 'members'::text, 'manage'::text)<br>SELECT · {authenticated} · is_org_member(organization_id) / – |
| `organizations` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · is_org_member(id) / –<br>UPDATE · {authenticated} · has_org_permission(id, 'organization'::text, 'edit'::text) / has_org_permission(id, 'organization'::text, 'edit'::text) |
| `push_subscriptions` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | DELETE · {authenticated} · (user_id = ( SELECT auth.uid() AS uid)) / –<br>INSERT · {authenticated} · – / ((user_id = ( SELECT auth.uid() AS uid)) AND ((org_id IS NULL) OR is_org_member(org_id)))<br>SELECT · {authenticated} · (user_id = ( SELECT auth.uid() AS uid)) / –<br>UPDATE · {authenticated} · (user_id = ( SELECT auth.uid() AS uid)) / ((user_id = ( SELECT auth.uid() AS uid)) AND ((org_id IS NULL) OR is_org_member(org_id))) |
| `organization_role_audit_log` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · is_org_owner(organization_id) / – |
| `organization_role_permissions` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · is_org_owner(organization_id) / – |

### E. Own rows and catalogues for any signed-in user: 7

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `callback_requests` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | INSERT · {authenticated} · – / ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (triage_status = 'pending'::text) AND (triage_attempt_count = 0) AND (triaged_at IS NULL) AND (triage_last_error  |
| `contact_messages` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | INSERT · {authenticated} · – / (( SELECT auth.uid() AS uid) IS NOT NULL) |
| `org_roles` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · (( SELECT auth.uid() AS uid) IS NOT NULL) / – |
| `permission_definitions` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · (( SELECT auth.uid() AS uid) IS NOT NULL) / – |
| `profiles` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | SELECT · {authenticated} · (( SELECT auth.uid() AS uid) = id) / –<br>ALL · {authenticated} · (( SELECT auth.uid() AS uid) = id) / (( SELECT auth.uid() AS uid) = id) |
| `role_permissions` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · (( SELECT auth.uid() AS uid) IS NOT NULL) / – |
| `user_settings` | on | – | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE | INSERT · {authenticated} · – / (( SELECT auth.uid() AS uid) = user_id)<br>SELECT · {authenticated} · (( SELECT auth.uid() AS uid) = user_id) / –<br>UPDATE · {authenticated} · (( SELECT auth.uid() AS uid) = user_id) / (( SELECT auth.uid() AS uid) = user_id) |

### F. Console agents (is_console_agent): 11

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `agent_status` | on | – | INSERT,SELECT,UPDATE | SELECT · {authenticated} · is_console_agent() / –<br>UPDATE · {authenticated} · ((agent_id = ( SELECT auth.uid() AS uid)) AND is_console_agent()) / ((agent_id = ( SELECT auth.uid() AS uid)) AND is_console_agent())<br>INSERT · {authenticated} · – / ((agent_id = ( SELECT auth.uid() AS uid)) AND is_console_agent()) |
| `call_dispatch_status` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `console_agent_calendar_presence` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `console_agent_queues` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `console_agent_shift` | on | – | SELECT; +authenticated:INSERT,authenticated:UPDATE | SELECT · {authenticated} · is_console_agent() / –<br>UPDATE · {authenticated} · ((agent_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_console_agent() AS is_console_agent)) / ((agent_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_console_agent() AS is_console_agent))<br>INSERT · {authenticated} · – / ((agent_id = ( SELECT auth.uid() AS uid)) AND is_console_agent()) |
| `console_agents` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `console_call_feed` | on | – | SELECT; +authenticated:UPDATE | SELECT · {authenticated} · is_console_agent() / –<br>UPDATE · {authenticated} · (is_console_agent() AND ((agent_id IS NULL) OR (agent_id = ( SELECT auth.uid() AS uid)))) / (is_console_agent() AND (agent_id = ( SELECT auth.uid() AS uid))) |
| `console_calls` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `console_chat_messages` | on | – | INSERT,SELECT | INSERT · {authenticated} · – / (is_console_agent() AND (author_id = ( SELECT auth.uid() AS uid)))<br>SELECT · {authenticated} · is_console_agent() / – |
| `console_queues` | on | – | SELECT | SELECT · {authenticated} · is_console_agent() / – |
| `human_agent_call_legs` | on | – | SELECT; +authenticated:UPDATE | SELECT · {authenticated} · ((agent_id = ( SELECT auth.uid() AS uid)) AND is_console_agent()) / –<br>UPDATE · {authenticated} · ((agent_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_console_agent() AS is_console_agent)) / ((agent_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_console_agent() AS is_console_agent)) |

### G. Platform owner only / one platform key: 13

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `ops_errors` | on | – | SELECT | SELECT · {authenticated} · is_platform_owner() / – |
| `owner_agent_allowlist` | on | – | SELECT | SELECT · {authenticated} · ( SELECT is_platform_owner() AS is_platform_owner) / – |
| `owner_agent_audit` | on | – | SELECT | SELECT · {authenticated} · ( SELECT is_platform_owner() AS is_platform_owner) / – |
| `owner_agent_report_run` | on | – | SELECT | SELECT · {authenticated} · ( SELECT is_platform_owner() AS is_platform_owner) / – |
| `owner_agent_report_subscription` | on | – | SELECT | SELECT · {authenticated} · ( SELECT is_platform_owner() AS is_platform_owner) / – |
| `platform_permission_definitions` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · is_platform_owner() / – |
| `platform_role_audit_log` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · is_platform_owner() / – |
| `platform_role_permissions` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · is_platform_owner() / – |
| `platform_roles` | on | – | REFERENCES,SELECT,TRIGGER | SELECT · {authenticated} · is_platform_owner() / – |
| `platform_staff` | on | – | REFERENCES,SELECT,TRIGGER | ALL · {authenticated} · is_platform_owner() / is_platform_owner()<br>SELECT · {authenticated} · is_platform_owner() / – |
| `support_access_log` | on | – | SELECT | SELECT · {authenticated} · is_platform_owner() / – |
| `app_settings` | on | – | SELECT,UPDATE | ALL · {authenticated} · ( SELECT has_platform_permission('manage_settings'::text) AS has_platform_permission) / ( SELECT has_platform_permission('manage_settings'::text) AS has_platform_permission) |
| `company_profile` | on | – | SELECT,UPDATE | ALL · {authenticated} · ( SELECT has_platform_permission('manage_settings'::text) AS has_platform_permission) / ( SELECT has_platform_permission('manage_settings'::text) AS has_platform_permission) |

### H. Views: 9

| Object | RLS | anon | authenticated (table; +column) | Policies (cmd · roles · USING / WITH CHECK) |
|---|---|---|---|---|
| `console_agents_roster` | n/a | – | SELECT | view, security_invoker=on |
| `console_call_analysis` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_campaign_targets` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_campaigns` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_event_guests` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_events` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_me` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `console_rsvp_results` | n/a | – | SELECT | view, no security_invoker: runs as its owner, so its own WHERE is the gate |
| `exchange_connections_status` | n/a | – | – | view, security_invoker=true |
