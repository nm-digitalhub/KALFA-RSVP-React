# Spec Delta

## Purpose

Defines how a guest's answer, given to the RSVP voice agent during a call, reaches that guest's record. The agent saves
it through a server-side tool, under the call's own authorization, and the agent only claims a save that actually
happened.

## ADDED Requirements

### Requirement: Server-side save tool
The RSVP voice agent SHALL save a guest's confirmed answer by calling a KALFA endpoint directly from ElevenLabs. The
call SHALL NOT be relayed through the telephony bridge. The body SHALL carry the status (`attending`, `declined` or
`maybe`) and the adults and children counts.

#### Scenario: Agent saves without the bridge
- **WHEN** the agent runs its save tool after the guest confirms the read-back
- **THEN** KALFA receives the request from ElevenLabs
- **AND** the Voximplant scenario takes no part in that request

#### Scenario: Invalid body is refused
- **WHEN** the body has no status, an unknown status, a count outside 0-50, an extra field, or `attending` with zero
  people
- **THEN** the endpoint answers 400
- **AND** nothing is stored

### Requirement: Per-call authorization
The endpoint SHALL accept a request only when it carries the call's opaque access token in a request header. That token
SHALL resolve to an existing call attempt whose token has not expired, and SHALL pass the rate limit. Identity SHALL be
that attempt. It SHALL never be taken from the body or from the correlation nonce.

#### Scenario: Missing, unknown or expired token
- **WHEN** the header is absent, longer than 256 characters, unknown, or belongs to an attempt whose token has expired
- **THEN** the endpoint answers 404 with an empty body
- **AND** nothing is stored

#### Scenario: Rate limit exceeded
- **WHEN** more than 30 requests for the same token and source arrive within 5 minutes
- **THEN** the endpoint answers 429
- **AND** nothing is stored

#### Scenario: Body names another guest
- **WHEN** a valid token's request body contains any identifier
- **THEN** the identifier is rejected as an unknown field
- **AND** the answer can never be written to a guest other than the one bound to the token's attempt

### Requirement: Truthful three-state answer
A request that passes authorization and validation SHALL return HTTP 200 with `{ok, status}`. `status` SHALL be one of:
- `saved`: the answer was applied;
- `rejected`: refused on business grounds, with a `reason`, and never retried;
- `queued`: a transient failure, with the durable copy retried later.

`ok` SHALL be true only for `saved`.

#### Scenario: Answer applied
- **WHEN** the guest's event accepts answers and the write succeeds
- **THEN** the response is `{"ok": true, "status": "saved"}`
- **AND** the guest row shows the status and counts

#### Scenario: Event no longer accepts answers
- **WHEN** the apply is refused because the event is closed or past its deadline
- **THEN** the response is `{"ok": false, "status": "rejected", "reason": ...}`
- **AND** the guest row is unchanged

#### Scenario: Transient failure
- **WHEN** the apply throws because of a transport or database error
- **THEN** the response is `{"ok": false, "status": "queued"}`
- **AND** the stored copy is applied by the retry drain

### Requirement: Durable, idempotent capture
Before applying, the endpoint SHALL store each distinct answer for the attempt once. The dedupe key SHALL be the one the
bridge path uses for the same attempt and values, so an answer delivered by both paths is stored and applied once.

#### Scenario: Same answer twice
- **WHEN** the same status and counts arrive twice for one attempt, by either path
- **THEN** one inbox row exists for them

#### Scenario: Corrected answer
- **WHEN** a different status or count arrives later in the same call
- **THEN** it is stored as its own row
- **AND** the later answer is the one applied

#### Scenario: Store failure
- **WHEN** the durable store fails
- **THEN** the endpoint answers 500
- **AND** the agent hears a tool failure, never a save

### Requirement: Token kept from the LLM and from stored payloads
The bridge SHALL pass the access token to ElevenLabs only as a `secret__`-prefixed dynamic variable bound to the tool's
header. Before storing a post-call webhook payload, KALFA SHALL remove every `secret__`-prefixed dynamic variable from
it.

#### Scenario: Token not in the prompt
- **WHEN** a conversation starts with the token variable
- **THEN** the variable is not referenced by the system prompt, the first message, or any LLM-filled tool parameter

#### Scenario: Post-call payload stored without the token
- **WHEN** a post-call transcription webhook for that conversation is stored in the webhook inbox
- **THEN** the stored payload contains no `secret__`-prefixed dynamic variable
- **AND** the other dynamic variables are stored unchanged

### Requirement: Staged rollout
The webhook save tool SHALL reach Main only after a recorded test call on the test branch shows all three of:
- the tool was executed;
- the guest row was written;
- a matching inbox row exists.

Until then, Main SHALL keep the client save tool and live calls SHALL not carry the token variable.

#### Scenario: Live call before the merge
- **WHEN** a guest call runs on Main before the merge gate passes
- **THEN** its dynamic variables include no `secret__` token
- **AND** its save path is the client tool through the bridge

#### Scenario: Test call fails to save
- **WHEN** the test call ends without the webhook tool in the conversation's executed tools
- **THEN** Main is not changed
- **AND** the result is recorded as evidence that the webhook did not fix the missing save

### Requirement: Single save path after the merge
Once Main runs the webhook save tool, the client save tool and its bridge route SHALL be retired. The agent SHALL be
offered exactly one save tool on every branch.

#### Scenario: Client route after retirement
- **WHEN** a request reaches the retired bridge save route after the retirement deploy
- **THEN** the route no longer exists (404)

#### Scenario: One save tool per branch
- **WHEN** any branch of the RSVP agent is read back
- **THEN** its tool list holds exactly one tool that saves an RSVP
