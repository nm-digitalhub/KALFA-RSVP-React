# Guest de-duplication by name (phone-less → phone) — examination + plan

**Date:** 07.07.2026 · **Status:** PLAN ONLY (no code) · **Trigger:** owner had a phone-less guest, later sent a WhatsApp contact with the same name + a phone, and expected the system to recognize them as the same person (or offer to merge) instead of creating a duplicate.

## 1. The live situation (verified)

Two rows for the same people in the brit event `294d23e1`:

| guest id | phone | created | source |
|---|---|---|---|
| `8c29d1d2` | **none** | 06-07 21:29 | original import |
| `7d9281cd` | 0529466618 | 06-07 21:47 | WhatsApp contact |

**Critical nuance:** the names are NOT byte-equal — `8c29d1d2` uses a straight apostrophe `ג'קלין` (U+0027), `7d9281cd` uses the Hebrew geresh `ג׳קלין` (U+05F3). A naive `full_name = full_name` match would miss this pair. **Any name-merge solution must normalize the name first.**

## 2. Current behavior (why the duplicate happened)

De-duplication today is **phone-only**: the DB unique index `guests_event_phone_key` (normalized phone, partial `WHERE phone <> ''`) plus an app pre-filter in both import paths (`import-actions.ts`, WhatsApp `actions.ts`). A **phone-less** existing guest has no key to collide on, so a new same-name row with a phone is accepted as new. There is **no name-based matching anywhere** (only `normalizeGroupName` exists, for group names). Name is legitimately non-unique (many real "דוד כהן"), so a name match can only ever be a **suggestion**, never a DB constraint.

## 3. Design

### 3a. Name normalization — new `normalizeGuestName(name)` (mirror `normalizeGroupName`)
Canonical comparison key: `trim` → collapse inner whitespace → **unify Hebrew punctuation** (geresh `׳`/U+05F3 → `'`, gershayim `״`/U+05F4 → `"`) → strip niqqud + bidi control marks → `toLowerCase()` (for Latin names). The key powers matching only; the stored display name is untouched.

