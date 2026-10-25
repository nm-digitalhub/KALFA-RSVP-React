-- staff-tables-permission-rls, stage S5 (task 6.1): the cases of the manage_settings tables that s5_settings_test.sql
-- does not generate (HAND_WRITTEN in src/lib/auth/staff-table-rls.ts):
--   * the seeded roles (owner, ops_engineer, billing_clerk, auditor), a stand-in for support_agent and a holder of only
--     manage_settings;
--   * the statement shapes of message-templates.ts, admin/channel-catalog.ts, admin/faq.ts, callbacks/policy/actions.ts
--     and policy-config-admin.ts (readPolicyRow), admin/alerts.ts and admin/fleet.ts, for the holders and for every
--     session without the key;
--   * the kept reads: channels_auth_read (any signed-in user, getChannelCatalog) and faq_items_public_read (anon and
--     authenticated, published rows, getPublishedFaqItems);
--   * the six fleet_* RPCs (SECURITY DEFINER, gated inside on manage_settings since 20261015114659): each holder
--     succeeds and every session without the key is refused.
-- Created with `npx supabase test new database/s5_settings_paths`; run with
--   SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database
-- One transaction, rolled back: no row, role or grant survives the run.
--
-- support_agent exists in production only (created through the staff UI on 13.07.2026, not by a migration). The
-- stand-in role holds its live keys, read on 25.10.2026: view_activity_log, view_customer_data, view_events.
begin;
create extension if not exists pgtap with schema extensions;
select plan(191);

-- Actors: d501 owner, d502 ops_engineer, d503 billing_clerk, d504 auditor, d505 support_agent stand-in,
-- d506 holder of only manage_settings, d507 signed in and not staff.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d501', 'rls-s5-d501@test.invalid'),
  ('00000000-0000-4000-8000-00000000d502', 'rls-s5-d502@test.invalid'),
  ('00000000-0000-4000-8000-00000000d503', 'rls-s5-d503@test.invalid'),
  ('00000000-0000-4000-8000-00000000d504', 'rls-s5-d504@test.invalid'),
  ('00000000-0000-4000-8000-00000000d505', 'rls-s5-d505@test.invalid'),
  ('00000000-0000-4000-8000-00000000d506', 'rls-s5-d506@test.invalid'),
  ('00000000-0000-4000-8000-00000000d507', 'rls-s5-d507@test.invalid');
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d501', id, '00000000-0000-4000-8000-00000000d501' from public.platform_roles where name = 'owner';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d502', id, '00000000-0000-4000-8000-00000000d502' from public.platform_roles where name = 'ops_engineer';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d503', id, '00000000-0000-4000-8000-00000000d503' from public.platform_roles where name = 'billing_clerk';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d504', id, '00000000-0000-4000-8000-00000000d504' from public.platform_roles where name = 'auditor';
insert into public.platform_roles (id, name, label, is_owner_role, rank) values
  ('00000000-0000-4000-8000-00000000d591', 'rls_s5_support_agent', 'RLS test: support_agent stand-in', false, 0),
  ('00000000-0000-4000-8000-00000000d592', 'rls_s5_settings', 'RLS test: manage_settings only', false, 0);
insert into public.platform_role_permissions (role_id, permission_id)
  select '00000000-0000-4000-8000-00000000d591', id from public.platform_permission_definitions
  where key in ('view_activity_log', 'view_customer_data', 'view_events');
insert into public.platform_role_permissions (role_id, permission_id)
  select '00000000-0000-4000-8000-00000000d592', id from public.platform_permission_definitions where key = 'manage_settings';
insert into public.platform_staff (user_id, role_id, granted_by) values
  ('00000000-0000-4000-8000-00000000d505', '00000000-0000-4000-8000-00000000d591', '00000000-0000-4000-8000-00000000d505'),
  ('00000000-0000-4000-8000-00000000d506', '00000000-0000-4000-8000-00000000d592', '00000000-0000-4000-8000-00000000d506');

-- Row fixtures.
insert into public.message_templates (id, message_key, channel, label, name, category, requested_category)
  values ('00000000-0000-4000-8000-00000000c551', 'rls_paths', 'whatsapp', 'RLS paths', 'RLS', 'UTILITY', 'MARKETING');
insert into public.channels (key, display_name, active, sort_order) values ('rls_paths', 'RLS paths', true, 99);
insert into public.faq_items (id, item_key, category, question, published) values
  ('00000000-0000-4000-8000-00000000c561', 'rls_pub', 'about', 'RLS published?', true),
  ('00000000-0000-4000-8000-00000000c562', 'rls_unpub', 'about', 'RLS unpublished?', false);
