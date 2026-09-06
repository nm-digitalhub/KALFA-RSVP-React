/goal Investigate and design a safe fix for ambiguous WhatsApp inbound-message attribution and billing.

1.Use ctx7  /websites/developers_facebook_business-messaging_whatsapp to retrieve the current official Meta WhatsApp Business Platform documentation before drawing conclusions.

2. Resolve the library ID for:
    * Meta WhatsApp Business Platform
    * Facebook Business Messaging WhatsApp

   
3. Query the documentation separately for:
    * Incoming messages webhook payloads.
    * messages[].id, messages[].from and metadata.phone_number_id.
    * messages[].context.id and its availability or absence in free-form messages.
    * Interactive button_reply, list_reply and template quick-reply payloads.
    * Status webhooks and biz_opaque_callback_data.
    * Webhook retries, duplicate delivery and idempotency recommendations.
    * The scope and limitations of Click-to-WhatsApp referral and automatic_events.
5. Include the exact Meta documentation URL supporting every external claim.
6. Clearly distinguish:
    * Facts explicitly documented by Meta.
    * Conclusions proven from this repository.
    * Inferences.
    * Questions that remain unverified.

The relevant Cloud API send endpoint is:

POST https://graph.facebook.com/{API_VERSION}/{PHONE_NUMBER_ID}/messages

Do not use:

https://facebook.com{phone-number-id}/messages

Authentication and general message-sending setup are secondary to this investigation. Briefly verify them only if they affect tenant identification, phone_number_id, message IDs, contextual replies, or webhook processing.

Primary bug to investigate:

The current phone fallback appears to resolve an inbound message by finding every contact with the sender’s normalized phone number and selecting the most recent outbound interaction:

.in('contact_id', ids)
.eq('direction', 'out')
.order('created_at', { ascending: false })
.limit(1)

This may attribute a free-form inbound message to the wrong customer, event, campaign or contact when the same guest appears in multiple events belonging to different customers.

Inspect the complete local execution path, including:

* POST /api/webhooks/whatsapp
* Webhook signature verification.
* Payload parsing and message-type classification.
* Extraction of:
    * metadata.phone_number_id
    * messages[].id
    * messages[].from
    * messages[].context.id
    * Interactive reply IDs or payloads
* resolveByContextId
* resolveInboundContact
* contact_interactions
* The meaning and assignment of billable
* recordReached
* try_record_billed_result
* billed_results
* Webhook retry and deduplication behavior
* All relevant indexes, constraints and unique keys

Inspect both migrations and the live database schema using read-only queries. Do not assume that the latest migration represents the production schema.

Do not print secrets, access tokens, complete phone numbers or raw payloads containing PII. Return aggregates, masked identifiers and schema metadata only.

Answer these questions with evidence:

1. Can a free-form message such as "Hi" cause billing when the campaign and event are active?
2. Does billable = true mean money was charged, or only that the message was classified as a billing candidate?
3. What is the authoritative proof that billing occurred?
4. What happens when the same normalized phone number belongs to contacts in two events owned by two customers?
5. Does one execution select only one customer, or can it bill more than one?
6. Can a retry of the same inbound WhatsApp message be resolved to a different campaign if newer outbound interactions were created meanwhile?
7. Is there a global unique constraint preventing one inbound messages[].id from billing two campaigns?
8. Is metadata.phone_number_id currently persisted and used during attribution?
9. Which incoming message types reliably carry context.id, and when can it be absent?
10. Can biz_opaque_callback_data correlate an arbitrary inbound free-form reply, or is it limited to outbound status events?
11. Can interactive reply IDs contain or reference an opaque server-side routing identifier?
12. Does automatic_events solve RSVP attribution, or is it limited to Click-to-WhatsApp lead and purchase detection?

For each conclusion provide:

* File path and relevant line numbers.
* Function name and execution branch.
* Table, column, constraint or index.
* Read-only SQL query and masked result summary when live data is required.
* Meta documentation URL when the conclusion depends on platform behavior.
* A label of PROVEN, INFERENCE, UNVERIFIED or CONTRADICTED.

Evaluate the following target attribution hierarchy:

1. Exact match:
    context.id -> outbound contact_interactions.provider_id
2. Exact interactive match:
    Stored opaque button/list reply identifier -> one outbound exposure
3. Candidate lookup scoped by:
    sender identity + receiving phone_number_id + active attribution window
4. Exactly one eligible candidate:
    Continue only if explicitly allowed by the billing policy
5. Multiple eligible candidates:
    Mark ambiguous; store for audit; do not bill automatically
6. No eligible candidates:
    Mark unresolved; store for audit; do not bill

Do not recommend “most recent outbound interaction wins” as financial evidence when multiple eligible candidates exist.

Evaluate a durable inbound-message ledger containing at least:

phone_number_id
inbound_message_id
sender_id
context_message_id
received_at
resolution_status
resolution_method
resolved_event_id
resolved_campaign_id
resolved_contact_id
billing_result

Determine the correct idempotency boundary. At minimum, investigate whether the following is required:

unique (phone_number_id, inbound_message_id)

Also investigate whether the billing evidence must have a global uniqueness constraint such as:

unique (channel, provider_ref)

The final design must guarantee:

* One inbound WhatsApp message receives one immutable attribution decision.
* Retries return the stored decision instead of recalculating against newer data.
* One inbound message cannot bill two customers or campaigns.
* Ambiguous attribution fails closed.
* Attribution and billing are committed atomically in the database.
* AI/NLP classification is not the sole evidence for a financial charge.
* Raw webhook receipt, message classification, attribution and actual billing remain separate auditable states.

Produce:

1. Current-state execution flow.
2. Confirmed root cause.
3. Exact answer about single-customer versus possible double billing.
4. Risk table ordered by severity.
5. Decision matrix for contextual, interactive, free-form, duplicate, ambiguous and unresolved messages.
6. Proposed database changes.
7. Proposed code changes organized by file.
8. Transaction and concurrency design.
9. Unit, integration, retry and concurrency test plan.
10. Shadow-mode rollout using a feature flag.
11. Metrics comparing old and proposed attribution.
12. Rollback plan.
13. Read-only verification queries.

Do not implement the fix until the investigation report and proposed plan have been reviewed and explicitly approved.