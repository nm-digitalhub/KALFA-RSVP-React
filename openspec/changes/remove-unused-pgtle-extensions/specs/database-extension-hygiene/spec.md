# Spec Delta

## Purpose

The database carries only the extensions the repository declares, keeps them out of the exposed `public`
schema, and never lets an unauthenticated caller run extension code it does not need.

## ADDED Requirements

### Requirement: No undeclared extension in the database
Every extension present in the production database SHALL be created by a migration in the repository or
be part of the Supabase platform baseline.

#### Scenario: Extension inventory
- **WHEN** the installed extensions of production and of a database rebuilt from the migrations are listed
- **THEN** the two lists are equal

### Requirement: No extension code in the exposed schema reachable by anonymous callers
No function belonging to an extension SHALL be executable by `anon` through the Data API unless an
application path needs it.

#### Scenario: Anonymous RPC
- **WHEN** an unauthenticated caller invokes an extension function through the Data API
- **THEN** the request is refused

### Requirement: The UUIDv7 generator keeps working
Removing unused extensions SHALL NOT change the UUIDv7 generator or the tables whose identifiers use it.

#### Scenario: New row after the change
- **WHEN** a row is inserted into a table whose identifier defaults to the UUIDv7 generator
- **THEN** it receives a version-7 UUID exactly as before

### Requirement: No network package installer in the database
The database SHALL NOT contain a function that downloads and installs code from the network.

#### Scenario: Installer inventory
- **WHEN** the functions of every schema are listed
- **THEN** none fetches SQL over HTTP to install it