insert into public.callback_schedule_policies (id) values (true) on conflict (id) do nothing;
update public.callback_schedule_policies set daily_cap = 7 where id;
insert into public.ops_alerts (id, level, title) values ('00000000-0000-4000-8000-00000000c571', 'info', 'RLS paths alert');
insert into public.fleet_requests (id, request_key, role, kind, title, body) values
  ('00000000-0000-4000-8000-00000000c581', 'rls:paths', 'rls', 'question', 'RLS paths request', 'RLS paths body'),
  ('00000000-0000-4000-8000-00000000c583', 'rls:answer:owner', 'rls', 'question', 'RLS answer by owner', 'RLS body'),
  ('00000000-0000-4000-8000-00000000c584', 'rls:answer:ops', 'rls', 'question', 'RLS answer by ops', 'RLS body'),
  ('00000000-0000-4000-8000-00000000c585', 'rls:answer:settings', 'rls', 'question', 'RLS answer by settings', 'RLS body');
insert into public.fleet_request_slack_threads (request_id, thread_ts)
  values ('00000000-0000-4000-8000-00000000c581', '1700000000.000200');
insert into public.fleet_goals (id, role, title, body, status, next_wake_at) values
  ('00000000-0000-4000-8000-00000000c591', 'rls', 'RLS goal active', 'RLS goal active body', 'active', now()),
  ('00000000-0000-4000-8000-00000000c592', 'rls', 'RLS goal paused', 'RLS goal paused body', 'paused', null),
  ('00000000-0000-4000-8000-00000000c593', 'rls', 'RLS goal of owner', 'RLS goal of owner body', 'active', now()),
  ('00000000-0000-4000-8000-00000000c594', 'rls', 'RLS goal of ops', 'RLS goal of ops body', 'active', now()),
  ('00000000-0000-4000-8000-00000000c595', 'rls', 'RLS goal of settings', 'RLS goal of settings body', 'active', now());
-- What each session must list, read as postgres.
create temp table s5_expected_templates on commit drop as select message_key from public.message_templates;
create temp table s5_expected_channels_all on commit drop as select key from public.channels;
create temp table s5_expected_channels_active on commit drop as select key from public.channels where active;
create temp table s5_expected_faq_all on commit drop as select item_key from public.faq_items;
create temp table s5_expected_faq_published on commit drop as select item_key from public.faq_items where published;
grant select on s5_expected_templates, s5_expected_channels_all, s5_expected_channels_active, s5_expected_faq_all,
  s5_expected_faq_published to authenticated, anon;

