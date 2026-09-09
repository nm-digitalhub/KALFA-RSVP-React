-- Trigram index for the guest phone search.
--
-- The search is a CONTAINS match — `phone_digits ILIKE '*<digits>*'` — which a
-- btree index cannot serve at all: btree can only accelerate a prefix. pg_trgm
-- is the documented answer for accelerating `ILIKE '%…%'`, and a GIN index over
-- its trigrams is the shape Supabase's own extension guide describes.
--
-- WHY NOW, at 47 rows. Not for today's data — a sequential scan of 47 rows is
-- free. For the shape of the data this table is heading into: ONE wedding is
-- 200-400 guests, and the search runs from the guest-list screen. Adding the
-- index while the table is small makes it a no-op to build; adding it later
-- means remembering to, on a table that is being read in production.
--
-- The write cost is the honest trade. A GIN index is maintained on every insert
-- and update, and the CSV / WhatsApp imports insert guests in bulk. At these
-- volumes that cost is not measurable, but it is the reason this is a separate,
-- revertible migration rather than part of the column that introduced
-- phone_digits: if imports ever slow down, this index is the first thing to
-- drop, and dropping it changes nothing but speed.
--
-- Extension placement follows the Supabase guide: extensions live in the
-- `extensions` schema, never in `public`, so the public namespace stays clean
-- and the operators remain reachable (that schema is on the default
-- search_path for the API roles).
create extension if not exists pg_trgm with schema extensions;

create index if not exists guests_phone_digits_trgm_idx
  on public.guests using gin (phone_digits extensions.gin_trgm_ops);

comment on index public.guests_phone_digits_trgm_idx is
  'Accelerates the guest phone search (phone_digits ILIKE ''%digits%''). Safe to drop — it only affects speed; the search returns the same rows without it.';

-- ROLLBACK (in this order):
--   drop index if exists public.guests_phone_digits_trgm_idx;
--   -- leave pg_trgm installed unless nothing else uses it:
--   -- drop extension if exists pg_trgm;
