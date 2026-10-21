-- Local-only reconstruction using the production catalog inspected 2026-10-21.
-- Apply ONLY to local Supabase. No SQL changes in the production project.
-- Excludes platform-managed extensions and unproven cosmetic CHECK differences.

-- Startup guards: both trigger functions are already supplied by earlier migrations.
do $$
begin
  if to_regprocedure('public.handle_new_user()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing prerequisite trigger function';
  end if;
end $$;

-- Profile bootstrap: same trigger definition as production.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'
  ) then
    execute 'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()';
  end if;
end $$;

-- updated_at triggers (do not replace/redefine the functions).
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'trg_events_updated') then
    execute 'create trigger trg_events_updated before update on public.events for each row execute function public.set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_profiles_updated') then
    execute 'create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at()';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.campaigns'::regclass and tgname = 'trg_campaigns_updated') then
    execute 'create trigger trg_campaigns_updated before update on public.campaigns for each row execute function public.set_updated_at()';
  end if;
end $$;

-- UNIQUE constraints and CHECKs, using the production definitions.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.guests'::regclass and conname = 'guests_rsvp_token_key') then
    alter table public.guests add constraint guests_rsvp_token_key unique (rsvp_token);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.guests'::regclass and conname = 'guests_confirmed_headcount_range') then
    alter table public.guests add constraint guests_confirmed_headcount_range
      check (confirmed_headcount >= 0 and confirmed_headcount <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.events'::regclass and conname = 'events_gift_payment_url_https') then
    alter table public.events add constraint events_gift_payment_url_https
      check (gift_payment_url is null or gift_payment_url ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.contact_messages'::regclass and conname = 'contact_messages_source_message_key') then
    alter table public.contact_messages add constraint contact_messages_source_message_key
      unique (source, source_message_id);
  end if;
end $$;

-- Production has one full UNIQUE constraint rather than a partial unique index.
-- Drop the old index only AFTER creating or verifying the constraint.
drop index if exists public.contact_messages_source_message_uidx;

-- Reconstruct the six named production indexes. The UNIQUE constraint above
-- automatically creates its backing index guests_rsvp_token_key.
create index if not exists idx_guests_token on public.guests using btree (rsvp_token);
create index if not exists idx_guests_event on public.guests using btree (event_id);
create index if not exists idx_events_owner on public.events using btree (owner_id);
create index if not exists idx_eq_event on public.event_questions using btree (event_id);
create index if not exists idx_rsvp_event on public.rsvp_responses using btree (event_id);

-- Limit direct access; service_role and other dedicated backend roles are not revoked.
revoke all privileges on table public.inquiry_messages from public, anon, authenticated;
revoke all privileges on table public.signed_agreements from public, anon, authenticated;

-- This enum exists in production even though earlier migrations remove it.
-- Restore the production definition LOCALLY; never drop it from production.
do $$
begin
  if to_regtype('public.order_status') is null then
    create type public.order_status as enum ('pending', 'paid');
  end if;
end $$;

-- Structural postconditions: fail the migration if these are not met.
do $$
declare
  n integer;
begin
  select count(*) into n from pg_trigger t
  where not t.tgisinternal and (
    (t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created') or
    (t.tgrelid = 'public.events'::regclass and t.tgname = 'trg_events_updated') or
    (t.tgrelid = 'public.profiles'::regclass and t.tgname = 'trg_profiles_updated') or
    (t.tgrelid = 'public.campaigns'::regclass and t.tgname = 'trg_campaigns_updated')
  );
  if n <> 4 then raise exception 'Expected four custom triggers; found %', n; end if;

  select count(*) into n from pg_constraint c where
    (c.conrelid = 'public.guests'::regclass and c.conname in ('guests_rsvp_token_key','guests_confirmed_headcount_range')) or
    (c.conrelid = 'public.events'::regclass and c.conname = 'events_gift_payment_url_https') or
    (c.conrelid = 'public.contact_messages'::regclass and c.conname = 'contact_messages_source_message_key');
  if n <> 4 then raise exception 'Expected four constraints; found %', n; end if;

  select count(*) into n from pg_class i join pg_namespace ns on ns.oid=i.relnamespace
  where ns.nspname='public' and i.relkind='i' and i.relname in (
    'guests_rsvp_token_key','idx_guests_token','idx_guests_event',
    'idx_events_owner','idx_eq_event','idx_rsvp_event');
  if n <> 6 then raise exception 'Expected six production indexes; found %', n; end if;

  if not (select relrowsecurity from pg_class where oid='public.inquiry_messages'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.signed_agreements'::regclass) then
    raise exception 'Sensitive table RLS is not enabled';
  end if;

  if to_regtype('public.order_status') is null then
    raise exception 'Expected legacy production enum order_status to exist locally';
  end if;
  if (select array_agg(e.enumlabel::text order by e.enumsortorder)
      from pg_enum e where e.enumtypid = 'public.order_status'::regtype)
     is distinct from array['pending', 'paid']::text[] then
    raise exception 'Local order_status labels differ from production';
  end if;
  if to_regclass('public.contact_messages_source_message_uidx') is not null then
    raise exception 'Obsolete partial contact index still present';
  end if;
  if has_table_privilege('authenticated','public.inquiry_messages','SELECT')
     or has_table_privilege('authenticated','public.inquiry_messages','INSERT')
     or has_table_privilege('authenticated','public.inquiry_messages','UPDATE')
     or has_table_privilege('authenticated','public.inquiry_messages','DELETE')
     or has_table_privilege('authenticated','public.signed_agreements','SELECT')
     or has_table_privilege('authenticated','public.signed_agreements','INSERT')
     or has_table_privilege('authenticated','public.signed_agreements','UPDATE')
     or has_table_privilege('authenticated','public.signed_agreements','DELETE') then
    raise exception 'authenticated still has direct table privileges';
  end if;
end $$;
