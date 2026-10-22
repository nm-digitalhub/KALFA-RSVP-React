# Spec Delta

## Purpose
Upgrading the package of an event's service after the customer has approved its terms or paid for it. The customer or KALFA staff may start an upgrade, but only the customer may approve it. The upgraded package takes effect only after approval and the required payment. Until then the service keeps running on the current package. Downgrades and refunds are outside this capability.

## ADDED Requirements

### Requirement: When an upgrade is available
An upgrade SHALL be possible only for a service that is not closed. All of the following must hold:
- the campaign status is approved, scheduled, active or paused;
- the event date has not passed;
- no cancellation request is open;
- no payment of the campaign is pending or in review;
- no other upgrade of the campaign is open.

Before approval (pending_approval) the existing package change applies instead.

#### Scenario: Closed service
- **WHEN** an upgrade is started for a campaign whose status is closed or cancelled
- **THEN** it is refused, and nothing is recorded as an offer

#### Scenario: Second open upgrade
- **WHEN** an upgrade is started while another upgrade of the same campaign is still open
- **THEN** it is refused; the open upgrade is unchanged

#### Scenario: Payment in review
- **WHEN** an upgrade is started while a payment of the campaign is in review
- **THEN** it is refused until a person resolves that payment

### Requirement: What counts as an upgrade
The target package SHALL be one the catalogue offers for purchase at that moment, by the same rule the purchase uses. Compared with the current package, it SHALL have:
- a contact quota at least as large;
- every channel of the current package;
- a price for this customer higher than the net amount already paid for the service.

Any other target SHALL be refused as a downgrade or a lateral change.

#### Scenario: Package withdrawn before payment
- **WHEN** staff deactivate the target package after the owner approved the upgrade and before payment
- **THEN** the payment is refused, the upgrade is cancelled with that reason, any held upgrade benefit is released, and the current package stays

#### Scenario: Smaller quota
- **WHEN** the target package has a smaller contact quota than the current one
- **THEN** the upgrade is refused as a downgrade

#### Scenario: Channel removed
- **WHEN** the current package includes calls and the target package does not
- **THEN** the upgrade is refused as a downgrade

### Requirement: Who may start an upgrade
The event owner SHALL be able to start an upgrade from the event's service page, under the same rule that lets them buy the package. Staff holding the "manage billing" permission SHALL be able to offer an upgrade to the customer from the admin panel. No one else SHALL be able to start one.

#### Scenario: Org member without ownership
- **WHEN** an organization member who is not the event owner tries to start an upgrade
- **THEN** it is refused, as buying a package is refused to them today

#### Scenario: Staff without manage billing
- **WHEN** a staff member without "manage billing" tries to offer an upgrade
- **THEN** it is refused and no offer is recorded

### Requirement: The customer approves every upgrade
An upgrade SHALL take effect only after the event owner approves it. Before approving, the owner SHALL see:
- the current and the new package;
- the new contact quota and channels;
- the remaining schedule;
- the exact amount to pay;
- the package agreement version.

Staff SHALL NOT approve, pay for or apply an upgrade on the customer's behalf.

#### Scenario: Staff offer waits for the customer
- **WHEN** staff offer an upgrade
- **THEN** the service is unchanged; the owner sees the offer and its amount on the event's service page

#### Scenario: Approval records the agreement
- **WHEN** the owner approves an upgrade
- **THEN** the approval time, the approving user and the agreement version are recorded on the upgrade

### Requirement: Upgrade before any payment
When the campaign has no collected payment, approving an upgrade SHALL switch the package in one transaction:
- a new pricing round at the customer's full price for the new package;
- the service's package fields;
- a reset of the terms consent.

The owner then approves the terms and pays the full price through the regular purchase.

#### Scenario: Approved but unpaid
- **WHEN** an owner whose terms are approved but who has not paid approves an upgrade
- **THEN** the campaign returns to awaiting approval with the new package and its full price, and no upgrade charge is created

### Requirement: Upgrade after payment pays only the difference
When the campaign has collected payment, the amount due SHALL be the customer's price for the new package minus the net amount paid for the service. The net amount is all succeeded collections minus every refund that has not failed. The amount SHALL be computed on the server.

#### Scenario: No benefit
- **WHEN** the owner paid 1,000 for the current package and the new package costs 1,500
- **THEN** the amount due is 500

