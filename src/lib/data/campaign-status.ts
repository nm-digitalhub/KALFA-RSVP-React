import type { Enums } from '@/lib/supabase/types';
export type CampaignStatus = Enums<'campaign_status'>;

// TypeScript-level shared definition of the OPERATIONAL (non-terminal) campaign
// statuses: a campaign in any of these remains operational for lifecycle and
// outreach-policy purposes, so it blocks closing the
// event (R7) AND keys the event-edit locks while an operational campaign exists.
// NOT a system-wide SSOT — the DB trigger events_guard_update hardcodes the same
// 6 statuses independently (a hand-synced copy that can drift). `cancelled`
// (retired) and any post-run terminal status are excluded. `satisfies` makes a
// typo or a renamed enum value a COMPILE error here, not a silent miss.
export const OPERATIONAL_CAMPAIGN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'active',
  'paused',
] as const satisfies readonly CampaignStatus[];

// O(1) membership set. Typed against CampaignStatus so the predicate below can't
// take a free string — if an external path holds a raw string, validate it at
// that boundary (narrow to CampaignStatus) rather than weakening this policy fn.
const operationalCampaignStatusSet = new Set<CampaignStatus>(
  OPERATIONAL_CAMPAIGN_STATUSES,
);

export function isOperationalCampaignStatus(status: CampaignStatus): boolean {
  return operationalCampaignStatusSet.has(status);
}

// The ∃-operational decision shared by BOTH UI surfaces (event-close block +
// event-edit field locks) and matching the server (updateEvent's
// `.in(OPERATIONAL…).limit(1)`) and the DB trigger (events_guard_update's
// `count(*) … in (…) > 0`): "does the event have AT LEAST ONE operational
// (non-terminal) campaign?". Typed against CampaignStatus — never a free string —
// so only a real campaign row shape can be passed. Note this decides the SET/
// quantifier only; the field-lock invariant itself is enforced solely in
// updateEvent (no DB backstop), so this is NOT a system-wide SSOT.
export function hasAnyOperationalCampaign(
  campaigns: readonly { status: CampaignStatus }[],
): boolean {
  return campaigns.some((c) => isOperationalCampaignStatus(c.status));
}

// When a campaign may still be CANCELLED (cancelCampaign → cancel_campaign RPC).
// Cancel is a pre-money wind-down only: once a card hold, a charge or a billed
// reach exists, money has to be settled or refunded instead (the cancellation-
// request flow), never erased by flipping the status. This mirrors the RPC's own
// predicate so the staff button is never shown where the RPC would refuse. The
// RPC DOES look at the payment ledger (campaign_has_payment_activity): a payment
// that is in flight (pending, in review) blocks it, so does any succeeded REAL
// payment, and a campaign whose only settled money is TEST money (a payment on
// the no-money test terminal) does not - that is how a test run is reset and paid
// again. campaign-status.test.ts pins the parity against the migration that
// defines the RPC.
export const CANCELLABLE_CAMPAIGN_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
] as const satisfies readonly CampaignStatus[];

// The statuses a campaign may be CLOSED from (closeCampaign in campaigns.ts and close-charge.ts use the same four).
export const CLOSEABLE_CAMPAIGN_STATUSES = [
  'active',
  'paused',
  'approved',
  'scheduled',
] as const satisfies readonly CampaignStatus[];

const BLOCKING_CAPTURE_STATUSES = new Set(['authorized', 'pending', 'hold_review']);
// A package campaign has no hold: money is in the ledger. Paid, refunded, or a payment still in flight is not "pre-money" - unless
// what settled is test money only (`testMoney`, from deriveStatus), which the RPC ignores once it has settled. A REFUND does not
// erase the payment it returned: the ledger is append-only, the database still sees the real collect and its real refund, and
// refuses. A payment still in flight blocks whatever its class: it may become real money or a row someone must resolve first.
const IN_FLIGHT_PAYMENT_STATUSES = new Set(['pending', 'review']);
const SETTLED_MONEY_PAYMENT_STATUSES = new Set(['collected', 'refunded']);
function paymentBlocksCancel(payment: { status: string; testMoney?: boolean } | null | undefined): boolean {
  if (!payment) return false;
  if (IN_FLIGHT_PAYMENT_STATUSES.has(payment.status)) return true;
  return SETTLED_MONEY_PAYMENT_STATUSES.has(payment.status) && payment.testMoney !== true;
}

export function isCampaignCancellable(
  campaign: {
    status: CampaignStatus;
    capture_status: string | null;
    charge_status: string | null;
    // The ledger state of a package campaign; absent for the other model. `testMoney`: everything that settled is test money.
    payment?: { status: string; testMoney?: boolean } | null;
  },
  reachedCount: number,
): boolean {
  return (
    (CANCELLABLE_CAMPAIGN_STATUSES as readonly CampaignStatus[]).includes(campaign.status) &&
    !BLOCKING_CAPTURE_STATUSES.has(campaign.capture_status ?? '') &&
    !paymentBlocksCancel(campaign.payment) &&
    campaign.charge_status === null &&
    reachedCount === 0
  );
}

// What the staff cancel button says. Cancelling a campaign whose only settled money is TEST money is not ending a customer's campaign:
// it resets a test run (the event can get a new campaign and be paid again), and the button says so. Everything else keeps the plain
// words it always had.
export function cancelActionCopy(payment: { status: string; testMoney?: boolean } | null | undefined): { label: string; confirm: string } {
  if (payment?.status === 'collected' && payment.testMoney === true) {
    return {
      label: 'אפס ריצת בדיקה',
      confirm: 'לאפס את ריצת הבדיקה? הקמפיין הזה יבוטל לצמיתות. התשלום שלו הוא כסף בדיקה ולא נגבה כסף אמיתי, ואחר כך אפשר ליצור לאירוע קמפיין חדש ולשלם שוב.',
    };
  }
  return { label: 'ביטול קמפיין', confirm: 'לבטל את הקמפיין לצמיתות? הפעולה עוצרת כל פנייה נוספת ולא ניתנת לשחזור.' };
}

// An event can have SEVERAL campaigns: one cancelled for every reset test run, and at most one that is not
// (campaigns_event_noncancelled_uidx). A reader that takes "the" campaign of an event from an unordered list, or with maybeSingle(),
// breaks the moment a second one exists. Given an event's campaigns NEWEST FIRST, this is the one that is not cancelled - what money
// and outreach decisions mean - or none.
export function liveCampaignOf<T extends { status: string }>(campaignsNewestFirst: readonly T[]): T | null {
  return campaignsNewestFirst.find((c) => c.status !== 'cancelled') ?? null;
}
