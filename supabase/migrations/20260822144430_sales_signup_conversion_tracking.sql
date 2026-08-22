-- Sales-closing agent conversion tracking (owner decision 2026-08-22):
-- "signup completed" for tracking purposes means the resulting user signed
-- a campaign agreement (picked a package + went through OTP/signature) —
-- NOT bare account creation. Two additive columns, no FK on
-- profiles.sales_referral_attempt_id on purpose: Supabase's own
-- troubleshooting docs (fetched live 2026-08-22, "Database error saving new
-- user") confirm a trigger/constraint failure on auth.users insert breaks
-- signup entirely — a stale or malformed ref must never be able to do that.
-- The Server Action (src/app/auth/actions.ts) validates the ref exists
-- BEFORE passing it through; handle_new_user() below is a second,
-- independent safety net that swallows a malformed UUID rather than
-- throwing, but relies on no FK to stay unbreakable even if a referenced
-- sales_call_attempts row is later deleted.

alter table public.profiles
  add column if not exists sales_referral_attempt_id uuid;

alter table public.sales_call_attempts
  add column if not exists signup_completed_at timestamptz;

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

  INSERT INTO public.profiles (id, full_name, phone, sales_referral_attempt_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    ref_uuid
  );
  RETURN NEW;
end;
$function$;