#### Scenario: Partial refund before the upgrade
- **WHEN** the owner paid 1,000, received a refund of 100, and the new package costs 1,500
- **THEN** the amount due is 600

### Requirement: Effect of a previous benefit on the price
The customer's price for the new package SHALL come from the benefit applied to the current pricing round, when that benefit has a frozen option for the new package. Otherwise it SHALL be the new package's catalog price at approval. No other purchase benefit SHALL apply to an upgrade; an upgrade benefit applies only as its own requirement states.

#### Scenario: The benefit covers the new package
- **WHEN** the owner paid 800 (1,000 less a benefit of 200) and the benefit's option for the new package is 1,300
- **THEN** the amount due is 500

#### Scenario: The benefit does not cover the new package
- **WHEN** the owner paid 800 with a benefit, the benefit has no option for the new package, and the new package's catalog price is 1,500
- **THEN** the amount due is 700, and the approval screen states that the benefit does not apply to the new package

### Requirement: Upgrade benefits are a separate kind of benefit
Staff SHALL be able to give an upgrade benefit from the existing benefit offer and assignment screens, under "manage billing". An upgrade benefit SHALL be:
- marked for upgrades;
- limited to listed target packages;
- assigned to one account for one event's service.

It SHALL never apply to a package purchase, and a purchase benefit SHALL never apply as an upgrade benefit.

#### Scenario: Upgrade benefit at purchase
- **WHEN** an account that holds only an upgrade benefit buys a package
- **THEN** the purchase is priced without it, and the benefit stays assigned

#### Scenario: Target package not listed
- **WHEN** the owner upgrades to a package the upgrade benefit does not list
- **THEN** the benefit does not apply, and the approval screen does not show it

#### Scenario: Another event's service
- **WHEN** an upgrade benefit was assigned for one event and the owner upgrades another event
- **THEN** the benefit does not apply

### Requirement: An upgrade benefit discounts the difference only
An upgrade benefit SHALL be computed on the amount due, after the price rule of the previous benefit. Its percentage or fixed amount SHALL be frozen when it is assigned. The amount due after it SHALL stay above zero, as for every benefit.

#### Scenario: Percentage on the difference
- **WHEN** the amount due is 500 and the upgrade benefit is 20%
- **THEN** the discount is 100 and the owner pays 400

#### Scenario: Fixed amount that would reach zero
- **WHEN** the amount due is 300 and the upgrade benefit is a fixed 300
- **THEN** the benefit is not applied, and the approval screen states why

### Requirement: No double discount on an upgrade
At most one upgrade benefit SHALL apply to one upgrade. When several apply, the one with the lowest amount to pay SHALL be used. The previous purchase benefit SHALL count only through the price of the new package, never again as a discount on the difference.

#### Scenario: Two upgrade benefits
- **WHEN** the owner holds two upgrade benefits for the same service and target package
- **THEN** only the one that leaves the lower amount to pay applies, and the other stays assigned

#### Scenario: Purchase benefit not applied twice
- **WHEN** the purchase benefit's option already priced the new package
- **THEN** the amount due is not reduced by that benefit again

### Requirement: The owner sees and approves the final amount
Before approving, the owner SHALL see:
- the difference before the upgrade benefit;
- the benefit and its discount;
- the final amount to pay.

The final amount SHALL be stored with the approval, and the upgrade benefit SHALL be held for that upgrade from then on.

#### Scenario: Approval with an upgrade benefit
- **WHEN** the owner approves an upgrade with an upgrade benefit
- **THEN** the stored amount is the final amount shown, and the benefit is held by this upgrade

### Requirement: An upgrade benefit is used only by a succeeded payment
An upgrade benefit SHALL be marked used only when the payment of the upgrade it is held by succeeds. After a decline it SHALL stay held while the upgrade can be retried. When the upgrade expires or is cancelled it SHALL be released to the account, unless the benefit itself has expired. Staff SHALL NOT void it while an approved upgrade holds it.

#### Scenario: Payment succeeds
- **WHEN** the upgrade payment succeeds
- **THEN** the upgrade benefit is marked used, with the payment recorded on its history

#### Scenario: Upgrade expires
- **WHEN** an approved upgrade with an upgrade benefit expires unpaid
- **THEN** the benefit is released and can be used for a new upgrade while it is valid

#### Scenario: Void while held
- **WHEN** staff try to void an upgrade benefit held by an approved upgrade
- **THEN** the void is refused with the reason that an upgrade holds it

