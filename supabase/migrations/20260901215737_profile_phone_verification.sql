-- Phone-number ownership proof on the profile.
--
-- Until now profiles.phone was free text nobody checked. whatsapp-import.ts
-- matches an inbound sender against it and its own comment calls that owner
-- "VERIFIED" — which was never true. Two numbers are already duplicated across
-- the 8 rows, and resolveOwnerActiveEvents picks with .find(), i.e. whichever
-- row Postgres returned first. That is the same misrouting class incident
-- 2026-07-06 fixed once already (a brit guest list landing on a wedding).
--
-- TWO columns rather than one flag, deliberately:
--
--   phone_verified_e164  the exact E.164 the OTP proved, normalized by the
--                        SERVER (src/lib/phone.ts). There is no SQL normalizer
--                        and adding one would fork the rules — the app already
--                        owns them, so the app writes the canonical value.
--
--   phone_verified_at    when it was proved.
--
-- "Is the CURRENT phone verified?" is then a comparison, not a flag:
-- normalizePhone(phone) === phone_verified_e164. Editing `phone` therefore
-- un-verifies it by construction — no trigger to write, and no way to forget
-- to clear a flag. Same discipline the signing form already uses in the
-- client (verifyState.code === otpCode), applied to storage.

alter table public.profiles
  add column if not exists phone_verified_e164 text,
  add column if not exists phone_verified_at   timestamptz;

comment on column public.profiles.phone_verified_e164 is
  'E.164 number proved by OTP (server-normalized). Compare against normalizePhone(phone) — a mismatch means the current phone is NOT verified.';
comment on column public.profiles.phone_verified_at is
  'When phone_verified_e164 was proved.';

-- One person per verified number. PARTIAL on purpose: the unverified
-- duplicates that already exist stay untouched and the migration applies
-- cleanly; only a second VERIFICATION of the same number is refused.
create unique index if not exists profiles_phone_verified_e164_key
  on public.profiles (phone_verified_e164)
  where phone_verified_e164 is not null;

-- The lookup whatsapp-import.ts should be doing instead of loading every
-- profile into memory and scanning it in JS.
create index if not exists profiles_phone_verified_lookup
  on public.profiles (phone_verified_e164)
  where phone_verified_at is not null;
