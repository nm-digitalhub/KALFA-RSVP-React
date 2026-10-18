# Spec Delta

## Purpose

Keeps the full content of a finished voice call (what was said, the guest details the agent was given, and the grader's reasons) in one governed store that KALFA controls, instead of dropping it or leaving it in an intake queue.

## ADDED Requirements

### Requirement: Transcript content is stored per finished call

When a post-call delivery for a finished call is processed, the system SHALL store one record per provider conversation holding the transcript turns (speaker, text, offset in the call), the guest variables the agent was given, and every evaluation and data-collection rationale.

#### Scenario: Delivery with a transcript
- **WHEN** a post-call delivery carrying twelve transcript turns is processed
- **THEN** one record exists for that conversation with twelve turns in call order, each with its speaker and offset

#### Scenario: Call with no spoken turns
- **WHEN** a delivery carries an empty transcript
- **THEN** a record exists with an empty list of turns, so a missing record always means "never processed" and never "nothing was said"

#### Scenario: Delivery replayed
- **WHEN** the same delivery is processed a second time
- **THEN** no second record is created and the first is unchanged

### Requirement: Re-analysis updates the reasons, not the turns

When the provider re-delivers a conversation it has re-analysed, the system SHALL keep the single record, SHALL replace the stored rationales with the latest ones, and SHALL leave the transcript turns unchanged.

#### Scenario: Re-analysis with a changed verdict
- **WHEN** a second delivery for the same conversation arrives with a different rationale for a criterion
- **THEN** the record holds the new rationale, the turns are as first stored, and still only one record exists

### Requirement: Content is linked to its attempt and event

The system SHALL link each record to the call attempt it belongs to, in whichever attempt store that attempt lives, and to that attempt's event when it has one. A record whose attempt cannot be resolved SHALL be kept unlinked and SHALL be linkable later. A record SHALL never be attributed to an attempt or event that was not positively matched.

#### Scenario: Attempt resolved
- **WHEN** the delivery's correlation resolves to an RSVP call attempt on event E
- **THEN** the record is linked to that attempt and to event E

#### Scenario: Attempt not resolved
- **WHEN** no attempt matches the delivery
- **THEN** the record is stored with no attempt and no event, and is picked up by a later linking pass

#### Scenario: Ambiguous match
- **WHEN** the delivery could belong to more than one attempt
- **THEN** the record stays unlinked rather than guessing

### Requirement: Transcript content is not readable by any client role

Transcript records SHALL be reachable only through server-side code running with service authority. No anonymous or authenticated client role SHALL be able to select, insert, update or delete them, directly or through a view.

#### Scenario: Customer session
- **WHEN** a signed-in event owner queries for transcript records of their own event
- **THEN** no rows and no error detail are returned

#### Scenario: Anonymous request
- **WHEN** an unauthenticated client requests any transcript record
- **THEN** the request is refused

### Requirement: One governed copy of the content

After a transcript record has been durably stored, the system SHALL remove the transcript turns and guest variables from the matching webhook inbox payload, keeping its metadata. When storing fails, the inbox payload SHALL remain untouched so processing can be retried.

#### Scenario: Stored successfully
- **WHEN** the transcript record is committed
- **THEN** the inbox row no longer contains transcript turns or guest variables, and still identifies the conversation and its processing state

#### Scenario: Store fails
- **WHEN** writing the transcript record fails
- **THEN** the inbox payload is unchanged and the delivery is retried

### Requirement: Existing inbox content is moved once

The system SHALL move the transcript content already sitting in webhook inbox rows into the transcript store, idempotently, and SHALL redact an inbox row only after its record exists.

#### Scenario: Existing row
- **WHEN** the move runs over an inbox row that holds a transcript
- **THEN** a transcript record exists for that conversation and the row is redacted

#### Scenario: Move run twice
- **WHEN** the move is run a second time
- **THEN** it creates no new records and changes no redacted row

### Requirement: Capture is withheld until retention is configured

The system SHALL NOT capture transcript content while no retention period is configured. In that state it SHALL leave the inbox payload intact, so no content is lost and none is redacted, and SHALL show staff that capture is waiting for the setting.

#### Scenario: Retention not set
- **WHEN** a delivery is processed and no retention period is configured
- **THEN** no transcript record is written, the inbox payload is kept as delivered, and the admin surface shows capture is paused

#### Scenario: Retention set later
- **WHEN** the period is configured
- **THEN** deliveries still held in the inbox are captured by the next processing pass

### Requirement: Failures never expose content

Any log line, alert or error raised while capturing a transcript SHALL contain identifiers and counts only, never turns, names, phone numbers, guest variables or rationales.

#### Scenario: Store failure alert
- **WHEN** storing a transcript record fails and an alert is raised
- **THEN** the alert names the conversation identifier and the failure class, and contains no transcript text or guest data
