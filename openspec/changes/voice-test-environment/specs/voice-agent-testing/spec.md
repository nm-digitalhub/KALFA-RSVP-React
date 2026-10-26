# Spec Delta

## Purpose

Lets an ElevenLabs voice-agent change be tried, by automated tests and by one real test call with real event context,
before any guest hears it.

## ADDED Requirements

### Requirement: Each agent has a test branch that takes no live traffic
Each of the four production voice agents SHALL have one test branch created from its Main version. The test branch
SHALL receive 0% of live traffic, and Main SHALL keep 100%, until a change is merged.

#### Scenario: Traffic after the branch exists
- **WHEN** the traffic deployment of an agent is read after its test branch was created
- **THEN** Main holds 100% and the test branch holds 0%

#### Scenario: A worker call
- **WHEN** the worker places a production call through any agent
- **THEN** the conversation runs on Main, whatever the test branch contains

### Requirement: An agent change is pushed to the test branch first
A change to an agent's configuration SHALL be pushed to its test branch before it reaches Main, and SHALL reach Main
only by a merge.

#### Scenario: Pushing a change
- **WHEN** an agent's configuration is changed for testing
- **THEN** the new version is created on the test branch and Main's latest version is unchanged

### Requirement: A merge to Main needs the test gates to pass
A merge from a test branch to Main SHALL require every test attached to the agent to pass on the test branch, and one
recorded test call on the branch to be transcribed from its audio and reviewed.

#### Scenario: A failing attached test
- **WHEN** an attached test fails on the test branch
- **THEN** the change is not merged to Main

#### Scenario: The save-before-confirm regression test
- **WHEN** the RSVP agent's attached tests run
- **THEN** one of them fails if the agent says the reply is saved before `save_rsvp` returned `saved`

### Requirement: A test call can be routed to the test branch
The ops test-call launcher SHALL let the operator route a single test call to an agent's test branch. Only the
launcher SHALL be able to choose a branch; a value that is not an ElevenLabs branch id SHALL be refused before dialling.

#### Scenario: A branch chosen
- **WHEN** the operator places a test call with the test branch id
- **THEN** the ElevenLabs conversation runs on that branch

#### Scenario: A malformed branch value
- **WHEN** the operator passes a value that is not an ElevenLabs branch id
- **THEN** the launcher refuses and no call is placed

#### Scenario: No branch chosen
- **WHEN** a call is placed without a branch, by the worker or by the launcher
- **THEN** the conversation runs on Main

### Requirement: A permanent test event gives a test call real context
A test event owned by the owner's staff account SHALL exist, active with a future date, marked as a test event, with
the owner's own number as its only guest. A test call on it SHALL receive the same context and save behaviour a real
guest's call receives.

#### Scenario: Context on a test call
- **WHEN** a test call is placed for the test event's guest
- **THEN** the agent receives the guest's name and the event's name, date, time and venue

#### Scenario: Saving on a test call
- **WHEN** the owner confirms attendance on a test call
- **THEN** the reply is saved to the test event and nothing changes on any other event

#### Scenario: Only the owner can be dialled
- **WHEN** a test call is requested to any number that is not on the test-number allowlist
- **THEN** the launcher refuses and no call is placed

#### Scenario: Marked as a test
- **WHEN** the test event is listed for staff
- **THEN** it shows as a test event and can be purged by the existing purge
