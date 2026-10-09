# Package copy skills

## ADDED Requirements

### Requirement: Field-based skill routing
The system SHALL select skill source and task on the server by the validated field.

#### Scenario: Two package fields
- WHEN description and includes request rewriting
- THEN both use the pinned Hebrew writer with distinct field tasks

### Requirement: Shared download cache
The system SHALL reuse a successful skill prompt and share in-flight loads.

#### Scenario: Load failure
- WHEN downloading a skill fails
- THEN the failed cache entry is removed and a later request can retry
