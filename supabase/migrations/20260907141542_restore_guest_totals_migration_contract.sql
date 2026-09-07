-- Restore guest_totals to its migration-file contract (20260706135941 v3).
--
-- WHAT DRIFTED. The LIVE body of guest_totals — and only it — carried an extra
-- row filter on attending_people:
--
--     filter (where g.status = 'attending' and g.headcount_answered_at is not null)
--
-- No migration ever introduced it: it appears nowhere in supabase/migrations/
-- and nowhere in git history (git log --all -S), its transaction (xmin 390585)
-- matches no schema_migrations row, and the function's own COMMENT still
-- describes the unfiltered contract. It was applied directly to the live DB
-- around 2026-07-08, out of band.
--
-- WHAT IT BROKE. headcount_answered_at is stamped only by the web form's
-- Server Action and by the WhatsApp numeric-headcount reply — never by the
-- shared submitRsvp() path, so never by the voice agent (and not by a
-- button-only WhatsApp RSVP). Every RSVP saved through those channels was
-- excluded from all people-level counters: at fix time, 10 of 24 attending
-- rows (3 events) were invisible, and one event showed 17 attending people
-- instead of 25. Row-level counters (attending_rows etc.) were never filtered,
-- which is exactly the 50%-rows / 0%-people contradiction seen in the UI.
--
-- WHY REMOVING THE FILTER IS SAFE. guest_effective_attending already returns
-- 0 for a non-attending row, so the unfiltered sum IS the documented contract
-- (WhatsApp headcount 1-10 -> web adults+kids -> expected_count -> 1). The
-- WhatsApp headcount flow has zero dependency on guest_totals (its only
-- callers are display code), so this is purely additive.
--
-- WHAT NOT TO DO INSTEAD (both provably break the WhatsApp flow via
-- src/lib/data/headcount.ts: "already answered -> never ask"):
--   * do NOT make submit_rsvp stamp headcount_answered_at;
--   * do NOT backfill headcount_answered_at onto existing rows.
-- No data backfill is needed at all — the fix is aggregation-only.
--
-- Body below is verbatim from 20260706135941_over_invited_business_flag.sql.
-- The COMMENT and grants already match live and are not restated.
create or replace function public.guest_totals(_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rows',             count(*),
    'invited_people',   coalesce(sum(greatest(coalesce(g.expected_count, 1), 1)), 0),
    'attending_rows',   count(*) filter (where g.status = 'attending'),
    'attending_people', coalesce(sum(public.guest_effective_attending(g)), 0),
    'declined_rows',    count(*) filter (where g.status = 'declined'),
    'maybe_rows',       count(*) filter (where g.status = 'maybe'),
    'pending_rows',     count(*) filter (where g.status = 'pending'),
    'over_invited_rows',   count(*) filter (where public.over_invited(g)),
    'over_invited_people', coalesce(sum(
        case when public.over_invited(g)
             then public.guest_effective_attending(g) - g.expected_count
             else 0 end), 0)
  )
  from public.guests g
  where g.event_id = _event_id;
$$;
