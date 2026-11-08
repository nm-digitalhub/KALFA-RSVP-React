# One "how many are coming" count instead of adults + kids (owner 08.11.2026)

Owner: drop the adults/kids split, ask one question, lift the 10-person ceiling; the guest-facing max stays
expected_count (or 50 when the host gave none). Part of the guest-state rebuild (answer axis = attending + headcount).

## Stage 1 — EXPAND migration (written + applied LOCALLY, NOT pushed)
supabase/migrations/20261108080252_rsvp_single_headcount.sql:
- guests CHECK 0..10 -> confirmed_headcount >= 0
- rsvp_responses.headcount (nullable history)
- guest_effective_attending / over_invited: headcount >= 1 (no 1..10)
- get_rsvp_by_token returns confirmed_headcount too
- submit_rsvp(+ _headcount, all count params defaulted): _headcount given = final count
  (confirmed_headcount + headcount_answered_at, adults=n kids=0 for old readers); old shape unchanged.
  Idempotency in the new shape compares the guest row (WhatsApp answer writes no response row).
- backfill: attending with adults+kids >= 2 above confirmed_headcount (1 live row on 08.11)
Tests: src/lib/data/rsvp-single-headcount.local-it.test.ts (5, two mutations caught).
Push needs owner approval (`--remote`, then `--yes`). Then `npm run gen:types` (the committed file equals
today's remote output, so the diff is this migration only).

## Stage 2 — code (after push + gen:types)
Page one field (rsvp-form.tsx, actions.ts: remove the second write + Math.min(10)), validation/rsvp.ts
(headcount 1..100 when attending), data/rsvp.ts (`_headcount`), call-result-processing agent path maps
adults+children -> headcount at the boundary, guests/page.tsx (drop <=10 and the adults/kids line),
guests/[guestId]/page.tsx, admin/support.ts, locales (r.form.*), tests.

## Stage 3 — voice agent (prod, separate approval)
tool_configs/save_rsvp.json + agent_configs/KALFA-RSVP.json (pull --update first), RSVPAgent.voxengine.js
1441-1442 (voxengine-ci upload), verify by call audio. Route keeps accepting adults/children until then.

## Stage 4 — CONTRACT (after the owner decides how a count-less "coming" counts: 1 or expected_count)
Drop _adults/_kids from submit_rsvp, adults/kids keys from get_rsvp_by_token, guests.confirmed_adults/kids +
CHECKs, the adults+kids branch in guest_effective_attending/over_invited, move WhatsApp button + DTMF digit
callers to the one-count shape, adjust console_rsvp_results / console_call_analysis (native console app),
owner-agent primer columns, scripts/verify-db-contracts.mjs, docs/project/03,05,12,13 and
docs/voice-agent/rsvp-conversation-design.md.
