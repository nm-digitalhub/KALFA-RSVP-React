-- Remove the seven contact_op_status values nothing ever writes.
--
-- WHY
--   Owner-approved status cleanup, 02.11.2026: delete dead states before building flow tracking. contacts.op_status
--   is written only through setContactOpStatus (src/lib/data/interactions.ts) and the column default. The values the
--   code writes are pending_contact (default), whatsapp_sent, pending_call, call_dialed, no_answer,
--   human_interaction_call, wrong_number and reached_billed. No database function writes op_status (pg_proc searched
--   on the linked project 02.11.2026). The other seven — not_eligible, whatsapp_delivered, whatsapp_read,
--   whatsapp_responded, voicemail, removal_requested, not_reached — were never written; no contact holds one (read on
--   the linked project 02.11.2026).
--
-- WHAT IT DOES
--   Postgres cannot drop an enum value, so the type is rebuilt: the old type is renamed, the new one is created with the
--   eight live values in their original order, contacts.op_status is converted (the USING cast fails, and the whole file
--   rolls back, if any row still held a removed value), its default is restored, and the old type is dropped.
--   contacts.op_status is the only object that depends on the type: no function argument or result, view, index or
--   policy references it (pg_attribute / pg_proc / pg_views / pg_indexes / pg_policies on the linked project
--   02.11.2026). The type and the column carry no comment.
--
-- DEPLOY ORDER — push AFTER the application code of the same change is deployed (web app and worker, `npm run deploy`).
--   That code no longer reads the removed values (the campaign "voicemail" counter and the guest list's hidden-state
--   entry are gone). Its label maps still list all fifteen values because they are typed against types.generated.ts,
--   which only changes after this push: after `npm run gen:types`, `tsc` flags the seven stale label keys and they are
--   removed in a follow-up edit.

alter type public.contact_op_status rename to contact_op_status_old;

create type public.contact_op_status as enum (
  'pending_contact',
  'whatsapp_sent',
  'pending_call',
  'call_dialed',
  'no_answer',
  'human_interaction_call',
  'wrong_number',
  'reached_billed'
);

alter table public.contacts alter column op_status drop default;
alter table public.contacts
  alter column op_status type public.contact_op_status using op_status::text::public.contact_op_status;
alter table public.contacts alter column op_status set default 'pending_contact'::public.contact_op_status;

drop type public.contact_op_status_old;

-- Verify the end state.
do $verify$
declare
  v_labels text;
begin
  select string_agg(enumlabel, ',' order by enumsortorder) into v_labels
    from pg_enum where enumtypid = 'public.contact_op_status'::regtype;
  if v_labels is distinct from
       'pending_contact,whatsapp_sent,pending_call,call_dialed,no_answer,human_interaction_call,wrong_number,reached_billed' then
    raise exception 'contact_op_status has unexpected values: %', v_labels;
  end if;

  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typname = 'contact_op_status_old') then
    raise exception 'contact_op_status_old still exists';
  end if;

  if (select atttypid from pg_attribute
      where attrelid = 'public.contacts'::regclass and attname = 'op_status')
     is distinct from 'public.contact_op_status'::regtype then
    raise exception 'contacts.op_status is not of type contact_op_status';
  end if;

  if (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.contacts'::regclass and a.attname = 'op_status')
     is distinct from '''pending_contact''::contact_op_status' then
    raise exception 'contacts.op_status default was not restored';
  end if;
end;
$verify$;
