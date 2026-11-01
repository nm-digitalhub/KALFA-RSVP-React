-- Indexes for four foreign keys that have none, and removal of a duplicate index on guests.rsvp_token.
--
-- WHY
--   The Supabase performance advisor (read 01.11.2026 on the linked project) reports, for the guest/outreach tables:
--   - unindexed_foreign_keys (lint 0001): four foreign keys with no index whose leading column is the FK column. Postgres
--     does not index a foreign key by itself, so a delete on the parent (CASCADE / SET NULL / RESTRICT check) and a lookup
--     by that column scan the whole child table:
--       campaign_authorized_contacts.contact_id  -> contacts(id)    ON DELETE CASCADE; also read by contact_id when a contact
--                                                                   is pruned (pruneOrphanContact, contacts.ts)
--       campaign_authorized_contacts.event_id    -> events(id)      ON DELETE RESTRICT; also the column of its RLS policy
--       campaign_authorized_set_audit.event_id   -> events(id)      ON DELETE RESTRICT; also the column of its RLS policy
--       guests.group_id                          -> guest_groups(id) ON DELETE SET NULL
--     The existing UNIQUE (campaign_id, contact_id) index does not serve a lookup by contact_id alone (contact_id is not
--     its leading column).
--   - idx_guests_token duplicates guests_rsvp_token_key: both are btree (rsvp_token), and the UNIQUE constraint's index
--     already serves every lookup by rsvp_token. The duplicate only costs a second index write on every guest insert and
--     token change.
--
-- WHAT IT DOES
--   1. Creates four btree indexes, named after the existing convention (<table>_<column>_idx without the _id suffix,
--      as contacts_event_idx, guests_contact_idx, campaign_authorized_contacts_campaign_idx).
--   2. Drops idx_guests_token. guests_rsvp_token_key (the UNIQUE constraint) stays.
--   3. Verifies: each of the four FK columns is the leading column of an index; idx_guests_token is gone;
--      guests_rsvp_token_key is still a unique index on (rsvp_token).
--
-- WHAT IT DOES NOT DO
--   - No table, column, constraint, policy, function or grant changes. No row is read or written.
--   - It does not drop the indexes the advisor reports as unused (guests_event_seq_idx, campaign_authorized_set_audit_
--     campaign_at_idx): they are new and serve the order-of-addition reads and the audit history; on tables this small the
--     planner scans the table instead, which is why they show as unused.
--
-- LOCKS
--   Plain CREATE INDEX (not CONCURRENTLY: it cannot run inside the migration transaction) takes a SHARE lock — reads go on,
--   writes to that table wait until the index is built. DROP INDEX takes an ACCESS EXCLUSIVE lock on guests for an instant.
--   The tables hold tens of rows (01.11.2026), so each step takes milliseconds. lock_timeout makes the push fail fast
--   instead of queueing behind a long transaction; a failed push rolls back the whole file and can simply be re-run.
--
-- house assumption (same as 20261101081450): `supabase db push` applies a migration file as ONE transaction, so the
-- verification block at the end rolls the whole file back if any check fails.
--
-- ROLLBACK (manual, if ever needed)
--   drop index if exists public.campaign_authorized_contacts_contact_idx;
--   drop index if exists public.campaign_authorized_contacts_event_idx;
--   drop index if exists public.campaign_authorized_set_audit_event_idx;
--   drop index if exists public.guests_group_idx;
--   create index if not exists idx_guests_token on public.guests using btree (rsvp_token);

set local lock_timeout = '10s';

create index if not exists campaign_authorized_contacts_contact_idx
  on public.campaign_authorized_contacts using btree (contact_id);

create index if not exists campaign_authorized_contacts_event_idx
  on public.campaign_authorized_contacts using btree (event_id);

create index if not exists campaign_authorized_set_audit_event_idx
  on public.campaign_authorized_set_audit using btree (event_id);

create index if not exists guests_group_idx
  on public.guests using btree (group_id);

drop index if exists public.idx_guests_token;

-- Verification: abort (and roll back the file) if the end state is not exactly the intended one.
do $$
declare
  v_missing text;
begin
  -- Each FK column is the leading column of some index on its table.
  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ')
    into v_missing
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.conname in (
      'campaign_authorized_contacts_contact_id_fkey',
      'campaign_authorized_contacts_event_id_fkey',
      'campaign_authorized_set_audit_event_id_fkey',
      'guests_group_id_fkey')
    and not exists (
      select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
  if v_missing is not null then
    raise exception 'foreign key column(s) still without a leading index: %', v_missing;
  end if;

  if (select count(*) from pg_constraint where conname in (
        'campaign_authorized_contacts_contact_id_fkey',
        'campaign_authorized_contacts_event_id_fkey',
        'campaign_authorized_set_audit_event_id_fkey',
        'guests_group_id_fkey')) <> 4 then
    raise exception 'expected the four foreign keys to exist';
  end if;

  if to_regclass('public.idx_guests_token') is not null then
    raise exception 'idx_guests_token was not dropped';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where ic.oid = to_regclass('public.guests_rsvp_token_key')
      and i.indrelid = 'public.guests'::regclass
      and i.indisunique
      and i.indnatts = 1
      and i.indkey[0] = (select attnum from pg_attribute
                         where attrelid = 'public.guests'::regclass and attname = 'rsvp_token')
  ) then
    raise exception 'guests_rsvp_token_key is not a unique index on guests(rsvp_token)';
  end if;
end $$;
