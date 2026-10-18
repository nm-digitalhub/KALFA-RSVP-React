# Spec Delta

## Purpose

Brings the audio of a finished voice call into KALFA's own private storage, with an honest record of what was stored, so the recording no longer depends on a provider's retention.

## ADDED Requirements

### Requirement: Audio is fetched into private storage after the call

For every finished call that has an audio source, the system SHALL fetch the audio once into a private store and record its provider, source reference, size, content type, content hash and fetch time. The store SHALL have no public address.

#### Scenario: Call with a recording
- **WHEN** a call ends and its recording becomes available
- **THEN** the audio is stored privately and a metadata record shows its size, hash, content type and fetch time

#### Scenario: Fetch repeated
- **WHEN** the fetch runs again for a call whose audio is already stored
- **THEN** no second copy is created and the metadata is unchanged

#### Scenario: Public access attempted
- **WHEN** anyone requests the stored audio by a guessed address without server-issued authorization
- **THEN** the request is refused

### Requirement: Fetching is retried and never runs twice at once

A failed fetch SHALL be retried a bounded number of times with growing delay. While one runner holds a call's fetch, no other runner SHALL fetch the same call. After the final attempt the call SHALL be marked failed, visibly to staff.

#### Scenario: Transient failure
- **WHEN** the first attempt fails with a temporary error and the second succeeds
- **THEN** the audio is stored once and the call is marked stored

#### Scenario: Two runners overlap
- **WHEN** a scheduled run and a manual run start at the same moment
- **THEN** each call is fetched by exactly one of them

#### Scenario: Attempts exhausted
- **WHEN** every allowed attempt fails
- **THEN** the call is marked failed with the failure class and the attempt count, and is listed for staff

### Requirement: A gone source is recorded, not hidden

When the provider no longer holds the audio, the system SHALL mark the call as source unavailable, with the time of the finding, distinct from a failed fetch. A call without any audio source SHALL be marked as having none.

#### Scenario: Recording expired at the provider
- **WHEN** the source reports the recording does not exist
- **THEN** the call is marked source unavailable and is not retried further

#### Scenario: Call never recorded
- **WHEN** a finished call has no recording reference at all
- **THEN** it is marked as having no audio source, not as failed

### Requirement: Audio is downloaded only from verified provider hosts

The system SHALL fetch audio only over HTTPS from the provider hosts it has verified, SHALL refuse redirects and addresses that resolve to private or reserved ranges, and SHALL refuse a file above the size limit, recording the refusal reason.

#### Scenario: Unknown host
- **WHEN** a recording reference points to a host that is not on the verified list
- **THEN** nothing is fetched and the call is marked failed with the reason "host not allowed"

#### Scenario: Oversized file
- **WHEN** the file exceeds the size limit
- **THEN** it is not stored and the call is marked failed with the reason "too large"

### Requirement: Existing recordings are collected while they still exist

The system SHALL collect audio for calls whose recording reference is already stored, newest first, applying the same rules. Calls whose source has already expired SHALL be marked source unavailable.

#### Scenario: Existing reference still valid
- **WHEN** the collection runs over a call with a stored reference whose file still exists
- **THEN** the audio is stored and recorded

#### Scenario: Existing reference expired
- **WHEN** the file is gone
- **THEN** the call is marked source unavailable

### Requirement: Capture is withheld until retention is configured

The system SHALL NOT fetch or store call audio while no retention period is configured, and SHALL show staff that audio capture is waiting for the setting. References already held SHALL NOT be dropped in that state.

#### Scenario: Retention not set
- **WHEN** a call ends and no retention period is configured
- **THEN** no audio is fetched, the call's recording reference is kept, and the admin surface shows audio capture is paused

#### Scenario: Retention set later
- **WHEN** the period is configured
- **THEN** pending calls are collected in order, newest first