### 3b. Match confidence tiers
- **HIGH — offer merge:** same normalized name **and** the existing guest is **phone-less** **and** the incoming row has a phone. (The owner's exact case: fill the missing phone into the existing record.)
- **ALREADY HANDLED:** same normalized name + same normalized phone → the phone index already de-dupes; skip.
- **LOW — do NOT auto-merge:** same normalized name but **both** have phones that differ → likely different people (or a number change); at most flag, never silently merge.

### 3c. UX — prompt-to-merge (recommended) vs auto-merge
The owner offered both ("understand it's the same… or at least show me a question/option to merge"). Recommendation: **prompt-to-merge on the import review screen**. When a staged row hits a HIGH-confidence match, the review screen shows it as *"נמצא מוזמן קיים «שם» ללא טלפון — לאחד?"* with **[אחד] / [ייבא כחדש]**. Safe (owner confirms), matches expectation, and reuses the existing staging→review→confirm flow — nothing lands until confirmed. (Optional later: silent auto-merge for the single unambiguous HIGH case.)

### 3d. Merge semantics
Merge = write the incoming phone (and fill any empty group/`expected_count`) **into the existing guest**, then **do not create** the incoming row. Preserves the existing guest's `id`, `rsvp_token`, RSVP/headcount state, and audit. Never overwrites a non-empty existing field. Finish with `buildContactsForEvent` so the now-phoned guest links to a contact.

### 3e. Hook points (by surface)
1. **WhatsApp contact / CSV import review** — primary. The staging rows are already presented for review; compute HIGH matches there and let the owner resolve each before confirm.
2. **Manual "add guest"** (`createGuest`) — live hint: if the typed name matches a phone-less existing guest, show *"קיים כבר מוזמן בשם זה ללא טלפון — לעדכן אותו במקום?"*.
3. **Standalone "find duplicates" tool** (later) — scans an event for same-normalized-name clusters (incl. phone-less pairs) and offers bulk merge — cleans history, not just new imports.

## 4. Scope / phases
- **Phase 1:** `normalizeGuestName` + name-match detection + prompt-to-merge on the import review screen (WhatsApp + CSV). Covers the reported case end-to-end.
- **Phase 2:** manual-add live hint.
- **Phase 3:** standalone duplicate-finder/merge tool for existing lists.

## 5. The current live duplicate — one-off cleanup (separate from the feature)
Independent of the feature build, the existing pair can be merged now: write `0529466618` into `8c29d1d2` and delete `7d9281cd` (a data op — destructive, so owner-approved + classifier-gated, run via `!`). Offered, not assumed.

## 6. Risks
- **False merge** — different people, same name. Mitigated by prompt-to-merge + limiting auto-merge to the phone-less→phone tier.
- **Normalization gaps** — geresh/gershayim/niqqud/RTL marks; nicknames & word-order ("שלמה וג׳קלין" vs "ג׳קלין ושלמה") are OUT of exact-key scope (fuzzy matching is a deliberate non-goal for Phase 1).
- **Performance** — per-event guest counts are small; a normalized-name lookup per staged row is cheap. A functional index on `normalizeGuestName(full_name)` is optional.

## 7. Open decisions (for the owner) — RESOLVED 07.07
1. **UX:** prompt-to-merge — **chosen.**
2. **Scope now:** Phase 1 (WhatsApp review flow) — **chosen** (CSV/manual/duplicate-finder deferred).
3. **Current טויטו pair:** merge now as a one-off — **chosen** (command handed to owner via `!`; not yet run as of writing).

## 9. Phase 1b/1c — phone-match + FIELD-LEVEL merge (deep design, 07.07)

Owner asks: also detect merge candidates **by phone**, and let the owner choose **which parameters** to merge (not all-or-nothing, and never automatic — always ask).

### 9a. Two match directions (both on the review screen, one fetch of existing guests)
- **name-match** (phase 1): incoming row HAS a phone; an existing guest is PHONE-LESS; normalized names equal. Anchor = the phone (the value being added).
- **phone-match** (phase 1b): incoming normalized phone already belongs to an existing guest. The row can NEVER be inserted (`guests_event_phone_key`), so it is always dropped — the only question is whether to enrich the existing guest.

A row matched by phone is NOT also offered as a name-merge (phone is the stronger identity signal).

### 9b. Mergeable fields — and what is NEVER touched
Mergeable: `phone` (name-match anchor only), `full_name`, `group`, `expected_count`.
Never: `id`, `rsvp_token`, `status`, `confirmed_*`/headcount/RSVP state, `contact_id` (contacts rebuild after).

### 9c. How to DISTINGUISH & FILTER (the core of the request)
Per matched pair, classify each extra field (name/group/count) by a normalized diff — `normalizeGuestName` / `normalizeGroupName` / numeric — and decide what to render:

| Case | Render | Default |
|---|---|---|
| incoming EMPTY | hide (nothing to add) | — |
| EQUAL to existing (normalized) | hide (nothing to choose) | — |
| existing EMPTY, incoming present ("fill a gap") | field checkbox | **checked** |
| both present but differ ("overwrite") | field checkbox | **unchecked** (owner opts in) |

Match-level default: **name-match → checked** (merge = add phone; uncheck ⇒ import as new). **phone-match → unchecked** (skip/keep existing; check ⇒ apply the chosen field updates). If a match has no showable field diff: name-match shows just the merge toggle; phone-match shows a passive "כבר קיים — ידולג".

### 9d. UI (inside the confirm form)
Per match: a match-level checkbox + a nested list of per-field checkboxes, each showing `«existing» → «incoming»`. Names: `merge_<id>` / `phoneupd_<id>` (match-level) and `field_<id>_full_name` / `_group` / `_expected_count` (fields). Server recomputes matches on confirm (never trusts client-derived identity) and reads only these booleans.

### 9e. Apply (confirm action)
For each match, build a patch from the CHECKED fields (name-match always includes the phone when its merge is on), `applyGuestMerge(eventId, guestId, patch)` (single unified update: phone/name/group_id/expected_count, 23505→friendly), and DROP the incoming row. name-match unchecked ⇒ insert as new. Report `יובאו X · אוחדו Y · עודכנו Z · דולגו W`.

### 9f. Edge cases
Two incoming rows matching the same existing guest (last patch wins — bounded, logged); a field checked whose incoming is empty (ignored by `applyGuestMerge`); phone-update that would collide with a THIRD guest (23505 → friendly error); RTL/`<bdi>` around every name/phone/group value in the diff.

**Decided (owner, 07.07):** fill-checked / overwrite-unchecked (9c); mergeable = name/group/count (+phone for name-match) (9b).

### 9g. Implemented + verified (07.07, NOT deployed) — unified field-level model
Replaced the earlier single-checkbox name-merge with ONE model (old symbols removed, not duplicated — tsc confirms every call site updated):
- `guests.ts`: `MergeFieldKey` / `MergeFieldDiff` / `ImportMatch`, pure `computeImportMatches` (phone identity beats name; per-field diffs via `diffField`), `findImportMatches` (fetches guests + group name), `applyGuestMerge` (unified, typed patch).
- `whatsapp/actions.ts`: reads `merge_<id>` (name-match opt-out) + `field_<id>_<key>` per-field booleans; name-match adds phone + ticked fields; phone-match always drops the row and applies ticked fields (or skips). Notice: `יובאו X · אוחדו Y · עודכנו Z · דולגו W`.
- `whatsapp/page.tsx` + `staging-client.tsx`: per-match card with a match-level toggle + per-field checkboxes (`«incoming» (נוכחי: «existing»)`), defaults per 9c; type-only imports keep the client bundle server-free.
- Verified: `tsc` ✓ · `eslint` ✓ · `next build --webpack` ✓ · **full suite 948/948 ✓**. Deploy PENDING (supersedes the deployed single-checkbox name-merge).

## 8. Implementation status — Phase 1 DONE + VERIFIED (07.07, NOT deployed)
- `normalizeGuestName` (`guest-import-shared.ts`) — geresh/gershayim/niqqud/bidi/whitespace/case. Unit-tested (incl. the live geresh-vs-apostrophe case).
- `matchPhonelessNames` (pure) + `findPhonelessNameMatches` (fetch) + `applyGuestPhoneMerge` (`guests.ts`) — unit-tested.
- `confirmWhatsappImportAction`: computes matches, applies checked merges (fills phone into the existing guest), excludes merged rows from insert, reports `ואוחדו N`.
- Review screen (`whatsapp/page.tsx` + `staging-client.tsx`): a default-checked merge checkbox per candidate, inside the confirm form. Client uses a **type-only** import of `NameMergeMatch`, so the server-only module never enters the client bundle (build confirms).
- Gates: `tsc` ✓ · `eslint` ✓ · `next build --webpack` ✓ · **full suite 948/948 ✓**.
- **Scope limit (logged):** only the WhatsApp review flow. CSV import (immediate, no review step) and manual add do NOT yet detect name matches — Phase 1b/2. HIGH-confidence tier only (phone-less existing ← incoming with phone); no fuzzy/word-order matching.
- **Deploy: PENDING owner approval.**
