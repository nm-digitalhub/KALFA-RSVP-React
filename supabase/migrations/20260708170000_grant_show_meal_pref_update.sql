-- events.show_meal_pref was added after the Phase-3 column-scoped UPDATE model.
-- updateEvent writes this column from the owner UI, so authenticated must receive
-- UPDATE on this single column only. Do not restore table-wide UPDATE.
grant update (show_meal_pref) on public.events to authenticated;
