// Phase-1 business-event contracts (plans/ga4-events-recommendation.md v2).
// Pure module — no window, no server-only — importable from Server Actions,
// client components, and node unit tests alike.

// One-shot cookie relaying an event across a Server Action redirect(). Written
// by the action just before redirect, read+deleted exactly once by
// GaFlagListener on the destination page. Short TTL, SameSite=Lax, path=/,
// NOT httpOnly (client JS must read it). Carries an allowlisted event NAME
// plus, at most, internal UUID identifiers (event/campaign) approved by the
// compliance ruling of 27.7.2026 — never free-form user data.
export const GA_FLAG_COOKIE_NAME = 'kalfa_ga_evt';
export const GA_FLAG_COOKIE_MAX_AGE_SECONDS = 20;

// Allowlist of events a flag cookie may carry — anything else is ignored (a
// forged cookie must not become an arbitrary analytics event).
export const FLAG_EVENT_NAMES = ['sign_up', 'agreement_signed'] as const;
export type FlagEventName = (typeof FLAG_EVENT_NAMES)[number];

export function isFlagEventName(value: string | undefined | null): value is FlagEventName {
  return !!value && (FLAG_EVENT_NAMES as readonly string[]).includes(value);
}

// Strict UUID shape — a forged cookie segment that is not a UUID is dropped,
// so no free text can ride the cookie into analytics params.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cookie value format: `name|e:<eventId>|c:<campaignId>` — keyed segments,
// each optional. build/parse are a matched pair; parse validates EVERYTHING
// (name allowlist + UUID shape per segment) and returns null on a bad name.
export function buildFlagCookieValue(
  name: FlagEventName,
  ids?: { eventId?: string; campaignId?: string },
): string {
  const parts: string[] = [name];
  if (ids?.eventId && UUID_RE.test(ids.eventId)) parts.push(`e:${ids.eventId}`);
  if (ids?.campaignId && UUID_RE.test(ids.campaignId)) parts.push(`c:${ids.campaignId}`);
  return parts.join('|');
}

export function parseFlagCookieValue(raw: string | undefined | null): GaActionEvent | null {
  if (!raw) return null;
  const [name, ...segments] = raw.split('|');
  if (!isFlagEventName(name)) return null;
  const params: Record<string, string> = {};
  for (const segment of segments) {
    const value = segment.slice(2);
    if (!UUID_RE.test(value)) continue;
    if (segment.startsWith('e:')) params.event_id = value;
    else if (segment.startsWith('c:')) params.campaign_id = value;
  }
  return Object.keys(params).length > 0 ? { name, params } : { name };
}

// Billing-model label for the purchase event — a coarse label only, NEVER an
// amount (compliance ruling 27.7.2026: financial figures stay out of params;
// the standard ecommerce `value` is the single approved exception). Named
// billing_model (not payment_plan) — the values describe the billing MODEL
// applied at settlement, not an installment plan.
export type BillingModelLabel = 'base_overage' | 'per_reached';

// Analytics payload a Server Action may attach to its returned form state for
// no-redirect flows (useActionState); fired client-side exactly once per
// returned state object.
export interface GaActionEvent {
  name: string;
  params?: Record<string, string | number | object[]>;
}

// generate_lead sources — official GA4 `lead_source` parameter values (stable
// enums, never free text / PII).
export const LEAD_SOURCES = {
  contact: 'contact_form',
  callback: 'callback_request',
} as const;

// purchase params (official schema, per the approved events plan): real
// per-charge transaction id (the SUMIT payment id — NEVER the campaign id,
// which repeats across retries/refunds and would poison GA's transaction
// de-duplication) + currency/value + the single service items[] line.
// transaction_id is omitted when the provider did not return an id.
// context: the billing-model label (registered as a custom dimension); the
// UUID fields exist but are HELD — no call site passes them (minimization
// ruling 27.7) pending the legal decision.
export type PurchaseParams = Record<string, string | number | object[]>;

export function buildPurchaseParams(
  amount: number,
  paymentId: number | string | null | undefined,
  context?: {
    eventId?: string;
    campaignId?: string;
    billingModel?: BillingModelLabel;
  },
): PurchaseParams {
  const params: PurchaseParams = {
    currency: 'ILS',
    value: amount,
    items: [
      {
        item_id: 'rsvp_outreach',
        item_name: 'RSVP outreach service',
        price: amount,
        quantity: 1,
      },
    ],
  };
  if (paymentId !== null && paymentId !== undefined && `${paymentId}`.trim() !== '') {
    params.transaction_id = String(paymentId);
  }
  if (context?.eventId) params.event_id = context.eventId;
  if (context?.campaignId) params.campaign_id = context.campaignId;
  if (context?.billingModel) params.billing_model = context.billingModel;
  return params;
}
