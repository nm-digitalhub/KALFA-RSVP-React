-- Dry run for supabase/migrations/20261101081450_reconcile_admit_by_order.sql
-- OpenSpec change package-outreach-admission-safety, task 4.2.
--
-- ONE transaction, rolled back at the end: nothing it writes is kept. Run it as `postgres`, in one request:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sql/reconcile-admit-by-order-dry-run.sql
-- Each check prints "PASS n …"; the first check that fails raises an exception, which ends the transaction (nothing is
-- kept either way). The last line before the ROLLBACK is "DRY RUN OK".
--
-- It needs the migration applied (it calls admit_contacts_by_order through the two RPCs). Fixture rows are inserted with
-- triggers off (session_replication_role = replica, as fill-authorized-set.integration.test.ts does), so no owner, user or
-- lifecycle row is needed; every RPC call then runs with triggers ON and as service_role, the role the application uses.
--
-- What it checks, for a campaign with a package quota unless said otherwise:
--   1  add within the quota → 'added', one 'in' / 'add' audit row
--   2  add while an earlier guest waits and there is one seat → the waiter is admitted, the added contact gets 'quota_full'
--   3  a removal with waiters → 'removed'; the first waiter by order of addition takes the seat; audit 'out'/'delete' then
--      'in'/'delete'
--   4  an exposed member removed → 'pinned_kept'; nobody admitted
--   5  a campaign without a quota → today's behavior: an add inserts only the added contact, a removal admits nobody
--   6  a removal and a concurrent add → the earlier waiter wins. One session cannot interleave two transactions, so this
--      runs the two calls in the order the campaign row lock (FOR UPDATE) forces on them: the add waits for the removal and
--      then finds the seat taken. The two-session test is reconcile.integration.test.ts (task 4.3).
--   7  fill_authorized_set through the shared admission → admits the waiters by order of addition up to the quota
--   8  grants: service_role executes both RPCs and not admit_contacts_by_order; anon and authenticated execute none

\set ON_ERROR_STOP on
begin;

-- A check: raise when false, print PASS when true.
create function pg_temp.dr_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL %', p_label;
  end if;
  raise notice 'PASS %', p_label;
end $$;

-- A fixture: an event and an active campaign (quota p_quota, null = no quota) and p_count contacts, each with one guest.
-- guests.seq is the table's identity (unique across all events), so the guests are inserted in order and seq follows:
-- contacts[1] was added first. Returns the event, the campaign and the contact ids.
create function pg_temp.dr_fixture(p_quota integer, p_count integer)
returns table (event_id uuid, campaign_id uuid, contacts uuid[]) language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_contacts uuid[] := '{}';
  v_contact uuid;
begin
  execute 'set local session_replication_role = replica';
  insert into public.events (id, name, owner_id, event_date, status)
    values (v_event, 'dry run', gen_random_uuid(), now() + interval '30 days', 'active');
  insert into public.campaigns (id, event_id, status, max_contacts, contact_quota)
    values (v_campaign, v_event, 'active', 0, p_quota);
  for i in 1..p_count loop
    v_contact := gen_random_uuid();
    insert into public.contacts (id, event_id, normalized_phone)
      values (v_contact, v_event, '+97250' || lpad(i::text, 7, '0'));
    insert into public.guests (id, event_id, full_name, contact_id)
      values (gen_random_uuid(), v_event, 'dry run guest ' || i, v_contact);
    v_contacts := v_contacts || v_contact;
  end loop;
  execute 'set local session_replication_role = origin';
  return query select v_event, v_campaign, v_contacts;
end $$;

-- Put a contact on the list directly (setup, triggers off).
create function pg_temp.dr_member(p_event uuid, p_campaign uuid, p_contact uuid) returns void language plpgsql as $$
begin
  execute 'set local session_replication_role = replica';
  insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id) values (p_event, p_campaign, p_contact);
  execute 'set local session_replication_role = origin';
end $$;

