-- One entry point for writing a provider number, because PostgREST cannot express
-- the upsert this table actually needs.
--
-- WHY THIS FUNCTION EXISTS AT ALL. The plan (Task 1.2 Step 3) specified
-- `.upsert(..., { onConflict: 'provider,provider_ref' })`. That emits
-- `ON CONFLICT (provider, provider_ref)`, and the matching index is PARTIAL:
--
--   CREATE UNIQUE INDEX provider_numbers_provider_ref_uq
--     ON provider_numbers (provider, provider_ref) WHERE provider_ref IS NOT NULL
--
-- Postgres only uses a partial index for ON CONFLICT when the statement repeats the
-- index predicate, and PostgREST has no way to send a WHERE clause with an upsert.
-- MEASURED 2026-09-10 in a rolled-back transaction against the live database:
--
--   ON CONFLICT (provider, provider_ref)                              → 42P10
--   ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL → SUCCEEDED
--
-- Same error class as the UNION cast that the first migration hit during its own dry
-- run. Discovering it from the admin panel instead would have meant "add a number"
-- failing in production with a message no field could carry.
--
-- IT ALSO OWNS THE MERGE RULE, WHICH IS THE HARDER HALF. The backfill wrote the
-- Voximplant row with `provider_ref = NULL` (app_settings stored a caller id, not a
-- Voximplant phone id) and hung FIVE roles off it. The first sync from Voximplant
-- arrives with a real provider_ref for the same E.164. A plain insert would create a
-- SECOND row for one phone line, the roles would stay on the orphan, and
-- resolveNumberForRole would keep answering from a row no sync ever touches again —
-- silently, forever. So a sync that carries a provider_ref ADOPTS the ref-less row
-- for the same (provider, e164) instead of inserting beside it. Roles are attached
-- to the id, so adopting keeps every one of them.
--
-- SECURITY INVOKER on purpose: provider_numbers has RLS (`is_platform_staff()` in
-- both USING and WITH CHECK), and the caller must remain the subject of that check.
-- A SECURITY DEFINER wrapper here would hand every caller of this function a way
-- past the table's own policy, which is the trap the Supabase skill's checklist
-- describes. EXECUTE is revoked from PUBLIC and granted only to `authenticated` —
-- Postgres grants EXECUTE to PUBLIC by default, and revoking from `anon` alone
-- leaves PUBLIC holding it.

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
             display_label = coalesce(p_display_label, display_label),
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
      display_label = coalesce(excluded.display_label, n.display_label),
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
     set display_label = coalesce(p_display_label, display_label),
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
