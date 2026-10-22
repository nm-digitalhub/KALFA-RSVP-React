# Spec Delta

## Purpose
The platform-staff board of customer events: one place to see every event's stage, progress, next contact and problems. It also holds the manual staff tasks attached to each event, and it updates live.

## ADDED Requirements

### Requirement: Board of events for staff
The board SHALL list every customer event as one row, grouped by lifecycle stage:
- in setup;
- awaiting payment;
- service running;
- event passed;
- closed.

A row's stage SHALL be derived on the server from the same stage model the customer pages use. It SHALL NOT be stored or edited on the board. Access SHALL require the staff "view events" permission. Test events SHALL be listed only behind an explicit filter.

#### Scenario: Staff without view events
- **WHEN** a staff member without "view events" opens the board
- **THEN** access is denied like any other admin page that needs the key

#### Scenario: Stage follows the data
- **WHEN** an event's package payment is confirmed
- **THEN** the row moves from "awaiting payment" to "service running" without anyone editing the board

### Requirement: Derived, read-only columns
Each row SHALL show:
- event name, date and days until the event;
- stage;
- guests and answer counts (attending, declined, pending);
- outreach progress (reached of total);
- the next contact time, from the outreach-timing capability;
- open problems: failed deliveries, wrong numbers, open callback requests, a thank-you that will not be sent.

#### Scenario: Next contact agrees with the customer page
- **WHEN** the customer page shows Monday 11:20 as an event's next contact
- **THEN** the board row shows the same time

### Requirement: Customer-data columns follow staff permissions
Columns that reveal customer data SHALL be absent, not empty, for a viewer without the matching staff permission. This follows the admin event page's rule.

#### Scenario: Viewer without customer-data permission
- **WHEN** a staff member with "view events" but without "view customer data" opens the board
- **THEN** the guest and outreach columns are not rendered at all

### Requirement: Filtering and sorting
The board SHALL support filtering and sorting:
- filter by stage, by date range, by "has problems", and by assignee of open tasks;
- sort by event date and by next contact.

#### Scenario: Problems filter
- **WHEN** staff filter by "has problems"
- **THEN** only events with at least one open problem are listed, each problem counted in its column

### Requirement: Manual staff tasks per event
Staff with the task-management permission SHALL be able to create, edit, assign, re-date, change the status of, and close tasks on an event. A task has:
- a title;
- an optional description;
- a status: to do, in progress, waiting or done;
- an optional assignee from platform staff;
- an optional due date.

#### Scenario: Assign a task
- **WHEN** a staff member with task management assigns "לבדוק מספרים שגויים" to a colleague with a due date
- **THEN** the event row shows one open task with that assignee and date, and the assignee's filter lists it

### Requirement: Task notes are append-only
Every task SHALL keep a history of notes, each with author and time. A note SHALL NOT be edited or deleted.

#### Scenario: Edit a note
- **WHEN** anyone tries to change or delete an existing note
- **THEN** the change is refused and the note stays as written

### Requirement: Task visibility
Staff with "view events" only SHALL see tasks and notes but not change them. Tasks and notes SHALL never be visible to customers.

#### Scenario: Read-only viewer
- **WHEN** a staff member with "view events" but without task management opens a task
- **THEN** the task and its notes are shown without edit controls, and a direct change attempt is refused

### Requirement: Overdue tasks
A task whose due date has passed without "done" SHALL be shown as overdue.

#### Scenario: Overdue
- **WHEN** a task's due date passes and its status is not done
- **THEN** the row and the task show it as overdue

### Requirement: Task permission is managed from the panel
Task management SHALL be a platform permission in the existing permission catalog. Staff roles SHALL be granted it from the existing roles screen. No code path SHALL grant it by role name.

#### Scenario: Granting
- **WHEN** an owner grants task management to a staff role in the roles screen
- **THEN** members of that role can edit tasks without a deploy

### Requirement: Live updates without personal data on the wire
An open board SHALL refresh when any of these changes:
- an event or its service;
- a guest's answer;
- an outreach step;
- a task or note.

The live signal SHALL carry no event or guest data. It SHALL tell the page to re-read from the server, and only staff holding "view events" SHALL receive it. If the live connection drops, the board SHALL re-read on reconnect.

#### Scenario: Guest answers while the board is open
- **WHEN** a guest confirms attendance while a staff member has the board open
- **THEN** the row's counts update without a manual reload

#### Scenario: Customer cannot listen
- **WHEN** a signed-in customer tries to join the board's live channel
- **THEN** the join is refused

### Requirement: Owners have no board
Event owners SHALL NOT see a board. Their event's management page SHALL show:
- a short summary: stage, attending / declined / pending, next contact, and anything that needs their attention;
- the event assistant.

#### Scenario: Owner view
- **WHEN** the owner opens a paid event
- **THEN** they see the summary and the assistant, and no task, assignee or board view
