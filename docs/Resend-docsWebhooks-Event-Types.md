Event Types - Resend

> ## Documentation Index
> 
> Fetch the complete documentation index at: [/docs/llms.txt](/docs/llms.txt)
> 
> Use this file to discover all available pages before exploring further.

[Resend home page![light logo](https://mintcdn.com/resend/w4S5Jr48MiquhhSH/logo-black.svg?fit=max&auto=format&n=w4S5Jr48MiquhhSH&q=85&s=630be7deea6ea94cc7fc4560ea60a5ac)![dark logo](https://mintcdn.com/resend/w4S5Jr48MiquhhSH/logo-white.svg?fit=max&auto=format&n=w4S5Jr48MiquhhSH&q=85&s=3843916235739ffb9cb1d24683221341)](https://resend.com)

[Documentation

](/docs/introduction)[Guides

](/docs/knowledge-base/introduction)[API Reference

](/docs/api-reference/introduction)

Search...

Navigation

Webhooks

Event Types

# Event Types

Copy pageCopy page

List of supported event types and their payload.

Copy pageCopy page

## 

[​

](#email-events)

Email Events

[`email.bounced`](/docs/webhooks/emails/bounced)

Occurs whenever the recipient’s mail server **permanently rejected the email**.

[`email.clicked`](/docs/webhooks/emails/clicked)

Occurs whenever the **recipient clicks on an email link**.

[`email.complained`](/docs/webhooks/emails/complained)

Occurs whenever the email was successfully **delivered, but the recipient marked it as spam**.

[`email.delivered`](/docs/webhooks/emails/delivered)

Occurs whenever Resend **successfully delivered the email** to the recipient’s mail server.

[`email.delivery_delayed`](/docs/webhooks/emails/delivery-delayed)

Occurs whenever the **email couldn’t be delivered due to a temporary issue**. Delivery delays can occur, for example, when the recipient’s inbox is full, or when the receiving email server experiences a transient issue.

[`email.failed`](/docs/webhooks/emails/failed)

Occurs whenever the **email failed to send due to an error**. This event is triggered when there are issues such as invalid recipients, API key problems, domain verification issues, email quota limits, or other sending failures.

[`email.opened`](/docs/webhooks/emails/opened)

Occurs whenever the **recipient opened the email**.

[`email.received`](/docs/webhooks/emails/received)

Occurs whenever Resend **successfully receives an email**.

[`email.scheduled`](/docs/webhooks/emails/scheduled)

Occurs whenever the **email is scheduled to be sent**.

[`email.sent`](/docs/webhooks/emails/sent)

Occurs whenever the **API request was successful**. Resend will attempt to deliver the message to the recipient’s mail server.

[`email.suppressed`](/docs/webhooks/emails/suppressed)

Occurs whenever the **email is suppressed** by Resend.

## 

[​

](#domain-events)

Domain Events

[`domain.created`](/docs/webhooks/domains/created)

Occurs when a **domain was successfully created**.

[`domain.updated`](/docs/webhooks/domains/updated)

Occurs when a **domain was successfully updated**.

[`domain.deleted`](/docs/webhooks/domains/deleted)

Occurs when a **domain was successfully deleted**.

## 

[​

](#contact-events)

Contact Events

[`contact.created`](/docs/webhooks/contacts/created)

Occurs whenever a **contact was successfully created**.

_Note: When importing multiple contacts using CSV, these events won’t be triggered. [Contact support](https://resend.com/help) if you have any questions._

[`contact.updated`](/docs/webhooks/contacts/updated)

Occurs whenever a **contact was successfully updated**.

[`contact.deleted`](/docs/webhooks/contacts/deleted)

Occurs whenever a **contact was successfully deleted**.

[`contact.topics.updated`](/docs/webhooks/contacts/topics-updated)

Occurs whenever a **contact’s topic subscriptions change**.

## 

[​

](#suppression-events)

Suppression Events

[`suppression.added`](/docs/webhooks/suppressions/added)

Occurs whenever an **email address is added to your suppression list**, automatically after a hard bounce or spam complaint, or manually through the dashboard or API.

[`suppression.removed`](/docs/webhooks/suppressions/removed)

Occurs whenever an **email address is removed from your suppression list**.

## 

[​

](#topic-events)

Topic Events

[`topic.created`](/docs/webhooks/topics/created)

Occurs whenever a **topic is created**.

[`topic.updated`](/docs/webhooks/topics/updated)

Occurs whenever a **topic is updated**.

[`topic.deleted`](/docs/webhooks/topics/deleted)

Occurs whenever a **topic is deleted**.

## 

[​

](#inbox-events)

Inbox Events

Inboxes are in private beta. Every inbox event’s `data` has `source` and `inbox_id`, plus the IDs and objects that apply to the event. Keys that don’t apply are left out, not sent as `null`. The `thread`, `email`, `draft` and `inbox` objects are loaded when the webhook is sent, not when the change happened, so two quick changes can both show the second state. `email` and `draft` leave out `html` and `text`; fetch the body from the API. Retries keep the same `svix-id` header, so dedupe on it.

[`inbox.created`](/docs/webhooks/inboxes/created)

Occurs whenever an **inbox is created**.

[`inbox.updated`](/docs/webhooks/inboxes/updated)

Occurs whenever an **inbox’s settings change**.

[`inbox.deleted`](/docs/webhooks/inboxes/deleted)

Occurs whenever an **inbox is deleted**.

[`inbox.thread.created`](/docs/webhooks/inboxes/thread-created)

Occurs whenever the **first email of a thread** lands in the inbox, inbound or outbound.

[`inbox.thread.folder.updated`](/docs/webhooks/inboxes/thread-folder-updated)

Occurs whenever a **thread moves between folders**.

[`inbox.thread.assigned`](/docs/webhooks/inboxes/thread-assigned)

Occurs whenever a **thread is assigned or reassigned**.

[`inbox.thread.unassigned`](/docs/webhooks/inboxes/thread-unassigned)

Occurs whenever a **thread is unassigned**.

[`inbox.thread.labels.updated`](/docs/webhooks/inboxes/thread-labels-updated)

Occurs whenever a **label is applied to or removed from a thread**.

[`inbox.email.received`](/docs/webhooks/inboxes/email-received)

Occurs whenever an **inbound email is added to a thread**.

[`inbox.email.sent`](/docs/webhooks/inboxes/email-sent)

Occurs whenever an **outbound email is accepted for delivery** and added to a thread.

[`inbox.draft.created`](/docs/webhooks/inboxes/draft-created)

Occurs whenever a **draft is created**, standalone or reply.

[`inbox.draft.updated`](/docs/webhooks/inboxes/draft-updated)

Occurs whenever a **draft is edited**.

[`inbox.draft.sent`](/docs/webhooks/inboxes/draft-sent)

Occurs whenever a **draft is sent**.

[`inbox.draft.deleted`](/docs/webhooks/inboxes/draft-deleted)

Occurs whenever a **draft is discarded**.

Was this page helpful?

YesNo

⌘I

Assistant

Responses are generated using AI and may contain mistakes.