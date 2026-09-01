-- Mandatory terms-of-service consent at signup. terms_accepted_at is set
-- ONLY when the signup form's own metadata flag is present (see
-- src/app/auth/actions.ts / signupSchema) — NOT unconditionally on every
-- insert. This trigger also fires for supabase.auth.admin.createUser()
-- (e.g. a future admin-created account), which does not pass user_metadata
-- automatically (verified against Supabase's own managing-user-data docs),
-- so an unconditional now() would falsely record consent that was never
-- given. Existing rows keep terms_accepted_at = null (they predate this).

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ref_text text;
  ref_uuid uuid;
begin
  ref_text := NEW.raw_user_meta_data->>'sales_referral_attempt_id';
  if ref_text is not null and ref_text <> '' then
    begin
      ref_uuid := ref_text::uuid;
    exception when others then
      ref_uuid := null;
    end;
  end if;

  INSERT INTO public.profiles (id, full_name, phone, sales_referral_attempt_id, terms_accepted_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    ref_uuid,
    case when NEW.raw_user_meta_data->>'terms_accepted' is not null then now() else null end
  );
  RETURN NEW;
end;
$function$;
