# package-outreach-admission Specification

## Purpose

Defines how the guests of an event with a running fixed-price package reach its outreach list: admission when a guest is added, the package quota enforced at that point, the order of addition, recovery from a missed admission, and the outreach status the owner sees for each guest.

## Requirements

### Requirement: Guests can be added at any time after purchase
The system SHALL let the owner add guests at any time after the purchase. Each added guest SHALL be approached on the package's schedule, up to the package quota, without any customer action beyond adding the guest. The package quota SHALL be enforced when guests are added, not at purchase, and the purchase SHALL NOT require any guest.

#### Scenario: Guest added after purchase
- **WHEN** the owner adds a guest after the purchase and the quota is not reached
- **THEN** the guest is on the outreach list and receives the next scheduled messages

#### Scenario: Every way of adding guests
- **WHEN** the owner adds guests one by one, by a file import or by a WhatsApp import
- **THEN** each guest within the quota is put on the outreach list in the order the guests were added

#### Scenario: Guest added beyond the quota
- **WHEN** the owner adds a guest after the quota is reached
- **THEN** the guest is added to the event and the owner sees, on that guest, that the guest is beyond the package quota

### Requirement: Each guest's outreach status is shown and distinguishable
The system SHALL show the owner of an event with a running package, for each guest, whether the guest is on the outreach list, and when not, why. It SHALL distinguish a guest beyond the quota from a guest with no valid phone, a guest whose contact was not linked, a guest who asked not to be contacted and a guest whose admission is still pending, and SHALL NOT label any of those as beyond the quota.

#### Scenario: Beyond the quota
- **WHEN** a guest is eligible, not on the list, and the list is full
- **THEN** the guest is marked as beyond the package quota

#### Scenario: Not on the list for another reason
- **WHEN** a guest has no valid phone, has an unlinked contact, asked not to be contacted, or is eligible while the list still has room
- **THEN** the guest shows that specific reason and not "beyond the quota"

#### Scenario: No running package
- **WHEN** the event has no running package
- **THEN** no outreach status marker is shown

### Requirement: The outreach list recovers from a missed admission
The system SHALL bring every eligible guest within the quota onto the outreach list of a running package even when the admission at the moment of adding did not happen, whether because it failed or because it was switched off. The recovery SHALL follow the order in which guests were added and SHALL NOT exceed the quota.

#### Scenario: Admission failed when the guest was added
- **WHEN** a guest within the quota was added but was not put on the outreach list at that moment
- **THEN** the guest is put on the list shortly afterwards, without any action by the owner

#### Scenario: Contact link failed when the guest was added
- **WHEN** a guest with a valid phone was added but the guest was not linked to a contact
- **THEN** the link is repaired and the guest is admitted within the quota shortly afterwards, without any action by the owner

#### Scenario: A seat is freed
- **WHEN** a guest on the outreach list who has not yet been approached is removed, and other guests are waiting beyond the quota
- **THEN** the first waiting guest by order of addition takes the freed seat, even when another guest is being added at the same moment

#### Scenario: Admission switch is off
- **WHEN** the admission switch is off and a guest is added, removed or changes phone on an event with a running package
- **THEN** the outreach list still follows the quota and the order of addition, and the removal is recorded in the list's history

#### Scenario: A guest who was already approached is removed
- **WHEN** a guest who was already approached is removed
- **THEN** the seat stays counted, no waiting guest is admitted in its place, and the removed guest receives no further outreach
