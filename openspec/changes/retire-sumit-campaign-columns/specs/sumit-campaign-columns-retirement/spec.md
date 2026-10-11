## Purpose

The pay-per-result model (a SUMIT card hold, a signed agreement and a charge at close) can no longer be created, and its code and comments are removed. The SUMIT-era columns of `campaigns` stop being read and written, their history is preserved, and only then are they removed, so `campaigns` holds no second, stale record of payment facts. The CardCom package flow keeps working unchanged.

## ADDED Requirements

### Requirement: A pay-per-result campaign cannot be created

The system SHALL NOT allow staff to save a package with a per-result price, and SHALL NOT create a campaign without a fixed-price package.

#### Scenario: Staff try to save a per-result package
- **WHEN** a package is saved with a per-result price
- **THEN** the save is refused

#### Scenario: No package is on offer
- **WHEN** a customer confirms the event details and no package is on offer
- **THEN** no campaign is created and the customer is told no package is available

### Requirement: The old model's code is removed

No source file SHALL contain a code path, switch or comment for the card hold, the charge at close, the signed per-result agreement, or per-result pricing. Notes that explain the history of an existing record are allowed.

#### Scenario: A search after removal
- **WHEN** the source is searched for the old model's names
- **THEN** only history notes and generated provider models match

### Requirement: The package flow and reached recording keep working

Removing the old model SHALL NOT change the CardCom package purchase, settlement or refund, or the recording of reached contacts for package campaigns.

#### Scenario: A package campaign reaches a contact
- **WHEN** a guest of a package campaign is reached after the removal
- **THEN** the reach is recorded and the guest is shown as reached, as before


### Requirement: No code or database object reads a retired column

Before a SUMIT-era column is dropped, no application code, database function, view or trigger SHALL read or write it. Payment facts for package purchases SHALL come from the payment ledger (`payment_operations`).

#### Scenario: A column is proposed for dropping
- **WHEN** a drop migration is prepared for a SUMIT-era column
- **THEN** a search of the source and of the live database functions and views finds no reference to that column

### Requirement: History is preserved before a column is dropped

The values held in a SUMIT-era column SHALL be retrievable from the payment ledger before the column is dropped, except the card values named in the next requirement. Cleaning up code SHALL NOT delete historical data.

#### Scenario: A campaign paid through SUMIT
- **WHEN** a campaign that has SUMIT authorisation or charge values is migrated
- **THEN** every value outside the card exception is retrievable from its ledger rows after the columns are dropped

### Requirement: The owner's card exception is limited

The card token, card expiry and citizen ID of campaigns whose SUMIT authorisation was released with nothing charged SHALL NOT be copied, and SHALL be removed when their columns are dropped (owner, 11.10.2026). The exception SHALL NOT extend to any other column or campaign.

#### Scenario: The card group is dropped
- **WHEN** the `card_*` group is dropped
- **THEN** only released, uncharged SUMIT campaigns held values in it, and those values are gone

#### Scenario: Another campaign holds a card value
- **WHEN** a campaign outside the exception holds a card value at the time of the drop
- **THEN** the drop does not proceed

### Requirement: SUMIT transactions are never refunded through CardCom

Retiring the columns SHALL NOT route any refund, capture or release of a SUMIT transaction through CardCom.

#### Scenario: A historical SUMIT campaign is cancelled
- **WHEN** a campaign whose payment was made through SUMIT is cancelled after the columns are retired
- **THEN** no CardCom refund is requested for it

### Requirement: Each drop is separately approved

Each column group SHALL be dropped by its own migration, created with `supabase migration new`, after the owner approves that group.

#### Scenario: One group is approved
- **WHEN** the owner approves dropping the `card_*` group only
- **THEN** only that group's drop migration is created, and the other groups stay
