-- Persist the counting contract in the database itself, where the next DBA
-- will look for it (and the totals consumers can rediscover it).
comment on function public.guest_totals(uuid) is
  'People-level guest totals for one event. Counts PEOPLE, not rows; party size includes the guest (submit_rsvp enforces attending >= 1). attending_people per row: valid WhatsApp headcount (1-10) -> web adults+kids (>0) -> expected_count (>0) -> 1. Quantities clamped non-negative; always returns exactly one row. SECURITY INVOKER - RLS scopes access.';
