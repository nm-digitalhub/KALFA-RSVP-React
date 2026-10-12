# Atomic sales offer replacement

## Why
The current D23 application code releases and voids an existing benefit before storing its replacement. A later write failure can leave no usable benefit. Separate re-binding also leaves a price/assignment split.

## What Changes
Add one service-role-only database function for the existing cross-call replacement branch. Validate and lock live state, release/void/create/options/history/re-bind in one transaction. The server invokes one RPC and rereads durable state on success and uncertain failure. Preserve the existing source uniqueness and account claim.

## Non-goals
No new package/table/column, first-assignment refactor, offers editing refactor, objection category change, same-call escalation, provider tool/config changes, or live deployment.