-- Remove a contact's guests (setup, triggers off): the contact is then referenced by no live guest, as after a guest delete.
create function pg_temp.dr_drop_guests(p_contact uuid) returns void language plpgsql as $$
begin
  execute 'set local session_replication_role = replica';
  delete from public.guests where contact_id = p_contact;
  execute 'set local session_replication_role = origin';
end $$;

-- One RPC call as service_role (the application's role), back to the session user after it.
create function pg_temp.dr_reconcile(p_event uuid, p_campaign uuid, p_op text, p_contact uuid, p_prev uuid default null)
returns text language plpgsql as $$
declare v text;
begin
  execute 'set local role service_role';
  v := public.reconcile_authorized_set(p_event, p_campaign, p_op, p_contact, p_prev, 'dry_run');
  execute 'reset role';
  return v;
end $$;

create function pg_temp.dr_fill(p_event uuid, p_campaign uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role service_role';
  v := public.fill_authorized_set(p_event, p_campaign, 'dry_run');
  execute 'reset role';
  return v;
end $$;

create function pg_temp.dr_members(p_campaign uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(contact_id order by contact_id), '{}') from public.campaign_authorized_contacts where campaign_id = p_campaign
$$;

-- The audit rows in the order they were written. Every row of one transaction has the same `at` (now()), so the order is
-- the list size each row records: a removal (size n-1) comes before the admission that refills it (size n).
create function pg_temp.dr_audit(p_campaign uuid) returns text[] language sql as $$
  select coalesce(array_agg(action || '/' || reason || '/' || contact_id::text order by resulting_size, action desc), '{}')
    from public.campaign_authorized_set_audit where campaign_id = p_campaign
$$;

-- 1 ── add within the quota
do $$
declare f record; v text;
begin
  select * into f from pg_temp.dr_fixture(2, 1);
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'add', f.contacts[1]);
  perform pg_temp.dr_check(v = 'added', '1 add within the quota → added (got ' || v || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = array[f.contacts[1]], '1 the added contact is on the list');
  perform pg_temp.dr_check(pg_temp.dr_audit(f.campaign_id) = array['in/add/' || f.contacts[1]], '1 one in/add audit row');
end $$;

-- 2 ── add while an earlier guest waits, one seat
do $$
declare f record; v text;
begin
  select * into f from pg_temp.dr_fixture(1, 2); -- contacts[1] waits (seq 1), contacts[2] is the one being added (seq 2)
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'add', f.contacts[2]);
  perform pg_temp.dr_check(v = 'quota_full', '2 the added contact gets quota_full (got ' || v || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = array[f.contacts[1]], '2 the earlier waiter took the seat');
  perform pg_temp.dr_check(pg_temp.dr_audit(f.campaign_id) = array['in/add/' || f.contacts[1]], '2 its admission is audited in/add');
end $$;

-- 3 ── a removal with waiters
do $$
declare f record; v text; m uuid[];
begin
  select * into f from pg_temp.dr_fixture(1, 3); -- contacts[1] on the list; [2] and [3] wait, [2] first
  perform pg_temp.dr_member(f.event_id, f.campaign_id, f.contacts[1]);
  perform pg_temp.dr_drop_guests(f.contacts[1]);
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'delete', f.contacts[1]);
  perform pg_temp.dr_check(v = 'removed', '3 the removal answers removed (got ' || v || ')');
  m := pg_temp.dr_members(f.campaign_id);
  perform pg_temp.dr_check(m = array[f.contacts[2]], '3 the first waiter by order of addition took the freed seat');
  perform pg_temp.dr_check(
    pg_temp.dr_audit(f.campaign_id) = array['out/delete/' || f.contacts[1], 'in/delete/' || f.contacts[2]],
    '3 audit: out/delete for the removed member, then in/delete for the admitted waiter');
end $$;