-- The actors hold what the cases assume.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select is((select public.has_platform_permission('manage_settings')), true, 'owner: manage_settings is true');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select is((select public.has_platform_permission('manage_settings')), true, 'ops_engineer: manage_settings is true');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select is((select public.has_platform_permission('manage_settings')), false, 'billing_clerk: manage_settings is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select is((select public.has_platform_permission('manage_settings')), false, 'auditor: manage_settings is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select is((select public.has_platform_permission('manage_settings')), false, 'support_agent (stand-in): manage_settings is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select is((select public.has_platform_permission('manage_settings')), true, 'holder of only manage_settings: manage_settings is true');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select is((select public.has_platform_permission('manage_settings')), false, 'signed-in non-staff: manage_settings is false');

-- ═══ message_templates (message-templates.ts): the list, an edit by id, the category acceptance ═══════════════════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select is_empty($$select message_key from public.message_templates order by channel, message_key$$, 'message_templates: billing_clerk lists no template');
select is_empty($$update public.message_templates set name = 'x', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id$$, 'message_templates: billing_clerk edit changes no row');
select is_empty($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id$$, 'message_templates: billing_clerk category acceptance changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select is_empty($$select message_key from public.message_templates order by channel, message_key$$, 'message_templates: auditor lists no template');
select is_empty($$update public.message_templates set name = 'x', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id$$, 'message_templates: auditor edit changes no row');
select is_empty($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id$$, 'message_templates: auditor category acceptance changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select is_empty($$select message_key from public.message_templates order by channel, message_key$$, 'message_templates: support_agent (stand-in) lists no template');
select is_empty($$update public.message_templates set name = 'x', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id$$, 'message_templates: support_agent (stand-in) edit changes no row');
select is_empty($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id$$, 'message_templates: support_agent (stand-in) category acceptance changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select is_empty($$select message_key from public.message_templates order by channel, message_key$$, 'message_templates: signed-in non-staff lists no template');
select is_empty($$update public.message_templates set name = 'x', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id$$, 'message_templates: signed-in non-staff edit changes no row');
select is_empty($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id$$, 'message_templates: signed-in non-staff category acceptance changes no row');
set local role anon;
select throws_ok($$select message_key from public.message_templates order by channel, message_key$$, '42501', 'permission denied for table message_templates', 'message_templates: anon list refused (no grant)');
select throws_ok($$update public.message_templates set name = 'x' where id = '00000000-0000-4000-8000-00000000c551'$$, '42501', 'permission denied for table message_templates', 'message_templates: anon edit refused (no grant)');
reset role;
select results_eq($$select name || '/' || requested_category from public.message_templates where id = '00000000-0000-4000-8000-00000000c551'$$, array['RLS/MARKETING'], 'message_templates: the template is intact after the refusals');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select set_eq($$select message_key from public.message_templates order by channel, message_key$$, $$select message_key from s5_expected_templates$$, 'message_templates: owner lists every template');
select results_eq($$select message_key from public.message_templates where id = '00000000-0000-4000-8000-00000000c551'$$, array['rls_paths'], 'message_templates: owner reads the template by id');
select results_eq($$update public.message_templates set name = 'RLS edited', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: owner edits the template');
select results_eq($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: owner accepts the category');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select set_eq($$select message_key from public.message_templates order by channel, message_key$$, $$select message_key from s5_expected_templates$$, 'message_templates: ops_engineer lists every template');
select results_eq($$select message_key from public.message_templates where id = '00000000-0000-4000-8000-00000000c551'$$, array['rls_paths'], 'message_templates: ops_engineer reads the template by id');
select results_eq($$update public.message_templates set name = 'RLS edited', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: ops_engineer edits the template');
select results_eq($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: ops_engineer accepts the category');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select set_eq($$select message_key from public.message_templates order by channel, message_key$$, $$select message_key from s5_expected_templates$$, 'message_templates: holder of only manage_settings lists every template');
select results_eq($$select message_key from public.message_templates where id = '00000000-0000-4000-8000-00000000c551'$$, array['rls_paths'], 'message_templates: holder of only manage_settings reads the template by id');
select results_eq($$update public.message_templates set name = 'RLS edited', language = 'he', body = null, active = false where id = '00000000-0000-4000-8000-00000000c551' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: holder of only manage_settings edits the template');
select results_eq($$update public.message_templates set requested_category = 'UTILITY' where id = '00000000-0000-4000-8000-00000000c551' and category = 'UTILITY' returning id::text$$, array['00000000-0000-4000-8000-00000000c551'], 'message_templates: holder of only manage_settings accepts the category');

-- ═══ channels (admin/channel-catalog.ts; the kept read channels_auth_read serves channel-catalog.ts) ══════════════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select set_eq($$select key from public.channels where active = true order by sort_order$$, $$select key from s5_expected_channels_active$$, 'channels: billing_clerk getChannelCatalog reads the active channels (channels_auth_read)');
select is_empty($$update public.channels set display_name = 'x', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, 'channels: billing_clerk edit changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select set_eq($$select key from public.channels where active = true order by sort_order$$, $$select key from s5_expected_channels_active$$, 'channels: auditor getChannelCatalog reads the active channels (channels_auth_read)');
select is_empty($$update public.channels set display_name = 'x', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, 'channels: auditor edit changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select set_eq($$select key from public.channels where active = true order by sort_order$$, $$select key from s5_expected_channels_active$$, 'channels: support_agent (stand-in) getChannelCatalog reads the active channels (channels_auth_read)');
select is_empty($$update public.channels set display_name = 'x', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, 'channels: support_agent (stand-in) edit changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select set_eq($$select key from public.channels where active = true order by sort_order$$, $$select key from s5_expected_channels_active$$, 'channels: signed-in non-staff getChannelCatalog reads the active channels (channels_auth_read)');
select is_empty($$update public.channels set display_name = 'x', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, 'channels: signed-in non-staff edit changes no row');
set local role anon;
select throws_ok($$select key from public.channels where active = true$$, '42501', 'permission denied for table channels', 'channels: anon getChannelCatalog refused (no grant)');
select throws_ok($$update public.channels set display_name = 'x' where key = 'rls_paths'$$, '42501', 'permission denied for table channels', 'channels: anon edit refused (no grant)');
reset role;
select results_eq($$select display_name from public.channels where key = 'rls_paths'$$, array['RLS paths'], 'channels: the channel is intact after the refusals');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select set_eq($$select key from public.channels order by sort_order$$, $$select key from s5_expected_channels_all$$, 'channels: owner admin list returns every channel');
select results_eq($$update public.channels set display_name = 'RLS edited', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, array['rls_paths'], 'channels: owner edits the channel');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select set_eq($$select key from public.channels order by sort_order$$, $$select key from s5_expected_channels_all$$, 'channels: ops_engineer admin list returns every channel');
select results_eq($$update public.channels set display_name = 'RLS edited', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, array['rls_paths'], 'channels: ops_engineer edits the channel');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select set_eq($$select key from public.channels order by sort_order$$, $$select key from s5_expected_channels_all$$, 'channels: holder of only manage_settings admin list returns every channel');
select results_eq($$update public.channels set display_name = 'RLS edited', is_built = false, active = true, sort_order = 99 where key = 'rls_paths' returning key$$, array['rls_paths'], 'channels: holder of only manage_settings edits the channel');

-- ═══ faq_items (admin/faq.ts; the kept read faq_items_public_read serves faq.ts) ══════════════════════════════════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select set_eq($$select item_key from public.faq_items where published = true order by category, sort_order$$, $$select item_key from s5_expected_faq_published$$, 'faq_items: billing_clerk getPublishedFaqItems reads the published items');
select is_empty($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, 'faq_items: billing_clerk does not see the unpublished item');
select throws_ok($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS refused?', '', 0, false)$$, '42501', 'new row violates row-level security policy for table "faq_items"', 'faq_items: billing_clerk createFaqItem refused (with check)');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: billing_clerk edit of the published item changes no row');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id$$, 'faq_items: billing_clerk edit of the unpublished item changes no row');
select is_empty($$delete from public.faq_items where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: billing_clerk delete deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select set_eq($$select item_key from public.faq_items where published = true order by category, sort_order$$, $$select item_key from s5_expected_faq_published$$, 'faq_items: auditor getPublishedFaqItems reads the published items');
select is_empty($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, 'faq_items: auditor does not see the unpublished item');
select throws_ok($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS refused?', '', 0, false)$$, '42501', 'new row violates row-level security policy for table "faq_items"', 'faq_items: auditor createFaqItem refused (with check)');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: auditor edit of the published item changes no row');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id$$, 'faq_items: auditor edit of the unpublished item changes no row');
select is_empty($$delete from public.faq_items where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: auditor delete deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select set_eq($$select item_key from public.faq_items where published = true order by category, sort_order$$, $$select item_key from s5_expected_faq_published$$, 'faq_items: support_agent (stand-in) getPublishedFaqItems reads the published items');
select is_empty($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, 'faq_items: support_agent (stand-in) does not see the unpublished item');
select throws_ok($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS refused?', '', 0, false)$$, '42501', 'new row violates row-level security policy for table "faq_items"', 'faq_items: support_agent (stand-in) createFaqItem refused (with check)');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: support_agent (stand-in) edit of the published item changes no row');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id$$, 'faq_items: support_agent (stand-in) edit of the unpublished item changes no row');
select is_empty($$delete from public.faq_items where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: support_agent (stand-in) delete deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select set_eq($$select item_key from public.faq_items where published = true order by category, sort_order$$, $$select item_key from s5_expected_faq_published$$, 'faq_items: signed-in non-staff getPublishedFaqItems reads the published items');
select is_empty($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, 'faq_items: signed-in non-staff does not see the unpublished item');
select throws_ok($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS refused?', '', 0, false)$$, '42501', 'new row violates row-level security policy for table "faq_items"', 'faq_items: signed-in non-staff createFaqItem refused (with check)');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: signed-in non-staff edit of the published item changes no row');
select is_empty($$update public.faq_items set question = 'x', answer = '', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id$$, 'faq_items: signed-in non-staff edit of the unpublished item changes no row');
select is_empty($$delete from public.faq_items where id = '00000000-0000-4000-8000-00000000c561' returning id$$, 'faq_items: signed-in non-staff delete deletes no row');
set local role anon;
select set_eq($$select item_key from public.faq_items where published = true order by category, sort_order$$, $$select item_key from s5_expected_faq_published$$, 'faq_items: anon getPublishedFaqItems reads the published items');
select is_empty($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, 'faq_items: anon does not see the unpublished item');
select throws_ok($$insert into public.faq_items (category, question) values ('about', 'RLS anon?')$$, '42501', 'permission denied for table faq_items', 'faq_items: anon createFaqItem refused (no grant)');
select throws_ok($$update public.faq_items set question = 'x' where id = '00000000-0000-4000-8000-00000000c561'$$, '42501', 'permission denied for table faq_items', 'faq_items: anon edit refused (no grant)');
select throws_ok($$delete from public.faq_items where id = '00000000-0000-4000-8000-00000000c561'$$, '42501', 'permission denied for table faq_items', 'faq_items: anon delete refused (no grant)');
reset role;
select results_eq(
  $$select question || '/' || published::text from public.faq_items where id in ('00000000-0000-4000-8000-00000000c561', '00000000-0000-4000-8000-00000000c562') order by item_key$$,
  array['RLS published?/true', 'RLS unpublished?/false'],
  'faq_items: both items are intact after the refusals'
);
select is((select count(*) from public.faq_items where question = 'RLS refused?'), 0::bigint, 'faq_items: no item was created by a refused session');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select set_eq($$select item_key from public.faq_items order by category, sort_order$$, $$select item_key from s5_expected_faq_all$$, 'faq_items: owner admin list returns every item');
select results_eq($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, array['rls_unpub'], 'faq_items: owner reads the unpublished item');
select results_eq($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS created by owner?', '', 0, false) returning question$$, array['RLS created by owner?'], 'faq_items: owner createFaqItem');
select results_eq($$update public.faq_items set question = 'RLS unpublished?', answer = 'owner', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id::text$$, array['00000000-0000-4000-8000-00000000c562'], 'faq_items: owner edits the item');
select results_eq($$delete from public.faq_items where question = 'RLS created by owner?' returning question$$, array['RLS created by owner?'], 'faq_items: owner deletes the item it created');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select set_eq($$select item_key from public.faq_items order by category, sort_order$$, $$select item_key from s5_expected_faq_all$$, 'faq_items: ops_engineer admin list returns every item');
select results_eq($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, array['rls_unpub'], 'faq_items: ops_engineer reads the unpublished item');
select results_eq($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS created by ops?', '', 0, false) returning question$$, array['RLS created by ops?'], 'faq_items: ops_engineer createFaqItem');
select results_eq($$update public.faq_items set question = 'RLS unpublished?', answer = 'ops', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id::text$$, array['00000000-0000-4000-8000-00000000c562'], 'faq_items: ops_engineer edits the item');
select results_eq($$delete from public.faq_items where question = 'RLS created by ops?' returning question$$, array['RLS created by ops?'], 'faq_items: ops_engineer deletes the item it created');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select set_eq($$select item_key from public.faq_items order by category, sort_order$$, $$select item_key from s5_expected_faq_all$$, 'faq_items: holder of only manage_settings admin list returns every item');
select results_eq($$select item_key from public.faq_items where id = '00000000-0000-4000-8000-00000000c562'$$, array['rls_unpub'], 'faq_items: holder of only manage_settings reads the unpublished item');
select results_eq($$insert into public.faq_items (category, question, answer, sort_order, published) values ('about', 'RLS created by settings?', '', 0, false) returning question$$, array['RLS created by settings?'], 'faq_items: holder of only manage_settings createFaqItem');
select results_eq($$update public.faq_items set question = 'RLS unpublished?', answer = 'settings', sort_order = 0, published = false where id = '00000000-0000-4000-8000-00000000c562' returning id::text$$, array['00000000-0000-4000-8000-00000000c562'], 'faq_items: holder of only manage_settings edits the item');
select results_eq($$delete from public.faq_items where question = 'RLS created by settings?' returning question$$, array['RLS created by settings?'], 'faq_items: holder of only manage_settings deletes the item it created');

-- ═══ callback_schedule_policies (readPolicyRow from policy-config-admin.ts; the update of policy/actions.ts) ══════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select is_empty($$select daily_cap::text from public.callback_schedule_policies where id = true$$, 'callback_schedule_policies: billing_clerk readPolicyRow reads no row');
select is_empty($$update public.callback_schedule_policies set daily_cap = 9, updated_at = now() where id = true returning daily_cap::text$$, 'callback_schedule_policies: billing_clerk policy save changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select is_empty($$select daily_cap::text from public.callback_schedule_policies where id = true$$, 'callback_schedule_policies: auditor readPolicyRow reads no row');
select is_empty($$update public.callback_schedule_policies set daily_cap = 9, updated_at = now() where id = true returning daily_cap::text$$, 'callback_schedule_policies: auditor policy save changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select is_empty($$select daily_cap::text from public.callback_schedule_policies where id = true$$, 'callback_schedule_policies: support_agent (stand-in) readPolicyRow reads no row');
select is_empty($$update public.callback_schedule_policies set daily_cap = 9, updated_at = now() where id = true returning daily_cap::text$$, 'callback_schedule_policies: support_agent (stand-in) policy save changes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select is_empty($$select daily_cap::text from public.callback_schedule_policies where id = true$$, 'callback_schedule_policies: signed-in non-staff readPolicyRow reads no row');
select is_empty($$update public.callback_schedule_policies set daily_cap = 9, updated_at = now() where id = true returning daily_cap::text$$, 'callback_schedule_policies: signed-in non-staff policy save changes no row');
set local role anon;
select throws_ok($$select daily_cap from public.callback_schedule_policies where id = true$$, '42501', 'permission denied for table callback_schedule_policies', 'callback_schedule_policies: anon readPolicyRow refused (no grant)');
select throws_ok($$update public.callback_schedule_policies set daily_cap = 9 where id = true$$, '42501', 'permission denied for table callback_schedule_policies', 'callback_schedule_policies: anon policy save refused (no grant)');
reset role;
select results_eq($$select daily_cap::text from public.callback_schedule_policies where id$$, array['7'], 'callback_schedule_policies: the policy is intact after the refusals');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select results_eq($$select daily_cap::text from public.callback_schedule_policies where id = true$$, array['7'], 'callback_schedule_policies: owner readPolicyRow');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select results_eq($$select daily_cap::text from public.callback_schedule_policies where id = true$$, array['7'], 'callback_schedule_policies: ops_engineer readPolicyRow');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select results_eq($$select daily_cap::text from public.callback_schedule_policies where id = true$$, array['7'], 'callback_schedule_policies: holder of only manage_settings readPolicyRow');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select results_eq($$update public.callback_schedule_policies set daily_cap = 9, updated_at = now() where id = true returning daily_cap::text$$, array['9'], 'callback_schedule_policies: owner saves the policy');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select results_eq($$update public.callback_schedule_policies set daily_cap = 10, updated_at = now() where id = true returning daily_cap::text$$, array['10'], 'callback_schedule_policies: ops_engineer saves the policy');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select results_eq($$update public.callback_schedule_policies set daily_cap = 11, updated_at = now() where id = true returning daily_cap::text$$, array['11'], 'callback_schedule_policies: holder of only manage_settings saves the policy');

-- ═══ ops_alerts (admin/alerts.ts: the log page with its exact count; app-health.ts reads it for the owner) ════════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select is_empty($$select id from public.ops_alerts order by created_at desc limit 50 offset 0$$, 'ops_alerts: billing_clerk alert log is empty');
select results_eq($$select count(*)::text from public.ops_alerts$$, array['0'], 'ops_alerts: billing_clerk alert count is 0');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select is_empty($$select id from public.ops_alerts order by created_at desc limit 50 offset 0$$, 'ops_alerts: auditor alert log is empty');
select results_eq($$select count(*)::text from public.ops_alerts$$, array['0'], 'ops_alerts: auditor alert count is 0');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select is_empty($$select id from public.ops_alerts order by created_at desc limit 50 offset 0$$, 'ops_alerts: support_agent (stand-in) alert log is empty');
select results_eq($$select count(*)::text from public.ops_alerts$$, array['0'], 'ops_alerts: support_agent (stand-in) alert count is 0');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select is_empty($$select id from public.ops_alerts order by created_at desc limit 50 offset 0$$, 'ops_alerts: signed-in non-staff alert log is empty');
select results_eq($$select count(*)::text from public.ops_alerts$$, array['0'], 'ops_alerts: signed-in non-staff alert count is 0');
set local role anon;
select throws_ok($$select id from public.ops_alerts limit 1$$, '42501', 'permission denied for table ops_alerts', 'ops_alerts: anon alert log refused (no grant)');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select results_eq($$select id::text from public.ops_alerts where id = '00000000-0000-4000-8000-00000000c571'$$, array['00000000-0000-4000-8000-00000000c571'], 'ops_alerts: owner reads the alert (the log and the debug page)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select results_eq($$select id::text from public.ops_alerts where id = '00000000-0000-4000-8000-00000000c571'$$, array['00000000-0000-4000-8000-00000000c571'], 'ops_alerts: ops_engineer reads the alert');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select results_eq($$select id::text from public.ops_alerts where id = '00000000-0000-4000-8000-00000000c571'$$, array['00000000-0000-4000-8000-00000000c571'], 'ops_alerts: holder of only manage_settings reads the alert');

-- ═══ fleet_requests, fleet_goals, fleet_request_slack_threads (admin/fleet.ts) and the six fleet_* RPCs ═══════════
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d503';
select is_empty($$select id from public.fleet_requests order by created_at desc limit 50$$, 'fleet_requests: billing_clerk conversation list is empty');
select is_empty($$select id from public.fleet_requests where status = 'pending'$$, 'fleet_requests: billing_clerk pending list is empty');
select is_empty($$select role from public.fleet_goals where status in ('active', 'paused')$$, 'fleet_goals: billing_clerk goal list is empty');
select is_empty($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, 'fleet_request_slack_threads: billing_clerk reads no thread');
select throws_ok($$select public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS refused', 'RLS refused body', null)$$, '42501', 'fleet_owner_request: not permitted', 'fleet_owner_request: billing_clerk refused');
select throws_ok($$select public.fleet_answer_request('00000000-0000-4000-8000-00000000c581', 'answered', 'x')$$, '42501', 'fleet_answer_request: not permitted', 'fleet_answer_request: billing_clerk refused');
select throws_ok($$select public.fleet_goal_create('rls', 'RLS refused', 'RLS refused body')$$, '42501', 'fleet_goal_create: not permitted', 'fleet_goal_create: billing_clerk refused');
select throws_ok($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c591', null)$$, '42501', 'fleet_goal_pause: not permitted', 'fleet_goal_pause: billing_clerk refused');
select throws_ok($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c592', null)$$, '42501', 'fleet_goal_resume: not permitted', 'fleet_goal_resume: billing_clerk refused');
select throws_ok($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c591', 'RLS refused')$$, '42501', 'fleet_goal_abandon: not permitted', 'fleet_goal_abandon: billing_clerk refused');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d504';
select is_empty($$select id from public.fleet_requests order by created_at desc limit 50$$, 'fleet_requests: auditor conversation list is empty');
select is_empty($$select role from public.fleet_goals where status in ('active', 'paused')$$, 'fleet_goals: auditor goal list is empty');
select is_empty($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, 'fleet_request_slack_threads: auditor reads no thread');
select throws_ok($$select public.fleet_goal_create('rls', 'RLS refused', 'RLS refused body')$$, '42501', 'fleet_goal_create: not permitted', 'fleet_goal_create: auditor refused');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d505';
select is_empty($$select id from public.fleet_requests order by created_at desc limit 50$$, 'fleet_requests: support_agent (stand-in) conversation list is empty');
select is_empty($$select role from public.fleet_goals where status in ('active', 'paused')$$, 'fleet_goals: support_agent (stand-in) goal list is empty');
select is_empty($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, 'fleet_request_slack_threads: support_agent (stand-in) reads no thread');
select throws_ok($$select public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS refused', 'RLS refused body', null)$$, '42501', 'fleet_owner_request: not permitted', 'fleet_owner_request: support_agent (stand-in) refused');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d507';
select is_empty($$select id from public.fleet_requests order by created_at desc limit 50$$, 'fleet_requests: signed-in non-staff conversation list is empty');
select is_empty($$select role from public.fleet_goals where status in ('active', 'paused')$$, 'fleet_goals: signed-in non-staff goal list is empty');
select is_empty($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, 'fleet_request_slack_threads: signed-in non-staff reads no thread');
select throws_ok($$select public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS refused', 'RLS refused body', null)$$, '42501', 'fleet_owner_request: not permitted', 'fleet_owner_request: signed-in non-staff refused');
select throws_ok($$select public.fleet_answer_request('00000000-0000-4000-8000-00000000c581', 'answered', 'x')$$, '42501', 'fleet_answer_request: not permitted', 'fleet_answer_request: signed-in non-staff refused');
select throws_ok($$select public.fleet_goal_create('rls', 'RLS refused', 'RLS refused body')$$, '42501', 'fleet_goal_create: not permitted', 'fleet_goal_create: signed-in non-staff refused');
select throws_ok($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c591', null)$$, '42501', 'fleet_goal_pause: not permitted', 'fleet_goal_pause: signed-in non-staff refused');
select throws_ok($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c592', null)$$, '42501', 'fleet_goal_resume: not permitted', 'fleet_goal_resume: signed-in non-staff refused');
select throws_ok($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c591', 'RLS refused')$$, '42501', 'fleet_goal_abandon: not permitted', 'fleet_goal_abandon: signed-in non-staff refused');
set local role anon;
select throws_ok($$select id from public.fleet_requests limit 1$$, '42501', 'permission denied for table fleet_requests', 'fleet_requests: anon refused (no grant)');
select throws_ok($$select public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS refused', 'RLS refused body', null)$$, '42501', 'permission denied for function fleet_owner_request', 'fleet_owner_request: anon refused (no execute)');
select throws_ok($$select public.fleet_answer_request('00000000-0000-4000-8000-00000000c581', 'answered', 'x')$$, '42501', 'permission denied for function fleet_answer_request', 'fleet_answer_request: anon refused (no execute)');
select throws_ok($$select public.fleet_goal_create('rls', 'RLS refused', 'RLS refused body')$$, '42501', 'permission denied for function fleet_goal_create', 'fleet_goal_create: anon refused (no execute)');
select throws_ok($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c591', null)$$, '42501', 'permission denied for function fleet_goal_pause', 'fleet_goal_pause: anon refused (no execute)');
select throws_ok($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c592', null)$$, '42501', 'permission denied for function fleet_goal_resume', 'fleet_goal_resume: anon refused (no execute)');
select throws_ok($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c591', 'RLS refused')$$, '42501', 'permission denied for function fleet_goal_abandon', 'fleet_goal_abandon: anon refused (no execute)');
reset role;
select results_eq(
  $$select (select status from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c581') || '/'
        || (select status from public.fleet_goals where id = '00000000-0000-4000-8000-00000000c591') || '/'
        || (select status from public.fleet_goals where id = '00000000-0000-4000-8000-00000000c592') || '/'
        || (select count(*) from public.fleet_requests where title = 'RLS refused')::text || '/'
        || (select count(*) from public.fleet_goals where title = 'RLS refused')::text$$,
  array['pending/active/paused/0/0'],
  'fleet: requests and goals are intact after the refusals, and nothing was created'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d501';
select results_eq($$select id::text from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c581'$$, array['00000000-0000-4000-8000-00000000c581'], 'fleet_requests: owner reads the request');
select results_eq($$select title from public.fleet_goals where id = '00000000-0000-4000-8000-00000000c591'$$, array['RLS goal active'], 'fleet_goals: owner reads the goal');
select results_eq($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, array['1700000000.000200'], 'fleet_request_slack_threads: owner reads the thread');
select results_eq($$select (public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS by owner', 'RLS body by owner', null)).title$$, array['RLS by owner'], 'fleet_owner_request: owner files a request');
select is((select public.fleet_answer_request('00000000-0000-4000-8000-00000000c583', 'answered', 'RLS answer'))::text, '', 'fleet_answer_request: owner answers');
select results_eq($$select status from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c583'$$, array['answered'], 'fleet_answer_request: the owner''s answer is recorded');
select results_eq($$select (public.fleet_goal_create('rls', 'RLS goal by owner', 'RLS goal body by owner')).title$$, array['RLS goal by owner'], 'fleet_goal_create: owner creates a goal');
select results_eq($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c593', null)$$, array['paused'], 'fleet_goal_pause: owner pauses');
select results_eq($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c593', null)$$, array['resumed'], 'fleet_goal_resume: owner resumes');
select results_eq($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c593', 'RLS abandon')$$, array['abandoned'], 'fleet_goal_abandon: owner abandons');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d502';
select results_eq($$select id::text from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c581'$$, array['00000000-0000-4000-8000-00000000c581'], 'fleet_requests: ops_engineer reads the request');
select results_eq($$select title from public.fleet_goals where id = '00000000-0000-4000-8000-00000000c591'$$, array['RLS goal active'], 'fleet_goals: ops_engineer reads the goal');
select results_eq($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, array['1700000000.000200'], 'fleet_request_slack_threads: ops_engineer reads the thread');
select results_eq($$select (public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS by ops', 'RLS body by ops', null)).title$$, array['RLS by ops'], 'fleet_owner_request: ops_engineer files a request');
select is((select public.fleet_answer_request('00000000-0000-4000-8000-00000000c584', 'answered', 'RLS answer'))::text, '', 'fleet_answer_request: ops_engineer answers');
select results_eq($$select status from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c584'$$, array['answered'], 'fleet_answer_request: the ops_engineer answer is recorded');
select results_eq($$select (public.fleet_goal_create('rls', 'RLS goal by ops', 'RLS goal body by ops')).title$$, array['RLS goal by ops'], 'fleet_goal_create: ops_engineer creates a goal');
select results_eq($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c594', null)$$, array['paused'], 'fleet_goal_pause: ops_engineer pauses');
select results_eq($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c594', null)$$, array['resumed'], 'fleet_goal_resume: ops_engineer resumes');
select results_eq($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c594', 'RLS abandon')$$, array['abandoned'], 'fleet_goal_abandon: ops_engineer abandons');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d506';
select results_eq($$select id::text from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c581'$$, array['00000000-0000-4000-8000-00000000c581'], 'fleet_requests: holder of only manage_settings reads the request');
select results_eq($$select title from public.fleet_goals where id = '00000000-0000-4000-8000-00000000c591'$$, array['RLS goal active'], 'fleet_goals: holder of only manage_settings reads the goal');
select results_eq($$select thread_ts from public.fleet_request_slack_threads where request_id = '00000000-0000-4000-8000-00000000c581'$$, array['1700000000.000200'], 'fleet_request_slack_threads: holder of only manage_settings reads the thread');
select results_eq($$select (public.fleet_owner_request('rls', 'fyi', 0::smallint, 'RLS by settings', 'RLS body by settings', null)).title$$, array['RLS by settings'], 'fleet_owner_request: holder of only manage_settings files a request');
select is((select public.fleet_answer_request('00000000-0000-4000-8000-00000000c585', 'answered', 'RLS answer'))::text, '', 'fleet_answer_request: holder of only manage_settings answers');
select results_eq($$select status from public.fleet_requests where id = '00000000-0000-4000-8000-00000000c585'$$, array['answered'], 'fleet_answer_request: the manage_settings holder''s answer is recorded');
select results_eq($$select (public.fleet_goal_create('rls', 'RLS goal by settings', 'RLS goal body by settings')).title$$, array['RLS goal by settings'], 'fleet_goal_create: holder of only manage_settings creates a goal');
select results_eq($$select public.fleet_goal_pause('00000000-0000-4000-8000-00000000c595', null)$$, array['paused'], 'fleet_goal_pause: holder of only manage_settings pauses');
select results_eq($$select public.fleet_goal_resume('00000000-0000-4000-8000-00000000c595', null)$$, array['resumed'], 'fleet_goal_resume: holder of only manage_settings resumes');
select results_eq($$select public.fleet_goal_abandon('00000000-0000-4000-8000-00000000c595', 'RLS abandon')$$, array['abandoned'], 'fleet_goal_abandon: holder of only manage_settings abandons');

select * from finish();
rollback;
