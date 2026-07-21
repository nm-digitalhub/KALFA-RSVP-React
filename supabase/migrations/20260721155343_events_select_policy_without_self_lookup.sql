-- events_org_select: evaluate the ROW, not a re-query of the same table.
--
-- THE BUG (P0, reproduced live 2026-07-21): creating an event failed for every
-- user with "יצירת האירוע נכשלה. נסו שוב." The underlying error was
--
--   42501: new row violates row-level security policy for table "events"
--
-- but the INSERT policy was never the problem. Isolated by probe:
--
--   INSERT ... (no RETURNING)  -> succeeds
--   INSERT ... RETURNING id    -> 42501
--
-- createEvent (src/lib/data/events.ts) does `.insert(...).select(...).single()`,
-- which PostgREST issues as INSERT ... RETURNING. RETURNING makes Postgres apply
-- the SELECT policy to the new row, and that policy was
--
--   using ( can_access_event(id, 'events', 'view') )
--
-- can_access_event is STABLE and looks the row up INSIDE public.events:
--
--   select exists (select 1 from public.events e where e.id = _event_id and ...)
--
-- A STABLE function sees the snapshot taken at the start of the statement — the
-- statement that is inserting the row. The row is not in that snapshot, exists()
-- returns false, and the read-back is refused. Confirmed from the other side: in
-- a LATER statement of the same transaction the identical call returns true.
--
-- So the policy was self-referential — it asked the table whether a row it had
-- not yet been told about exists. No user could create an event through the app
-- at all.
--
-- THE FIX. A row-level policy already has the row's columns in scope; looking
-- the row up by id to read columns it was handed is both wrong here and a
-- needless self-join on every row read. Inline the same predicate.
--
-- EQUIVALENCE. The expression below is textually the function's own body with
-- _resource='events' and _action='view' substituted, so this is a structural
-- identity, not a guess. Verified empirically as well, evaluated as postgres so
-- RLS could not hide rows from the comparison: for every (user, event) pair in
-- the database, can_access_event(...) and the inlined expression disagreed on 0
-- rows.
--
-- SCOPE. Only this policy changes.
--   * can_access_event() itself is left alone — other tables' policies use it,
--     and for them it is not self-referential.
--   * events_org_update is deliberately NOT touched. Its WITH CHECK has the same
--     stale-snapshot property, but org_id and owner_id are not in the
--     column-level UPDATE grant to `authenticated` (15 columns, verified), so a
--     user cannot move an event to another org or owner in the first place. The
--     column grant, not the policy, is the boundary there.
drop policy if exists events_org_select on public.events;

create policy events_org_select on public.events
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      org_id is not null
      and public.has_org_permission(org_id, 'events', 'view')
    )
  );
