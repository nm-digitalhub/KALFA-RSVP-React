# Spec Delta

## Purpose

Every way to reach KALFA without a user session: guest links, call tokens, provider webhooks and the public
widget. For each, the credential that authorizes it, the one resource it may touch, and the protections that make
it hard to abuse.

## ADDED Requirements

### Requirement: Every entry point is declared, a sessionless one with its credential and scope
Every route handler, server-action module and edge function, and every page outside the signed-in areas, SHALL be
declared. A sessionless entry SHALL name its credential (token, provider signature, shared secret or none), the one
resource it may touch (a guest, an event, a call attempt, a workflow, or global), its rate limit and its audit
target. A session entry SHALL name its transport. An undeclared entry SHALL fail the build's checks.

#### Scenario: New public route without a declaration
- **WHEN** a route is added under a public or token path and is not declared
- **THEN** the check fails and names the route

#### Scenario: Token in a rate-limit key
- **WHEN** a declared entry point uses a raw token, instead of its fingerprint, in a rate-limit key
- **THEN** the check fails

#### Scenario: Server action without a declaration
- **WHEN** a server-action module is added in any area, under any file name, and is not declared
- **THEN** the check fails and names the module

#### Scenario: Route handler in a signed-in area without a declaration
- **WHEN** a route handler is added under the customer or admin area and is not declared
- **THEN** the check fails and names the route handler

#### Scenario: Edge function without a declaration
- **WHEN** a Supabase edge function is added to the repository and is not declared
- **THEN** the check fails and names the function

### Requirement: A token grants only its own resource
A guest link SHALL let its holder read and answer for that one guest. It SHALL let them see only the event details
and the opted-in attendee first names that the event shows publicly. A call token SHALL act only on its own call
attempt; its documented global effects (the do-not-call list, a discount offer, a sign-up link) are the exception.
An invalid, expired or revoked token SHALL get the same generic answer as one that does not exist.

#### Scenario: Token of another guest
- **WHEN** a holder of one guest's link tries to change another guest's answer
- **THEN** the request is refused with the generic not-found answer

#### Scenario: Call token under another purpose
- **WHEN** a call token is sent to an address that names a different call purpose than the token's own attempt
- **THEN** the request gets the generic not-found answer and nothing is written

#### Scenario: Gift or thank-you link
- **WHEN** a gift or thank-you link is opened
- **THEN** the page receives only the fields it shows, for that one event

### Requirement: Rate limits use the client address set by the trusted proxy
Rate limits and abuse caps keyed by client address SHALL use the address set by the trusted proxy. They SHALL NOT use
a value that the client can supply in a forwarding header.

#### Scenario: Forged forwarding header
- **WHEN** a client sends many verification-code requests, each with a different forged `X-Forwarded-For` value
- **THEN** they all count against the same client address, and the limit stops them

#### Scenario: Widget call cap under forged headers
- **WHEN** a visitor sends widget call requests, each with a different forged `X-Forwarded-For` value
- **THEN** the hourly per-address call cap counts them all against the one address the proxy saw

### Requirement: A recorded client address comes from the trusted proxy
A client address stored as evidence, such as the address recorded with a terms approval, SHALL be the address set by
the trusted proxy. A value that the client supplies in a forwarding header SHALL NOT be stored as that address.

#### Scenario: Terms approval with a forged header
- **WHEN** a customer approves the package terms with a forged `X-Forwarded-For` value
- **THEN** the stored approval holds the address the proxy saw

### Requirement: A session read permission never yields a write credential
A signed-in user's permission to view guests SHALL NOT let them read a guest's RSVP token, or any other credential
that allows writing on the guest's behalf. Only holders of the permission to edit guests SHALL obtain a guest's link,
through the server.

#### Scenario: Organization viewer reads guests through the API
- **WHEN** an organization member with view-only access reads the guest list directly through the database API
- **THEN** the guests' names are returned and their RSVP tokens are not

#### Scenario: Guest editor obtains a link
- **WHEN** a member allowed to edit guests opens a guest's link from the guest page
- **THEN** the link is shown

