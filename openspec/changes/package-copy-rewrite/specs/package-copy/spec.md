# Package copy

## ADDED Requirements

### Requirement: Authorized rewriting
The system SHALL require manage_billing before starting Claude Code.

#### Scenario: Unauthorized user
- WHEN a user without manage_billing requests a rewrite
- THEN no Claude process is started

### Requirement: Preview and explicit application
The system SHALL preserve the original field until staff explicitly applies a suggestion.

#### Scenario: Cancel suggestion
- WHEN staff cancels the preview
- THEN the original value and form field name are preserved

### Requirement: Stale result protection
The system SHALL discard suggestions after the field has been edited.

#### Scenario: Edit during request
- WHEN staff edits the source while rewriting is in progress
- THEN the late result cannot be applied

### Requirement: Existing field limits
The system SHALL validate generated copy against the existing package limits.

#### Scenario: Invalid result
- WHEN the result exceeds the description or includes limits, or changes the number of includes items
- THEN the suggestion is rejected and the original field remains
