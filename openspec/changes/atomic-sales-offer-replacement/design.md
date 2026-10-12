# Design

Reuse current release_coupon_assignment and bind_coupon_assignment inside the same database transaction. Acquire locks in campaign -> current pricing -> old assignment order, then reread binding and fail if it moved. Lock offer and source prices while verifying server-computed options. Refuse locked terms, pending/review/succeeded package payment, invalid/expired/consumed assignments, a worse shared package price, no improvement, and loss of the current campaign package. Copy existing user_id/claimed_at. Keep unique one-per-call/one-active-per-phone constraints.

Any exception aborts all writes, including assignment history and intermediate price changes. The TypeScript branch never compensates with delete/reset/void. A lost RPC response is resolved by a durable active assignment read; a failed reread returns no offer, not a cached promise. All identifiers and prices come from server code behind the existing token guard. RPC grants exclude public/anon/authenticated.

Local tests cover statement rollback and the current bind/release constraints. Full DB concurrency with existing RPCs needs staging proof; no two-connection proof is claimed. Migration precedes server deployment. No provider config update is needed.