#### Scenario: Signed-in user reads inquiry tables through the API
- **WHEN** a signed-in user reads callback requests or contact messages directly through the database API
- **THEN** the request is refused and no intake or rating token is returned

### Requirement: Guest pages keep working after the RSVP token is hidden
Hiding the RSVP token from signed-in users SHALL NOT break any page that shows guests. An organization owner and an
organization viewer SHALL get the same guest totals, guest rows and over-invited filter results as before the token
was hidden.

#### Scenario: Owner opens the event, guests and stats pages
- **WHEN** an organization owner opens the event page, the guests page and the stats page after the token is hidden
- **THEN** each page shows the same guest totals as before

#### Scenario: Viewer filters over-invited guests
- **WHEN** an organization viewer filters the guest list to over-invited guests after the token is hidden
- **THEN** the matching guests are listed, without an error

#### Scenario: Owner adds and edits guests
- **WHEN** an organization owner adds a guest, imports guests or edits a guest's answer after the change
- **THEN** each write succeeds and the guest's over-invited flag follows the new values

### Requirement: Provider callbacks are verified before any effect
A webhook or provider callback SHALL verify its signature or shared secret, comparing in constant time, before it
reads or writes anything. A callback whose provider sends no signature SHALL fetch the true state from the provider
instead of trusting the payload.

#### Scenario: Wrong verification secret
- **WHEN** a subscription verification request arrives with a wrong secret
- **THEN** it is refused, and the comparison time does not depend on how much of the secret matched

#### Scenario: Repeated verification attempts
- **WHEN** many subscription verification requests arrive from one client address within the limit's window
- **THEN** the requests beyond the limit are refused

### Requirement: Token answers are not stored by caches
Every response to a request that carries a token in its path SHALL tell browsers and proxies not to store it,
including redirects and not-found answers.

#### Scenario: Gift redirect
- **WHEN** a gift link's redirect is requested, with a valid token and with an unknown one
- **THEN** both the redirect and the not-found answer carry a no-store instruction

### Requirement: Stored call credentials cannot be replayed from the database
The database SHALL hold a call token only as a one-way hash. A call whose token was issued before this rule took
effect SHALL keep working until its token expires.

#### Scenario: Database read of a call attempt
- **WHEN** a call attempt row is read from the database
- **THEN** no value in it can be presented as that call's token

#### Scenario: Call in flight during the change
- **WHEN** a call that started before the change asks for its context or reports its outcome after the change is deployed
- **THEN** the request is answered as it would have been before

#### Scenario: Call started during the rollout
- **WHEN** a call is created at any step of the change's rollout and then asks for its context
- **THEN** the request is answered with that call's context

### Requirement: A rating answer is audited
Each accepted rating SHALL record one audit row, without personal data, in the same transaction as the rating. A
refused rating SHALL record none.

#### Scenario: Rating accepted
- **WHEN** a valid rating link submits a score
- **THEN** the score and one audit row are stored together

#### Scenario: Rating re-submitted
- **WHEN** a rating link that was already used submits a new score
- **THEN** the new score replaces the old one, and one more audit row is stored

#### Scenario: Rating refused
- **WHEN** an unknown rating link submits a score
- **THEN** nothing is stored

### Requirement: A public RSVP answer and its headcount are written together
When a guest gives a new "attending" answer on the RSVP page, the answer and the guest's confirmed headcount SHALL be
written in one transaction. If either write fails, neither SHALL be stored. A new answer that arrives through any
other channel SHALL clear the confirmed headcount, so that the WhatsApp flow asks for it again.

#### Scenario: Attending with three people
- **WHEN** a guest answers "attending" on the RSVP page for two adults and one child
- **THEN** the answer and a confirmed headcount of 3 are stored together

#### Scenario: Headcount write fails
- **WHEN** the headcount write fails while a guest answers on the RSVP page
- **THEN** the answer is not stored either, and the guest gets the generic failure message

#### Scenario: New answer through another channel
- **WHEN** a guest's new answer arrives through a workflow or a WhatsApp reply
- **THEN** the guest's confirmed headcount is cleared, as it is today