-- 4 ── an exposed member removed
do $$
declare f record; v text;
begin
  select * into f from pg_temp.dr_fixture(1, 2);
  perform pg_temp.dr_member(f.event_id, f.campaign_id, f.contacts[1]);
  execute 'set local session_replication_role = replica';
  insert into public.contact_interactions (channel, direction, kind, provider_id, contact_id, event_id, campaign_id)
    values ('whatsapp', 'out', 'template', 'dry-run-' || gen_random_uuid(), f.contacts[1], f.event_id, f.campaign_id);
  execute 'set local session_replication_role = origin';
  perform pg_temp.dr_drop_guests(f.contacts[1]);
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'delete', f.contacts[1]);
  perform pg_temp.dr_check(v = 'pinned_kept', '4 an exposed member stays: pinned_kept (got ' || v || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = array[f.contacts[1]], '4 nobody was admitted in its place');
  perform pg_temp.dr_check(
    pg_temp.dr_audit(f.campaign_id) = array['kept_exposed/delete/' || f.contacts[1]], '4 one kept_exposed/delete audit row');
end $$;

-- 5 ── a campaign without a quota keeps today's behavior
do $$
declare f record; v text;
begin
  select * into f from pg_temp.dr_fixture(null, 2); -- contacts[1] is not on the list and is not admitted by an add
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'add', f.contacts[2]);
  perform pg_temp.dr_check(v = 'added', '5 no quota: add → added (got ' || v || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = array[f.contacts[2]], '5 no quota: only the added contact is inserted');
  perform pg_temp.dr_drop_guests(f.contacts[2]);
  v := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'delete', f.contacts[2]);
  perform pg_temp.dr_check(v = 'removed', '5 no quota: delete → removed (got ' || v || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = '{}', '5 no quota: a removal admits nobody');
end $$;

-- 6 ── a removal, then the add the lock made wait: the earlier waiter wins
do $$
declare f record; v_removal text; v_add text;
begin
  select * into f from pg_temp.dr_fixture(1, 3); -- [1] on the list, [2] waits, [3] is added concurrently with the removal
  perform pg_temp.dr_member(f.event_id, f.campaign_id, f.contacts[1]);
  perform pg_temp.dr_drop_guests(f.contacts[1]);
  v_removal := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'delete', f.contacts[1]);
  v_add := pg_temp.dr_reconcile(f.event_id, f.campaign_id, 'add', f.contacts[3]);
  perform pg_temp.dr_check(v_removal = 'removed' and v_add = 'quota_full',
    '6 removal → removed, the add after it → quota_full (got ' || v_removal || ', ' || v_add || ')');
  perform pg_temp.dr_check(pg_temp.dr_members(f.campaign_id) = array[f.contacts[2]], '6 the earlier waiter holds the seat');
end $$;

-- 7 ── fill_authorized_set through the shared admission
do $$
declare f record; r jsonb;
begin
  select * into f from pg_temp.dr_fixture(2, 3);
  r := pg_temp.dr_fill(f.event_id, f.campaign_id);
  perform pg_temp.dr_check(
    r = jsonb_build_object('verdict', 'filled', 'admitted', 2, 'size', 2, 'quota', 2, 'waiting', 1),
    '7 fill: admits two of three, one waits (got ' || r::text || ')');
  perform pg_temp.dr_check(
    pg_temp.dr_members(f.campaign_id) = (select array_agg(x order by x) from unnest(array[f.contacts[1], f.contacts[2]]) x),
    '7 fill: the first two by order of addition');
end $$;

-- 8 ── grants
do $$
begin
  perform pg_temp.dr_check(
    has_function_privilege('service_role', 'public.reconcile_authorized_set(uuid,uuid,text,uuid,uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.fill_authorized_set(uuid,uuid,text)', 'execute')
    and not has_function_privilege('service_role', 'public.admit_contacts_by_order(uuid,uuid,integer,integer,text,text,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.reconcile_authorized_set(uuid,uuid,text,uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.reconcile_authorized_set(uuid,uuid,text,uuid,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.fill_authorized_set(uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.fill_authorized_set(uuid,uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.admit_contacts_by_order(uuid,uuid,integer,integer,text,text,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admit_contacts_by_order(uuid,uuid,integer,integer,text,text,uuid,uuid)', 'execute'),
    '8 grants: service_role runs the two RPCs only; anon and authenticated run none');
  raise notice 'DRY RUN OK';
end $$;

rollback;
