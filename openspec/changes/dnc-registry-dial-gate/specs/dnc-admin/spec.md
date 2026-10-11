## ADDED Requirements

### Requirement: Staff can check a number without dialling

The admin DNC screen SHALL offer a "בדיקת מספר" tab. It SHALL run the shared registry check, display the result, its source and its time in fixed wording, and SHALL never start a call. Access SHALL require the `manage_voice` platform permission on the server, and checks SHALL be rate-limited.

#### Scenario: Clear number
- **WHEN** a permitted staff member checks a number and the result is `registry_clear`
- **THEN** the screen shows "המספר אינו רשום במאגר. החיוג כפוף לשאר תנאי המערכת." together with the check time

#### Scenario: Listed number
- **WHEN** the result is `registry_listed`
- **THEN** the screen shows "המספר רשום במאגר."

#### Scenario: Check could not complete
- **WHEN** the result is `registry_unchecked` or `registry_unavailable`
- **THEN** the screen shows "לא ניתן להשלים את הבדיקה. לא בוצע חיוג."

#### Scenario: Unauthorized user
- **WHEN** a user without `manage_voice` invokes the check action
- **THEN** the server refuses and no check runs

### Requirement: Local list tab

The screen SHALL show the local removal list with search and server-side pagination, showing each entry's reason and the date it was added.

#### Scenario: Search
- **WHEN** staff search for a number
- **THEN** only matching local entries are listed

### Requirement: Connection status without secrets

The screen SHALL show whether the registry credentials are configured, the time of the last successful check, and the last error. It SHALL NOT display the token or the identifier value.

#### Scenario: Credentials missing
- **WHEN** `DNC_API_NAME` or `DNC_API_TOKEN` is not set on the server
- **THEN** the status tab shows that the connection is not configured, and no secret value appears in the page
