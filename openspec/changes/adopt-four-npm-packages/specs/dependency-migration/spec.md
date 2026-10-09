## ADDED Requirements

### Requirement: Shared standards-compliant CSV parsing
The system SHALL preserve raw cells, blank internal rows, BOM handling, mixed
record delimiters and semicolon reports, and SHALL reject malformed quoting
without inserting guest rows.

#### Scenario: Malformed upload
- WHEN a quoted field is not terminated
- THEN both guest upload channels return a fixed CSV UTF-8 instruction
- AND no guest insertion is attempted

### Requirement: Async fixed-window quota enforcement
The system SHALL await every limiter invocation before allowing a request and
SHALL preserve allowed, remaining and resetAt semantics for valid static policies.

#### Scenario: Concurrent requests
- WHEN ten requests consume a three-point quota for one key
- THEN exactly three are permitted within the window

### Requirement: Normalized numeric-host classification
The system SHALL reject every IPv4 literal, including IPv4-mapped IPv6, and
non-unicast IPv6. The classifier SHALL make no DNS-resolution guarantee.

#### Scenario: Public DNS prefix
- WHEN a public DNS name starts with fc or fd
- THEN its prefix alone does not mark it as a private IP

### Requirement: Async Hebrew React Email templates
The system SHALL render all six templates with React Email components, preserve
RTL on both html and body, preserve thread subjects and text/plain alternatives,
and escape untrusted names and bodies before any limited Markdown conversion.

#### Scenario: Body contains HTML
- WHEN a reply contains a script tag or an unsafe Markdown URL
- THEN it cannot render executable HTML or an unsafe link
