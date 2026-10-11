-- Drops the profiles copy of the verified phone. Supabase Auth's record is the only one.
--
-- PUSH ONLY AFTER the app code that reads auth.users instead (src/lib/auth/verified-phone.ts) is deployed. Code that
-- still selects these columns fails once they are gone: the WhatsApp owner-agent gate, its reply and report stores,
-- /admin/integrations/owner-agent, the agreement archive and /app/settings all read them before that change.
--
-- WHY: phone_verified_e164 / phone_verified_at were a copy of auth.users.phone / phone_confirmed_at, written through
-- the user's own session after a phone_change OTP. own_profile_write is FOR ALL on the user's own row and authenticated
-- holds UPDATE on every column, so the user could write the copy without any code. Measured 11.10.2026 on the live
-- project, as a signed-in user inside a block that aborted: setting phone_verified_at and phone_verified_e164 on the
-- user's own row changed 1 row. The code now reads the proved number from auth.users, which the Data API cannot write.
--
-- WHAT IT DOES: drops both columns and their two indexes. One number per account stays enforced by Auth's own
-- users_phone_key (UNIQUE on auth.users.phone, measured on the live project) — profiles_phone_verified_e164_key enforced
-- the same thing on the copy.
--
-- WHAT IT DOES NOT DO: touch profiles.phone (the display number the owner edits), any policy or grant.
--
-- ROLLBACK (the copy is fully derivable from Auth; 1 row carried it, and it matched auth.users):
--   alter table public.profiles add column phone_verified_e164 text, add column phone_verified_at timestamptz;
--   update public.profiles p set phone_verified_e164 = '+' || u.phone, phone_verified_at = u.phone_confirmed_at
--     from auth.users u where u.id = p.id and u.phone_confirmed_at is not null and u.phone is not null and u.phone <> '';
--   create unique index profiles_phone_verified_e164_key on public.profiles (phone_verified_e164)
--     where phone_verified_e164 is not null;
--   create index profiles_phone_verified_lookup on public.profiles (phone_verified_e164)
--     where phone_verified_at is not null;
--   -- and restore the code that wrote and read them.

drop index if exists public.profiles_phone_verified_lookup;
drop index if exists public.profiles_phone_verified_e164_key;

alter table public.profiles
  drop column phone_verified_e164,
  drop column phone_verified_at;
