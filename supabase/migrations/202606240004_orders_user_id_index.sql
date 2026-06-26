-- Index the per-user filter column on orders.
-- orders_owner_select (USING user_id = auth.uid()) and listOrders()/getOrder()
-- all filter by user_id. Matches the project convention — events.owner_id
-- (idx_events_owner) and guests.event_id (idx_guests_event) are indexed; orders
-- was the gap. Supabase RLS guidance: always index columns used in RLS policies.
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders (user_id);
