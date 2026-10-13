## Purpose
Give authenticated users a clear explanation of denied platform access while preserving authorization and machine-readable API failures.

## ADDED Requirements

### Requirement: Explain denied browser access
The system SHALL redirect authenticated users denied platform staff, owner, or named permission access to `/access-denied`, without changing permission decisions.

#### Scenario: Restricted staff member opens roles
- **WHEN** a staff member without the required roles permission opens `/admin/roles`
- **THEN** the browser navigates to `/access-denied`

#### Scenario: Authorized benefit screen
- **WHEN** the same user opens a benefit screen they are permitted to view
- **THEN** the screen opens normally

### Requirement: Authenticated recovery page
The system SHALL show a Hebrew RTL denial card outside the admin area, requiring only login, displaying the current email when available, with events and logout controls, stacked on mobile, and noindex/nofollow metadata.

#### Scenario: Recover from denial
- **WHEN** an authenticated user opens the denial page
- **THEN** the page explains the restriction and links to `/app/events` and POST logout

#### Scenario: Anonymous visitor
- **WHEN** an anonymous visitor opens the denial page or a platform-protected page
- **THEN** the visitor is redirected to login

### Requirement: Preserve transport semantics
The system SHALL propagate authorization navigation through Server Actions and return an HTTP authorization error rather than redirecting API clients to HTML.

#### Scenario: Server Action denial
- **WHEN** a platform permission guard denies a Server Action inside error handling
- **THEN** the browser receives the access-denied navigation

#### Scenario: API denial
- **WHEN** an API client's platform permission check fails
- **THEN** the response is an authorization error without an HTML redirect
