# Old-model inventory

Re-run on 11.10.2026 after task 1.2, over `src` (tests excluded, `types.generated.ts` excluded). The search names: per-result terms, hold and close-charge code, the signature agreement, the old switches, and SUMIT hold helpers. Each task in group 2 re-runs the search for its own names; this list is the starting map, not a completion check.

## Whole files (removed in group 2)
- `src/app/(admin)/admin/settings/pricing-model-toggle.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/agreement-step.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/hold-form.tsx`
- `src/app/api/campaigns/[id]/authorize/route.ts`
- `src/app/api/campaigns/[id]/close-charge/route.ts`
- `src/lib/data/close-charge-amount.ts`
- `src/lib/data/close-charge.ts`
- `src/lib/data/sumit-hold-reconcile.ts`
- `src/lib/sumit/authorize.ts`
- `src/lib/sumit/capture.ts`
- `src/lib/sumit/crm-holds.ts`

## Shared files (old-model branches or comments, cleaned in 2.5–2.6)
- `src/app/(admin)/admin/agreement/actions.ts`
- `src/app/(admin)/admin/agreement/agreement-config-form.tsx`
- `src/app/(admin)/admin/agreement/page.tsx`
- `src/app/(admin)/admin/cancellations/[id]/page.tsx`
- `src/app/(admin)/admin/faq/page.tsx`
- `src/app/(admin)/admin/integrations/sumit/actions.ts`
- `src/app/(admin)/admin/integrations/sumit/page.tsx`
- `src/app/(admin)/admin/settings/actions.ts`
- `src/app/(admin)/admin/settings/page.tsx`
- `src/app/(admin)/admin/settings/settings-form.tsx`
- `src/app/(admin)/admin/users/[id]/user-actions.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/approve/package-terms-step.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/manage-client.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx`
- `src/app/(customer)/app/events/[id]/campaign/[campaignId]/payment/page.tsx`
- `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts`
- `src/app/(customer)/app/events/[id]/event-summary.tsx`
- `src/app/(customer)/app/events/[id]/setup-steps.tsx`
- `src/app/(customer)/app/events/[id]/setup/page.tsx`
- `src/app/(customer)/app/events/[id]/stats/page.tsx`
- `src/app/(public)/(site)/faq/page.tsx`
- `src/app/api/campaigns/[id]/status/route.ts`
- `src/app/api/campaigns/[id]/whatsapp-send/route.ts`
- `src/app/api/events/[eventId]/outreach-call/route.ts`
- `src/app/api/voximplant/sls/tool/signup-link/[token]/route.ts`
- `src/lib/agreements/content.ts`
- `src/lib/agreements/template.ts`
- `src/lib/analytics/ga-event-contracts.ts`
- `src/lib/analytics/ga4-types.ts`
- `src/lib/auth/dal.ts`
- `src/lib/data/admin/agreements.ts`
- `src/lib/data/admin/callbacks.ts`
- `src/lib/data/admin/campaign-payment-status.ts`
- `src/lib/data/admin/campaigns.ts`
- `src/lib/data/admin/cancellation-money.ts`
- `src/lib/data/admin/labels.ts`
- `src/lib/data/admin/settings.ts`
- `src/lib/data/admin/webhook-inbox.ts`
- `src/lib/data/agreements-doc.ts`
- `src/lib/data/agreements.ts`
- `src/lib/data/alerts-config.ts`
- `src/lib/data/billing.ts`
- `src/lib/data/call-result-processing.ts`
- `src/lib/data/campaign-status.ts`
- `src/lib/data/campaigns.ts`
- `src/lib/data/contacts.ts`
- `src/lib/data/event-cancellation.ts`
- `src/lib/data/event-labels.ts`
- `src/lib/data/event-stats.ts`
- `src/lib/data/outreach-calls.ts`
- `src/lib/data/outreach-config.ts`
- `src/lib/data/outreach-engine.ts`
- `src/lib/data/payment-orphans.ts`
- `src/lib/data/payments.ts`
- `src/lib/data/public-business-facts.ts`
- `src/lib/data/setup-steps.ts`
- `src/lib/data/tax-ceiling.ts`
- `src/lib/faq/page-model.ts`
- `src/lib/faq/tokens.ts`
- `src/lib/fleet/business-facts.ts`
- `src/lib/http/allowed-origin.ts`
- `src/lib/ops/queue-schedule.ts`
- `src/lib/owner-agent/consumer/primer.ts`
- `src/lib/owner-agent/cores/billing.ts`
- `src/lib/owner-agent/cores/campaigns.ts`
- `src/lib/payments/cardcom-purchase.ts`
- `src/lib/payments/cardcom-refund.ts`
- `src/lib/payments/package-paid.ts`
- `src/lib/payments/package-purchase.ts`
- `src/lib/queue/queues.ts`
- `src/lib/sumit/raw-charge.ts`
- `src/lib/sumit/run-health-check.ts`
- `src/lib/validation/admin.ts`
- `src/lib/validation/agent-console.ts`
- `src/lib/validation/campaigns.ts`
- `src/lib/workflow/catalogue/sumit-sample-output.ts`
- `src/lib/workflow/catalogue/templates/index.ts`
- `src/lib/workflow/enqueue.ts`
- `src/lib/workflow/nodes/action-sumit-create-document/definition.ts`
- `src/lib/workflow/nodes/trigger-sumit-card/runtime.ts`

## False matches (generated provider models; not changed)
- `src/lib/cardcom/generated/models/advancedLPDefinition.ts`
- `src/lib/cardcom/generated/models/advancedTran.ts`
- `src/lib/cardcom/generated/models/jValidateType.ts`
- `src/lib/cardcom/generated/models/transactionInfo.ts`
- `src/lib/sumit/generated/api.schemas.ts`
- `src/lib/whatsapp/generated/incoming-webhook.d.ts`
- `src/lib/whatsapp/generated/message-templates.d.ts`

## SUMIT outside campaign payment (Open Question 2; answered by the owner on 27.10.2026)
Kept, existing scope (task 6.2):
- `src/lib/sumit/hold-status.ts` (read by the SUMIT card workflow trigger, `workflow/nodes/trigger-sumit-card/runtime.ts`)
- `src/lib/workflow/catalogue/templates/sumit-hold-changed.ts` (a workflow template on the same trigger)

Removed with the diagnostics (task 6.1):
- `src/app/(admin)/admin/sumit-test/page.tsx`
- `src/app/(admin)/admin/sumit-test/sumit-test-form.tsx`
- `src/app/api/admin/sumit-test/route.ts` (and `route.test.ts`)
- `src/lib/data/admin/sumit-test-transactions.ts`
- `src/lib/data/admin/sumit-test.ts`
- `src/lib/sumit/safe-preview.ts`, `src/lib/sumit/charge-response.ts` (and their tests): used only by the files above
- `scripts/sumit-doc-check.ts`
