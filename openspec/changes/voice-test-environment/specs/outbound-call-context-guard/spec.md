# Spec Delta

## Purpose

Keeps an outbound RSVP call from reaching a guest when the system cannot prove what the call is about, and keeps the
agent from promising a saved reply the system did not confirm.

## ADDED Requirements

### Requirement: No dial without the call's context
The outbound RSVP bridge SHALL dial the guest only after the context route answered with the call's context. Any
other answer, a failed request or an unreadable body SHALL end the session without dialling.

#### Scenario: Context answered
- **WHEN** the context route answers 200 with the call's context
- **THEN** the guest is dialled and the agent receives the context

#### Scenario: Context refused
- **WHEN** the context route answers 404 (closed event, terminal attempt, expired token or an unknown token)
- **THEN** the guest is not dialled and the session log records the refusal without the token
- **AND** the call attempt is reported closed as `failed`, with the refusal as its finish reason

#### Scenario: Context unreachable
- **WHEN** the context request fails, its body cannot be parsed, or the call data carries no app origin
- **THEN** the guest is not dialled and the call attempt is reported closed as `failed`

### Requirement: An unrecognised save result is a failure
When the save route answers 200 with a status other than `saved`, `rejected` or `queued`, the bridge SHALL report
`error` to the agent, so the agent uses its tool-failure wording instead of saying the reply will be updated.

#### Scenario: Unknown status
- **WHEN** the save route answers 200 with a status the bridge does not recognise, or with no status
- **THEN** the agent receives `error` and does not tell the guest the reply was recorded

#### Scenario: Known statuses unchanged
- **WHEN** the save route answers 200 with `saved`, `rejected` or `queued`
- **THEN** the agent receives that same status, as today
