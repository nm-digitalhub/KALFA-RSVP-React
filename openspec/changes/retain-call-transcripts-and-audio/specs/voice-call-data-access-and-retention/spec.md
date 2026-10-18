# Spec Delta

## Purpose

Limits who may read stored call content, records every read, and bounds how long the content is kept, so holding call transcripts and audio stays accountable.

## ADDED Requirements

### Requirement: Only authorized staff can read call content

Reading a call's transcript or audio SHALL require a signed-in platform staff member who holds the dedicated call-content permission. The check SHALL run on the server for every read. No customer, event owner, guest or anonymous caller SHALL be able to read call content.

#### Scenario: Permitted staff
- **WHEN** a staff member with the call-content permission opens a call's transcript with a stated reason
- **THEN** the transcript is shown

#### Scenario: Staff without the permission
- **WHEN** a staff member without the permission requests a transcript
- **THEN** the server refuses and nothing is returned

#### Scenario: Event owner
- **WHEN** the owner of the event the call belongs to requests that call's transcript or audio
- **THEN** the request is refused

### Requirement: Every read states a reason and is logged

A read of transcript or audio SHALL be refused unless the caller gives a non-empty reason. Each permitted read SHALL append one access record with the staff member, the call, its event, what was read (transcript or audio), the reason and the time. Access records SHALL be append-only for every application role, and SHALL hold no call content.

#### Scenario: Read with a reason
- **WHEN** permitted staff open a transcript with a reason
- **THEN** exactly one access record is appended naming them, the call, "transcript" and the reason

#### Scenario: Read without a reason
- **WHEN** the reason is empty
- **THEN** nothing is returned and no access record is written

#### Scenario: Attempt to alter the log
- **WHEN** any application role tries to update or delete an access record
- **THEN** the operation is refused

### Requirement: Audio is played through short-lived server-issued access

Audio SHALL be delivered only through an access grant issued by the server after the permission and reason checks, valid for a few minutes. The grant SHALL NOT be stored or logged.

#### Scenario: Playback
- **WHEN** permitted staff request audio with a reason
- **THEN** they receive a grant that works briefly and then stops working

#### Scenario: Reusing an old grant
- **WHEN** a grant is used after it has expired
- **THEN** the audio is not served

### Requirement: Call content expires after the configured retention period

The owner SHALL set one retention period for call content. A scheduled purge SHALL delete transcript records and audio files older than that period, together with their metadata. Access records SHALL be kept.

#### Scenario: Content past the period
- **WHEN** the purge runs and a transcript and its audio are older than the period
- **THEN** both are deleted and a purge record shows the counts deleted

#### Scenario: Content within the period
- **WHEN** the purge runs over content younger than the period
- **THEN** it is left untouched

#### Scenario: Period changed
- **WHEN** the owner shortens the period
- **THEN** the next purge applies the new period to existing content

### Requirement: Deleting a guest or an event deletes its call content

When a guest is deleted, the system SHALL delete the call content of every call attempt linked to that guest. When an event is deleted, it SHALL delete the call content of every attempt linked to that event. Unlinked content SHALL be removed only by the retention purge.

#### Scenario: Guest deleted
- **WHEN** a guest who has two recorded calls is deleted
- **THEN** both transcripts and both audio files are deleted

#### Scenario: Event deleted
- **WHEN** an event is deleted
- **THEN** all call content linked to the event is deleted

### Requirement: Deletion reports where copies may remain

A deletion of call content SHALL state that it removed KALFA's copy only, and SHALL show staff whether the provider is still configured to retain its own copy.

#### Scenario: Provider still retains
- **WHEN** call content is deleted while the provider's agent settings keep recordings without limit
- **THEN** the deletion report says the provider copy was not removed

### Requirement: Purges and erasures leave an audit without content

Each purge and each erasure SHALL append an audit record with the time, the trigger and counts of what was deleted, and no call content.

#### Scenario: Scheduled purge
- **WHEN** the purge deletes 3 transcripts and 2 audio files
- **THEN** one audit record states those counts and the trigger "retention", and contains no names, numbers or text