### Requirement: The approved amount is fixed
The amount due SHALL be stored when the owner approves, and the payment SHALL charge exactly the stored amount. A later change to a catalog price SHALL NOT change an approved upgrade. An offer or an approved upgrade that is not paid SHALL expire after the period set in the admin settings, and never later than the event date.

#### Scenario: Catalog price changes after approval
- **WHEN** staff change the new package's catalog price after the owner approved the upgrade
- **THEN** the payment charges the stored amount

#### Scenario: Expired upgrade
- **WHEN** the owner tries to pay for an upgrade after it expired
- **THEN** no charge is made; the owner may start a new upgrade

### Requirement: The new package takes effect only after payment
After payment, the upgraded package SHALL take effect only when the upgrade payment is recorded as succeeded. One transaction, exactly once, SHALL:
- record a new pricing round at the customer's price for the new package;
- switch the service's package fields;
- record the quota change;
- mark the upgrade applied.

#### Scenario: Settlement repeated
- **WHEN** the payment provider confirms the same upgrade payment twice
- **THEN** the upgrade is applied once and the second confirmation changes nothing

### Requirement: Failure keeps the current package
A declined payment, a cancelled upgrade or an expired upgrade SHALL leave the current package, price, quota and schedule unchanged. After a decline, the owner MAY retry while the upgrade has not expired. A payment in review SHALL hold the upgrade until a person resolves it. Only a resolution as succeeded SHALL apply it.

#### Scenario: Card declined
- **WHEN** the upgrade payment is declined
- **THEN** the service continues on the current package and the owner may retry

#### Scenario: Review resolved as failed
- **WHEN** a person resolves an upgrade payment in review as failed
- **THEN** the upgrade is not applied and the current package stays

### Requirement: A running service is not interrupted
While an upgrade payment is pending or in review, the service's payment state SHALL stay as it was before the upgrade. Its stage, sending, calls and every gate that depends on "paid" SHALL be unaffected. The pending upgrade SHALL be shown separately to the owner and to staff.

#### Scenario: Upgrade charge in flight
- **WHEN** a paid, running service has an upgrade charge pending
- **THEN** its payment state still reads paid, messages and calls continue, and the owner sees "upgrade awaiting payment"

### Requirement: The new quota is the total quota
The new package's contact quota SHALL be the service's total quota. Contacts already admitted to the service SHALL count within it. When the upgrade is applied, contacts that were waiting for a free place SHALL be admitted up to the new quota.

#### Scenario: Waiting guests admitted
- **WHEN** a service with quota 100 has 100 admitted contacts and 20 waiting, and it is upgraded to quota 150
- **THEN** the 20 waiting contacts are admitted, and the service has 30 free places

### Requirement: Past contact is kept and not repeated
Messages and calls already performed SHALL be kept and SHALL NOT be sent again. The remaining schedule SHALL be planned again from the new package's schedule and the event date. Per-event changes the customer made SHALL be kept for steps that exist in the new package. A new step whose time has already passed SHALL be skipped and recorded as skipped, not sent late.

#### Scenario: Step already sent
- **WHEN** a guest already received the 14-day message and the new package also has a 14-day message
- **THEN** the guest does not receive it again

#### Scenario: New step already past
- **WHEN** the new package adds a 21-day step and the event is 10 days away
- **THEN** the step is recorded as skipped because it was added after its time, and nothing is sent for it

#### Scenario: Customer's change kept
- **WHEN** the customer had moved the 7-day step and the new package has a 7-day step
- **THEN** the moved time still applies after the upgrade

### Requirement: Upgrade history
Every offer, approval, payment attempt, application, decline, expiry and cancellation of an upgrade SHALL be recorded. Each record SHALL hold the time, the acting user, and whether the customer or staff started the upgrade. The previous package, price and quota SHALL remain readable after an upgrade. Staff and the event owner SHALL see the history of their scope.

#### Scenario: History after an upgrade
- **WHEN** an upgrade has been applied
- **THEN** the previous package, its pricing round, the upgrade, its approval, its payment and the quota change are all readable, linked to each other

### Requirement: The receipt names the upgrade
The upgrade payment SHALL produce a receipt line naming the previous and the new package, for the difference charged.

#### Scenario: Receipt for an upgrade
- **WHEN** an upgrade payment succeeds
- **THEN** the receipt shows one line, "שדרוג חבילה" from the previous package to the new one, at the amount charged
