## Purpose

The SUMIT-era columns of `campaigns` (the old authorise-and-capture payment model) stop being read and written, their history is preserved, and only then are they removed, so `campaigns` holds no second, stale record of payment facts.

## ADDED Requirements

### Requirement: No code or database object reads a retired column

Before a SUMIT-era column is dropped, no application code, database function, view or trigger SHALL read or write it. Payment facts for package purchases SHALL come from the payment ledger (`payment_operations`).

#### Scenario: A column is proposed for dropping
- **WHEN** a drop migration is prepared for a SUMIT-era column
- **THEN** a search of the source and of the live database functions and views finds no reference to that column

### Requirement: History is preserved before a column is dropped

The values held in a SUMIT-era column SHALL be preserved, in the form the owner approves, before the column is dropped. Cleaning up code SHALL NOT delete historical data.

#### Scenario: A campaign paid through SUMIT
- **WHEN** a campaign that has SUMIT authorisation or charge values is migrated
- **THEN** those values remain retrievable after the columns are dropped

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
