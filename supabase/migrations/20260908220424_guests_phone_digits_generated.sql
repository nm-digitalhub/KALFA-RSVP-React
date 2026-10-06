-- guests.phone_digits — a STORED GENERATED column holding only the digits of
-- guests.phone, so the guest search can match a number regardless of how either
-- side wrote it.
--
-- THE PROBLEM. guests.phone deliberately keeps what the owner typed, because
-- that is what they expect to see back. Once international guests became
-- storable (2026-09-09), the same number legitimately appears as
-- "+33756982370", "+33 7 56 98 23 70" or "0033756982370". Search uses ILIKE,
-- which compares the stored characters as they are — so a guest saved WITH
-- separators could not be found by a search typed WITHOUT them, and vice versa.
-- Deriving more search terms in the application (phoneSearchVariants,
-- src/lib/phone.ts) fixes the search side only; nothing there can normalise the
-- COLUMN.
--
-- WHY A GENERATED COLUMN. It is the pattern Supabase documents for exactly this
-- shape of problem: keep the human value, persist a derived one beside it,
-- let Postgres maintain it. No trigger to keep in sync, no application code that
-- can forget, no backfill that can drift — it is recomputed by the database on
-- every insert and update, including rows written by the worker, by imports,
-- and by direct SQL. `stored` (not virtual) because it is indexed and read far
-- more often than written.
--
-- The display column is untouched. Nothing about what an owner sees changes.
--
-- ONE-WAY BY DESIGN: digits only, so it can never be mistaken for a dialable
-- number. E.164 for actual sending already lives on contacts.normalized_phone.
alter table public.guests
  add column if not exists phone_digits text
  generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored;

comment on column public.guests.phone_digits is
  'Digits of guests.phone, maintained by Postgres (stored generated). Exists so the guest search matches a number whatever separators either side used; guests.phone keeps the owner''s own formatting. Never dial or send from this column — use contacts.normalized_phone (E.164).';

-- NO INDEX, on purpose. The search is a CONTAINS match ("*digits*"), which a
-- btree cannot serve; the right index for that is a pg_trgm GIN one. But
-- pg_trgm is NOT installed on this project (verified 2026-09-09 against
-- pg_extension) and the whole table holds 47 rows, 44 of them with a phone.
-- Installing an extension and adding a GIN index to accelerate a scan of 47
-- rows would cost more to review and maintain than it can ever save. Revisit
-- when guest volume makes the scan measurable — the column is ready for it.

-- ROLLBACK:
--   alter table public.guests drop column if exists phone_digits;
-- Dropping restores the exact pre-migration behaviour: the search falls back to
-- matching guests.phone directly, which is what it did before.
