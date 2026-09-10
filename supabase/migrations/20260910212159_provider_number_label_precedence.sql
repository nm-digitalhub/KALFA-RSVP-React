-- A sync must not RENAME a line an admin already named.
--
-- WHAT WENT WRONG, measured on the live table 2026-09-11 after the first real sync:
--
--   provider_ref 1018741517998430
--   display_label  'מספר אישורי הגעה (RSVP)'  →  'Kalfa Event'
--
-- The function used `coalesce(p_display_label, display_label)`, and the comment
-- beside it claimed "a label an admin typed survives every future sync". It does
-- not. coalesce prefers its FIRST non-null argument, so that expression keeps the
-- stored label only when the incoming one is null — it prevents a sync from BLANKING
-- a label, which is a different guarantee from preventing it from OVERWRITING one.
-- syncMetaNumbers sends Meta's `verified_name`, which is never null here, so every
-- sync renamed the row. The Voximplant branch has the same defect and only escaped it
-- because `phone_name` is null on that account today.
--
-- The precedence is now the other way round in all three branches: the STORED label
-- wins, and a provider name fills the slot only while it is empty. That is what the
-- column means — `display_label` is what WE call this line, and the provider's own
-- name already lives in `snapshot.verified_name` where a sync may keep refreshing it.
--
-- The consequence, stated plainly rather than discovered later: once a label exists,
-- no sync will ever change it. A number renamed at the provider keeps our name until
-- someone edits it here. That is the correct trade for a field an admin authors, and
-- the provider's current name stays visible in the snapshot beside it.

create or replace function public.upsert_provider_number(
  p_provider       public.provider_key,
  p_provider_ref   text default null,
  p_e164           text default null,
  p_display_label  text default null,
  p_is_active      boolean default true,
  p_snapshot       jsonb default null,
  p_source         text default 'admin'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Mirrors provider_numbers_ref_or_e164. Raised here so the caller gets a clear
  -- message rather than a constraint name.
  if p_provider_ref is null and p_e164 is null then
    raise exception 'provider_ref or e164 is required'
      using errcode = '22023';
  end if;

  if p_provider_ref is not null then
    -- Adopt a ref-less row for the same line before considering an insert. Runs
    -- first because ON CONFLICT would otherwise insert a duplicate: the partial
    -- index does not see the NULL-ref row, so there is no conflict to resolve.
    if p_e164 is not null then
      update public.provider_numbers
         set provider_ref  = p_provider_ref,
             e164          = p_e164,
             display_label = coalesce(display_label, p_display_label),
             is_active     = p_is_active,
             snapshot      = coalesce(p_snapshot, snapshot),
             snapshot_at   = case when p_snapshot is not null then now() else snapshot_at end,
             updated_at    = now()
       where provider = p_provider
         and provider_ref is null
         and e164 = p_e164
      returning id into v_id;

      if v_id is not null then
        return v_id;
      end if;
    end if;

    insert into public.provider_numbers as n
      (provider, provider_ref, e164, display_label, is_active, snapshot, snapshot_at, source)
    values
      (p_provider, p_provider_ref, p_e164, p_display_label, p_is_active, p_snapshot,
       case when p_snapshot is not null then now() else null end, p_source)
    on conflict (provider, provider_ref) where provider_ref is not null
    do update set
      -- A sync must not blank a label an admin typed, so every nullable field
      -- coalesces to what is already stored. `is_active` is not nullable and is
      -- therefore always the caller's word.
      e164          = coalesce(excluded.e164, n.e164),
      display_label = coalesce(n.display_label, excluded.display_label),
      is_active     = excluded.is_active,
      snapshot      = coalesce(excluded.snapshot, n.snapshot),
      snapshot_at   = case when excluded.snapshot is not null then now() else n.snapshot_at end,
      updated_at    = now()
    returning n.id into v_id;

    return v_id;
  end if;

  -- No provider_ref: the line is identified by its number alone. There is no unique
  -- index for (provider, e164) — deliberately, because two providers legitimately
  -- carry the same E.164 (the company line is both `company` and `extra_sms`) — so
  -- the match is explicit rather than an ON CONFLICT target.
  update public.provider_numbers
     set display_label = coalesce(display_label, p_display_label),
         is_active     = p_is_active,
         snapshot      = coalesce(p_snapshot, snapshot),
         snapshot_at   = case when p_snapshot is not null then now() else snapshot_at end,
         updated_at    = now()
   where provider = p_provider
     and e164 = p_e164
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.provider_numbers
    (provider, provider_ref, e164, display_label, is_active, snapshot, snapshot_at, source)
  values
    (p_provider, null, p_e164, p_display_label, p_is_active, p_snapshot,
     case when p_snapshot is not null then now() else null end, p_source)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.upsert_provider_number(
  public.provider_key, text, text, text, boolean, jsonb, text
) from public;

grant execute on function public.upsert_provider_number(
  public.provider_key, text, text, text, boolean, jsonb, text
) to authenticated;

comment on function public.upsert_provider_number(
  public.provider_key, text, text, text, boolean, jsonb, text
) is
  'Insert or update one provider number. Exists because ON CONFLICT cannot use the '
  'partial unique index through PostgREST, and because a sync carrying a provider_ref '
  'must ADOPT the backfill row for the same E.164 rather than duplicate the line and '
  'strand its roles. SECURITY INVOKER — provider_numbers RLS still applies.';

-- Repair the one row the defect damaged. Guarded on the exact wrong value so this is
-- a no-op if it was already corrected by hand, and so it cannot touch a label someone
-- deliberately set to something else later.
update public.provider_numbers
   set display_label = 'מספר אישורי הגעה (RSVP)',
       updated_at    = now()
 where provider      = 'meta_whatsapp'
   and provider_ref  = '1018741517998430'
   and display_label = 'Kalfa Event';
