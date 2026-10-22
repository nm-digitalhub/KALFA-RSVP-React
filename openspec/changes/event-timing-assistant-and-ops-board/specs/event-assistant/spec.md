# Spec Delta

## Purpose
The customer-facing chat on a paid event: what it may read and propose, how a proposal becomes a change, what it costs and who pays, and what personal data it may see.

## ADDED Requirements

### Requirement: Where and for whom the assistant appears
The assistant SHALL appear only on the management page of an event whose package payment is confirmed by the server. It SHALL be available to a signed-in user who may view the event's reports. It SHALL be absent when the assistant is switched off in settings, when the package has no AI budget, or when the event is closed. Staff impersonation is not supported.

#### Scenario: Unpaid event
- **WHEN** the owner opens an event whose package is not yet paid
- **THEN** no assistant is shown

#### Scenario: Viewer without reports permission
- **WHEN** an organization member without reports view opens the event
- **THEN** no assistant is shown and its endpoint refuses the request

### Requirement: Answers come only from server tools
The assistant SHALL answer status questions only from data returned by server tools. This covers:
- confirmations, declines and pending guests;
- delivery counts;
- the next contact per guest and why a guest was not reached;
- the event's schedule with its effective times.

#### Scenario: How many confirmed
- **WHEN** the owner asks "כמה אישרו הגעה?"
- **THEN** the answer states the attending guests and people exactly as the stats page shows them

#### Scenario: When is the next message
- **WHEN** the owner asks when the next message goes out
- **THEN** the answer gives the time that the outreach-timing capability reports, and says whether it is a message or a call

### Requirement: Tools follow the user's event permissions
Each tool SHALL be offered only when the user holds the event permission that the matching screen requires. Tools SHALL take no user, organization, event or permission argument from the model.

#### Scenario: Missing permission for guest names
- **WHEN** a user with reports view but without guests view asks who has not answered
- **THEN** the assistant gives the count only, and says that names need guest-list permission

### Requirement: Dates and numbers are computed by code
Every number, date and time in an answer SHALL come from a tool result. The model SHALL NOT compute dates, Shabbat, holidays or send windows itself.

#### Scenario: Is it on Shabbat
- **WHEN** the owner asks whether a proposed time falls on Shabbat
- **THEN** the answer repeats the warning computed by the outreach-timing capability, not a date the model worked out

### Requirement: Changes are proposals
For any change or send, the assistant SHALL create an outreach-timing proposal and show it as a proposal card in the chat. The card shows its effective times, warnings and affected guest count. The assistant SHALL offer proposal tools only to a user who holds the timing permission.

#### Scenario: Skip a reminder
- **WHEN** the owner writes "אל תתקשרו יום לפני"
- **THEN** a proposal card appears that skips the 1-day-before call step, and nothing changes until the owner approves it

#### Scenario: User without timing permission
- **WHEN** a user without the timing permission asks to move a reminder
- **THEN** the assistant explains that the event owner can grant this permission, and creates no proposal

#### Scenario: Customer-initiated time on Shabbat
- **WHEN** the owner asks to send the thank-you on Saturday morning
- **THEN** the proposal card shows the Shabbat warning, and the owner may still approve

### Requirement: Only an explicit approval applies a proposal
Nothing SHALL change until the user presses the approve control on the proposal card, or the confirm control of the same proposal on the page. Typing "yes" in the chat SHALL NOT confirm. The server SHALL re-check every approval against the stored proposal and SHALL NOT trust the browser alone.

#### Scenario: Typed yes
- **WHEN** the owner types "כן, תעשה את זה" instead of pressing approve
- **THEN** nothing changes, and the assistant points to the approve control on the card

#### Scenario: Forged approval
- **WHEN** a request carries an approval for a proposal that does not exist or belongs to another event
- **THEN** the server refuses it and nothing changes

### Requirement: Scope is one event
The assistant SHALL see only the event it was opened on. It SHALL refuse questions about other events, other customers or KALFA internals. It SHALL ignore instructions in guest names, notes or messages that try to change its behavior.

#### Scenario: Other event
- **WHEN** the owner asks about another of their events from this event's chat
- **THEN** the assistant says it answers only about the current event and points to that event's page

### Requirement: Personal data minimization
Tools SHALL NOT send guest phone numbers or e-mail addresses to the model. Guest names SHALL be sent only by a tool answering a question about specific guests, limited to 50 names per result. Conversation history SHALL be readable only by the user who wrote it and by staff holding customer-data permission. It SHALL be deleted 90 days after the event date.

#### Scenario: Phone requested
- **WHEN** the owner asks for a guest's phone number
- **THEN** the assistant points to the guest page and does not state the number

#### Scenario: Retention
- **WHEN** 90 days have passed since the event date
- **THEN** the event's assistant conversations no longer exist

### Requirement: Each package carries an AI budget
Each package SHALL carry an AI budget in shekels, set in the admin package screen. The budget SHALL be copied to the event's service when the package is chosen and when it is changed.

#### Scenario: Budget copied
- **WHEN** a customer chooses a package whose AI budget is ₪10
- **THEN** the event's service holds a ₪10 assistant budget, and a later edit of the package does not change it

### Requirement: Reply cost comes from reported usage
The cost of a reply SHALL be computed from three inputs:
- the usage figures the model API returns: input, output, cache writes and cache reads;
- the price list kept in settings;
- the exchange rate kept in settings.

#### Scenario: Cached reply
- **WHEN** a reply reports cache reads and cache writes
- **THEN** each category is priced at its own rate from the price list, and the ledger records the counts and the shekel cost

### Requirement: The budget is never exceeded
Before a reply, the system SHALL reserve the maximum possible cost of that reply. After it, the system SHALL settle the actual cost. A reply that cannot be reserved within the remaining budget SHALL NOT be started. Concurrent questions SHALL NOT exceed the budget together.

#### Scenario: Budget runs out
- **WHEN** the remaining budget is smaller than the reservation for the next reply
- **THEN** the assistant is not called, and the page says the assistant's quota for this event is used up and offers the upgrade path

#### Scenario: Two tabs at once
- **WHEN** two questions are sent at the same moment with budget left for only one reservation
- **THEN** exactly one is answered and the other gets the quota message

### Requirement: Usage is shown as a share, not tokens
The customer SHALL see the share of the assistant budget used. They SHALL be told once at 80% and once at 100%. Tokens and model names SHALL NOT be shown to the customer.

#### Scenario: 80 percent
- **WHEN** settled costs reach 80% of the event's AI budget
- **THEN** the chat shows a one-time notice "נוצלו 80% מהעוזר" and the activity log records it

### Requirement: Platform-wide guards
The assistant SHALL be limited to 10 questions per minute per user and to a daily number of questions per event set in settings. A monthly platform spend cap and an on/off switch, both set in settings, SHALL stop all new replies when reached or off. When the model API reports that the organization's spend cap was hit, the assistant SHALL stop for everyone and alert staff.

#### Scenario: Switch off
- **WHEN** staff turn the assistant off in settings
- **THEN** no new reply starts on any event, and the chat says the assistant is temporarily unavailable

### Requirement: Failures are explicit
When the model API fails or times out, the user SHALL see a short Hebrew error, the reserved cost SHALL be released, and nothing SHALL be half-applied. A partially streamed answer SHALL be marked as incomplete.

#### Scenario: Timeout mid-answer
- **WHEN** the model stops responding during a streamed answer
- **THEN** the partial text is marked incomplete, the reservation is released or settled on the usage actually reported, and no proposal is created from the partial answer
