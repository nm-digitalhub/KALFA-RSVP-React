# WhatsApp import misroute — recovery + root-cause fix (end-to-end plan)

**Date:** 07.07.2026 · **Owner:** 1bbe74dc-5721-48e9-9092-fd9e3c6e6b21
**Trigger:** owner sent a 41-row guest CSV via WhatsApp intending it for the **brit** event; it was staged + confirmed on a **test wedding** event instead. Owner approved (via `/goal`) a 3-part remediation.

---

## 0. Root cause (verified against live DB + code)

`resolveOwnerActiveEvent` (`src/lib/data/whatsapp-import.ts`) maps the **sender phone → owner profile → their single NEWEST `status='active'` event** (`order by created_at desc limit 1`). There is **no target-event selection** and no per-event WhatsApp number. At import time (06-07 17:04) the newest active event was the QA/test wedding `6469cd41` (created 17:00, 4 min earlier), so it won the tiebreak over the brit event `294d23e1` (created 05-07).

**Not a security bug:** sender is matched only to a *verified owner* profile; strangers are silently ignored; the list only ever lands on an event the sender themselves owns/co-manages. Data never crossed an authorization boundary. It is a **correctness/UX defect** (silent "newest active" guess) — worsened here because QA test events I created were the newest active events at that moment.

### Live-DB facts gathered (all read-only)
- brit `294d23e1`: **active**, brit, 2 guests (טויטו ×2).
- QA `6469cd41`: **closed**, wedding, 43 guests = **42 imported** (all `pending`) + 1 my test guest `0527777777`. Groups: משפחה 24, חברים 15, שכנים 2, (none) 1.
- 2 of the 42 collide (normalized phone) with the brit event's 2 existing guests → both `pending`, no RSVP state → **keep brit originals, skip these 2**. Net new = **40**.
- Test events created by me on 06-07: `6469cd41` (17:00), `3d8c6ad9` (16:31, 1 guest, 2 test rsvp_responses), `b107564b` (14:45, 3 guests, 1 test campaign, 2 test rsvp_responses). **None** have billing / signed agreements / orders / paid campaigns.
- `guests`: **no INSERT/DELETE triggers** (only `set_updated_at` BEFORE UPDATE); `rsvp_token`, `id`, timestamps, `status='pending'`, counts all auto-default on insert.
- FK on-delete: `events` → guests/guest_groups/contacts/staging/campaigns/rsvp_responses/billing all **CASCADE**; `guests.group_id`/`contact_id` **SET NULL**. Deleting the 3 test events cleanly removes all their children.
- No app-native `deleteEvent` action and no guest-CSV export exist.

---

## 1. Recover the list — move 40 guests → brit `294d23e1`

**Mechanism:** reconstruct the guest list from the QA event and run it through the **real in-app CSV import** on the brit event (`importGuestsAction` → dedup + group-create + `bulkInsertGuests` + `buildContactsForEvent`). This reuses the exact production path, so groups (משפחה/חברים/שכנים) are recreated in the brit event, the 2 duplicates are skipped per-row, and contacts are rebuilt — no hand-rolled logic. Fallback to a backed-up SQL transaction only if the browser path fails repeatedly.

Steps:
1. **Backup** (durable JSON in scratchpad): all 43 QA guests (every column) + the 2 brit guests + the 3 test events' rows. Makes every step reversible.
2. Build a CSV (name, phone, group, expected_count) from the 42 importable QA guests **excluding** `0527777777`. The 2 טויטו duplicates are left in the file — the importer reports them as "already exists" and skips them (verifies dedup works).
3. Import the CSV on the brit event's import screen; expect `imported: 40`, `failed: 2` (the duplicates).
4. Verify: brit event = 42 guests (2 original + 40), 3 groups present, all `pending`; guests page renders.
5. **Event status:** brit is `active` ⇒ import permitted. Source QA is `closed` (read-only source only).

## 2. Clean up my test events — delete `6469cd41`, `3d8c6ad9`, `b107564b`

**Mechanism:** SQL `DELETE` as postgres (no app path exists). Cascade removes their guests/groups/contacts/staging/test-campaigns/test-responses. Guarded by §0 (no billing/agreement/order rows). Run **only after** §1 verifies the brit event holds the 40 moved guests. `orders` FK is SET NULL, but these events have 0 orders.

## 3. Root-cause fix — no silent wrong-routing (`whatsapp-import.ts`)

`resolveOwnerActiveEvent` → `resolveOwnerActiveEvents` returning **all** `status='active'` events the sender may manage (owned + org-shared with `guests.create`), newest-first. Then in `stageWhatsAppImport`:
- **0 candidates** → return `false` (stranger; unchanged, nothing leaks).
- **exactly 1** → stage there and **name the event in the reply** ("נקלטו X שורות לאירוע «…»") — the transparency that would have caught this misroute.
- **>1 candidate** → **do NOT guess**. Stage nothing; reply that the file was received but the owner has several active events, listing each **active** event with its own in-app import link, asking them to upload on the correct one. Fail-closed: a file can never again be silently routed to the wrong event.

**Event status (owner's note):** only `status='active'` events are ever candidates; closed/draft never receive an import; ambiguity is resolved among active events only.

Tests: update `whatsapp-import.test.ts` (multi-event → no stage + list reply; single → named reply; zero → ignored). Verify `npm run lint`, `npx tsc --noEmit`, `npm run build`, focused vitest. **Deploy to prod only with explicit owner approval** (separate gate).

*Follow-up (not in this batch):* richer conversational "reply 1/2/3 to choose" selection — needs a pending-rows store + reply arbitration vs the headcount numeric handler; documented for a later green-light.

---

## Order & safety
Backup → §1 (move + verify) → §2 (delete + verify) → §3 (code + verify, hold deploy). Every destructive step is preceded by the JSON backup and a verify query. Deploy of §3 waits for explicit approval.

---

## Execution log (07.07.2026)

- **§1 Recover — DONE (by owner).** Owner re-imported the list in-app; my planned CSV import was **not** run (no duplication from me). Verified: brit event = **42 guests** (incl. "מזל חברה של נטלי", who existed only on the test event).
- **§2 Cleanup — DONE.** Deleted the 3 test events I created (6469cd41, 3d8c6ad9, b107564b) via cascade. Owner then chose to also delete the 2 remaining stale events (03733daf, 00000000…e1 — the latter held 3 test signed-agreements, deleted with informed consent). Final state: **only the brit event remains.**
- **§3 Fix — IMPLEMENTED + VERIFIED (chosen design: Option A, owner-selected).**
  - `whatsapp-import.ts`: `resolveOwnerActiveEvent` (newest-wins) → `resolveOwnerActiveEvents` (returns ALL active manageable events). `stageWhatsAppImport`: 0 → ignore; **1 → stage + reply NAMING the event**; **>1 → stage nothing, reply listing each active event with its own import link** (fail-closed; never guesses).
  - New pure, unit-tested helpers: `eventImportLabel`, `buildSingleEventReply`, `buildAmbiguousEventReply`.
  - Verification: `tsc` ✓, `eslint` ✓, `next build --webpack` ✓, `whatsapp-import.test.ts` 9/9 ✓, **full suite 939/939 ✓**.
  - **Deploy: PENDING owner approval** (`npm run deploy` rebuilds app + worker and restarts them — the worker runs the webhook processor, so the fix only takes effect after deploy).
  - Follow-up (not built): richer conversational "reply 1/2/3" selection — needs a pending-rows store + reply arbitration vs the headcount numeric handler.
