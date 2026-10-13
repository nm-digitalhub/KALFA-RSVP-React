# Spec Delta

## ADDED Requirements

### Requirement: Unified display status
The system SHALL derive one display status per assignment at read time — active states
by validity, פגה computed from expires_at without writing any new DB state, מומשה taking
precedence over expiry, and void labeled by the recorded end reason or "הסתיימה" when
unknown. Account-claim state is separate, and claimed_at is shown only when it exists.

#### Scenario: Expired assigned row
- **WHEN** an assigned assignment's expires_at has passed and the list or detail is read
- **THEN** it is displayed as פגה while its stored state remains assigned, and no state write occurs during the read

#### Scenario: Consumed outlives expiry
- **WHEN** a consumed assignment's expires_at later passes
- **THEN** it is still displayed as מומשה, and a refund never returns it to an available state

#### Scenario: Void reason from history only
- **WHEN** a void row has no recorded end reason
- **THEN** the display says הסתיימה, never a reason inferred from dates

### Requirement: Server-side list with pagination
The staff list SHALL apply its search, filters and sort on the server before paginating
(25 per page, id as the stable tiebreak), and SHALL return the total of the filtered
set. Search is exact normalized email or phone only — no partial-phone autocomplete.

#### Scenario: Old assignment beyond 200 rows
- **WHEN** a filter matches an assignment older than the newest 200
- **THEN** the assignment is found and returned on its page

#### Scenario: Parameter hygiene
- **WHEN** the URL carries an invalid filter value or an out-of-range page
- **THEN** values normalize to defaults and the page is corrected keeping the filters, and a shared filter URL grants no permission

#### Scenario: Fetch failure
- **WHEN** the list read fails
- **THEN** the screen shows a safe error with a retry action, never an empty list presented as "no results"

### Requirement: Global consumption-exception guard
The system SHALL count succeeded package payments whose pricing round carries a
non-consumed assignment, attributed only via pricing_round_id → campaign_pricing →
coupon_assignment_id, across the whole dataset regardless of page or filters.

#### Scenario: Exception outside the current page
- **WHEN** a succeeded payment's assignment on page 3 is not consumed and the viewer is on page 1
- **THEN** the global count includes it and the screen links to the filtered exception view

#### Scenario: Pending does not mask succeeded
- **WHEN** the same campaign holds a pending attempt and a succeeded payment on a round carrying an unconsumed assignment
- **THEN** the exception is still counted — payment ranking is display-only

#### Scenario: Failed check is not a clean bill
- **WHEN** the exception check itself fails
- **THEN** the screen reports the check as unavailable, never "no exceptions"

### Requirement: Assignment detail view
The system SHALL serve a permission-gated detail page per assignment at a direct URL:
recipient and claim state, the SAVED terms and source, frozen options from
coupon_assignment_options only (matched by package_id), current binding with
permission-gated links, payment attempts attributed by pricing_round_id, and history
ordered by time then id. An unknown id answers not-found only after the permission
check.

#### Scenario: Options missing
- **WHEN** an assignment has no stored options rows
- **THEN** the detail shows a data-quality warning — never zero prices or current catalogue prices as a substitute

#### Scenario: Expired with an open payment
- **WHEN** the assignment expired while a package payment opened in validity is still pending
- **THEN** the detail says the open payment proceeds under the terms saved at its opening, and does not offer the benefit for new use

#### Scenario: Partial fetch failure
- **WHEN** one section's read fails (e.g., history)
- **THEN** that section is marked unavailable and the rest of the page still renders

#### Scenario: Actor labeling
- **WHEN** a history event has no recorded actor
- **THEN** it is labeled as system/automatic per its recorded origin — never attributed to the agent by default

### Requirement: Account-resolved staff assignment
The staff assign flow SHALL resolve the target account on the server from an exact,
format-validated email, require explicit confirmation of the found account and an
explicit offer choice, preview server-computed terms, and bind the idempotency key to
the original request. Successful outcomes navigate to the resulting assignment's detail.

#### Scenario: User beyond the first thousand
- **WHEN** the target account exists beyond any provider page limit
- **THEN** the lookup still finds it, and lookup failure is reported as failure — never as "not found"

#### Scenario: Replay returns saved terms
- **WHEN** the create is retried with the same idempotency key after prices changed
- **THEN** the answer carries the originally frozen options, not recomputed ones

#### Scenario: Key reuse with a different request
- **WHEN** the same idempotency key arrives with a different target or offer
- **THEN** the request is refused rather than answered as an existing success

#### Scenario: Duplicate kept
- **WHEN** the new assignment is the one voided under the duplicate rule
- **THEN** the flow points at the KEPT assignment's detail with an explanation, not a success for an unusable row

### Requirement: Atomic staff assignment creation
Creating a staff assignment SHALL persist the assignment, all of its frozen price
options and its history event in ONE database transaction, which SHALL also validate
the confirmed preview terms against the live offer and package prices — a drifted
offer or price is refused inside the transaction and nothing is persisted. The
duplicate rule (identical option set keeps the later-expiring assignment) executes
inside the same transaction.

#### Scenario: Stale offer refused in the transaction
- **WHEN** the offer or its prices changed between the confirmed preview and the create transaction's validation
- **THEN** the transaction refuses, nothing is persisted, and the screen asks to re-confirm the refreshed terms

#### Scenario: Partial write is impossible
- **WHEN** writing the options or the history event fails after the assignment row insert
- **THEN** the whole creation rolls back — no assignment without its frozen options and its recorded event

#### Scenario: Double submit yields one assignment
- **WHEN** the same create is submitted twice concurrently (double click or retry race)
- **THEN** exactly one assignment with one event exists, and both callers receive that same assignment

#### Scenario: Create races an offer edit
- **WHEN** a create and an offer/price edit run on two real connections
- **THEN** locks serialize them — the create commits the previewed terms or refuses, never a mix

### Requirement: Reasoned atomic void
Void SHALL be offered from the detail page, require a staff reason (1–500 chars, stored
without colliding with operational reason codes), and be decided by the server under row
locks against live state, with release, state change and the void event committing as
one transaction. The actor is the authenticated user, never a browser field.

#### Scenario: Refusals by live state
- **WHEN** the assignment is consumed/void, held by a pending/review package payment or approved terms, or shows money movement or a consumption exception
- **THEN** the void is refused with a coded reason (investigation for the money cases), and an expired row needs no void at all

#### Scenario: Failure after release
- **WHEN** the void's event write fails after the release step
- **THEN** the whole void rolls back and the binding, discount and history are unchanged

#### Scenario: No silent success
- **WHEN** a void changes no row (including a repeat void)
- **THEN** the server does not answer success and writes no second event

#### Scenario: Concurrent void and bind
- **WHEN** a void and a bind/approve/payment race on two real connections
- **THEN** locks serialize them and the loser is refused cleanly with no partial writes

#### Scenario: State changed since the dialog opened
- **WHEN** the assignment's state changed between opening the dialog and confirming
- **THEN** the server refuses and the detail page answers with the message of the NEW state (a closed refusal code, list filters kept) and the refreshed details; a validation or unexpected error keeps the typed reason on the open form
