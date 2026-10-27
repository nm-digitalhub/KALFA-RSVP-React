import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getCurrentPricing } from '@/lib/data/campaign-pricing';
import { assertEventNotPast } from '@/lib/data/event-date';
import {
  PACKAGE_NOT_PAID_ERROR,
  PACKAGE_PAYMENT_UNVERIFIED_ERROR,
} from '@/lib/data/package-activation-errors';
import type { CampaignStatus } from '@/lib/data/campaign-status';
import { getPackagePaymentState } from '@/lib/payments/package-paid';
import { createAdminClient } from '@/lib/supabase/admin';

// Request-free core of a campaign status transition — the ONE implementation of the guarded status write (the event
// guards, the package funding check, the race-safe UPDATE), shared by every actor. It lives in its OWN module (not
// campaigns.ts) so the pg-boss worker can start a paid package (activateCampaignAfterPayment, design D23) without
// pulling campaigns.ts → auth/dal → next/headers|navigation into the worker bundle: the worker path stays statically
// request-scoped-free (enforced by .dependency-cruiser.cjs, `worker-no-request-scoped-next`). Same split as
// sendable-contacts.ts.
//
// The cookie-session half (the admin permission gate, Next's notFound) is NOT imported here: campaigns.ts passes it in
// as a TransitionSession for every request-scoped caller. Without one, only the console and system actors can
// transition — an admin transition without its permission check is refused.

// WHO is performing a campaign transition.
//
// This is a value, not a boolean "skip auth" flag, on purpose: the console
// variant CARRIES the verified staff user id, so it cannot be conjured by a
// caller that has not been through requireConsoleAgent — and that same id is
// what the support-access audit row is written from. A bare "trust me" mode
// would be one careless import away from an unauthenticated transition.
//
// There is no owner actor: a customer never changes the run state. The first start is the server's, after the
// recorded payment (`system`, design D23); after that only staff pause, revive and close.
export type CampaignActor =
  // Cookie session, platform admin. Wind-down ops (pause / close).
  | { kind: 'admin' }
  // Bearer session, already verified by the console route as a console agent
  // holding `campaigns.runstate`. Cross-tenant by design (staff), so there is no
  // ownership check here — the ROUTE is the authorization boundary, and what a
  // console actor may reach is narrowed at the call sites, not here.
  | { kind: 'console'; staffUserId: string }
  // No session: the server itself, after a package payment it recorded. It CARRIES the id of that payment, and the
  // transition re-reads it (a succeeded package purchase of THIS campaign) before anything else, so it cannot be used
  // without a real recorded payment. It is narrowed to `approved → active` inside the transition, whatever the caller
  // passes. Used only by activateCampaignAfterPayment below (design D23).
  | { kind: 'system'; paymentOperationId: string };

// R9 refusal, in the owner's vocabulary (audit §2): the event step is
// "אישור פרטי האירוע", never "פרסום". Exported so the console status route can
// classify it as a 409 without duplicating the string.
export const EVENT_NOT_CONFIRMED_ERROR = 'יש לאשר את פרטי האירוע לפני אישורי הגעה';

// A campaign created under the earlier pay-per-result model cannot be started: it has no package payment.
export const NO_PACKAGE_ERROR = 'לא ניתן להפעיל קמפיין שלא נרכשה עבורו חבילה';

// The event a transition's guards run on.
type GuardedEvent = { event_date: string | null; status: string };

// The cookie-session half of a transition, supplied by campaigns.ts (this module must not import the DAL).
export interface TransitionSession {
  // The staff permission gate of an admin wind-down.
  requireStaff(): Promise<void>;
  // A missing campaign in a request is Next's 404.
  notFound(): Promise<never>;
}

// The system actor's whole authority (design D23): the transition it asks for is exactly `approved → active`, and the
// payment it names is a succeeded package purchase of this very campaign, read from the ledger now. Anything else is
// refused before the event is even read, so the actor cannot be reused for another transition or another campaign.
async function requireSystemActivationProof(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  paymentOperationId: string,
): Promise<void> {
  if (to !== 'active' || from.length !== 1 || from[0] !== 'approved') {
    throw new Error('הפעלת מערכת מותרת רק ממצב מאושר לפעיל');
  }
  const { data, error } = await admin
    .from('payment_operations')
    .select('id')
    .eq('id', paymentOperationId)
    .eq('campaign_id', campaignId)
    .eq('kind', 'package_purchase')
    .eq('outcome', 'succeeded')
    .maybeSingle();
  if (error) throw new Error(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
  if (!data) throw new Error('הפעלת מערכת נדחתה: התשלום שצוין אינו רכישת חבילה שהצליחה עבור הקמפיין הזה');
}

// Race-safe guarded transition: the UPDATE only matches a row in one of `from`
// (plus any extra column guard), so concurrent calls can't double-transition.
// Identity is verified first. Throws if no row matched its current state.
// Returns the event's date so a caller (activateCampaign) can seed
// auto-thankyou's default schedule without a second identity-checked fetch.
export async function transitionCampaignStatus(
  campaignId: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  // 'package': the campaign must be a package campaign with a recorded payment (verified by preparePackage).
  funding: 'package' | undefined,
  // L1/R9: only forward transitions that BEGIN outreach/billing (activate)
  // reject a past event AND require an active event. pause/close must stay
  // allowed for a past/non-active event (cleanup + wind-down paths, per R9's
  // explicit carve-out — cancel/close/settle are not commercial-forward).
  opts:
    | {
        rejectPastEvent?: boolean;
        requireActiveEvent?: boolean;
        // The funding precondition (the payment, from the ledger). Runs after the identity and event checks, before
        // the status write.
        preparePackage?: (campaign: { id: string; event_id: string }) => Promise<void>;
      }
    | undefined,
  actor: CampaignActor,
  // Required for the admin actor (see TransitionSession); campaigns.ts passes it on every request path.
  session?: TransitionSession,
): Promise<{ eventDate: string | null }> {
  const admin = createAdminClient();
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('id, event_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!campaign) {
    if (session) return session.notFound();
    throw new Error('הקמפיין לא נמצא');
  }

  // The business guards are deliberately SEPARATE from the identity check: they
  // are two different concerns and are applied independently of who the actor
  // is. Welding them to requireOwnedEvent (the cookie DAL) would drop them for an
  // actor that cannot call it, such as the console route.
  const applyEventGuards = (event: GuardedEvent) => {
    if (opts?.rejectPastEvent) assertEventNotPast(event.event_date);
    if (opts?.requireActiveEvent && event.status !== 'active') {
      throw new Error(EVENT_NOT_CONFIRMED_ERROR);
    }
  };

  let eventDate: string | null;
  if (actor.kind === 'admin') {
    // Staff wind-down: no past/active gating, so the event is not read.
    if (!session) throw new Error('מעבר מצב של מנהל מחייב בדיקת הרשאה');
    await session.requireStaff();
    eventDate = null;
  } else {
    // Console (Bearer) or system. Identity was verified by the route (console), or is the recorded payment checked
    // here (system). Read the event with the service-role client so the SAME guards run without the cookie DAL.
    if (actor.kind === 'system') await requireSystemActivationProof(admin, campaign.id, from, to, actor.paymentOperationId);
    const { data: event, error: evErr } = await admin
      .from('events')
      .select('event_date, status')
      .eq('id', campaign.event_id)
      .maybeSingle();
    if (evErr) throw new Error('טעינת האירוע נכשלה');
    if (!event) throw new Error('האירוע לא נמצא');
    applyEventGuards(event);
    eventDate = event.event_date;
  }

  if (funding === 'package') {
    // Only a package campaign is ever funded: one created under the earlier model has no pricing round and no payment
    // to start from. Rounds are append-only — a campaign that has one cannot stop having one — so this pre-check
    // cannot be raced false, and no update-time re-guard is needed.
    if ((await getCurrentPricing(campaign.id)) === null) throw new Error(NO_PACKAGE_ERROR);
    await opts?.preparePackage?.({ id: campaign.id, event_id: campaign.event_id });
  }

  const query = admin
    .from('campaigns')
    .update({ status: to })
    .eq('id', campaignId)
    .in('status', from);
  const { data: updated, error: upErr } = await query
    .select('id')
    .maybeSingle();
  if (upErr) throw new Error('עדכון מצב הקמפיין נכשל');
  if (!updated) {
    throw new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי');
  }
  return { eventDate };
}

// What a package campaign needs before it may start: its payment recorded in the ledger (the only source of truth for
// package money). The list every send reads is not filled here: guests added before the approval are admitted when the
// terms are approved (agreements.ts), and a guest added later by reconcileCampaignSetForContact (contacts.ts), up to the
// package quota.
export async function requirePackageFunding(campaignId: string): Promise<void> {
  let paid: boolean;
  try {
    paid = (await getPackagePaymentState(campaignId)).status === 'collected';
  } catch {
    console.error('[campaign-lifecycle] package payment state could not be read', { campaignId });
    throw new Error(PACKAGE_PAYMENT_UNVERIFIED_ERROR);
  }
  if (!paid) throw new Error(PACKAGE_NOT_PAID_ERROR);
}

// The server's own start of a paid package (design D23): no session, `approved → active` only. The payment it names is
// re-read by the transition (requireSystemActivationProof) and the funding by requirePackageFunding; the event guards
// (no past event, an active event) are the same as every activation's. This is the ONLY first start of a campaign: a
// customer does not start one. A paused, closed or cancelled campaign never matches the guarded UPDATE, so a late or repeated call
// cannot restart what staff stopped. Completion (activity row, thank-you default) is the caller's, written so it can
// run again safely (src/lib/payments/activate-paid-package.ts). Returns the event date for that completion.
export async function activateCampaignAfterPayment(
  campaignId: string,
  paymentOperationId: string,
): Promise<{ eventDate: string | null }> {
  const result = await transitionCampaignStatus(
    campaignId,
    ['approved'],
    'active',
    'package',
    {
      rejectPastEvent: true,
      requireActiveEvent: true,
      preparePackage: (c) => requirePackageFunding(c.id),
    },
    { kind: 'system', paymentOperationId },
  );
  void sendSlackAlert({
    level: 'info',
    category: 'campaign_billing',
    source: 'campaign-lifecycle',
    title: 'קמפיין הופעל — הפניות מתחילות',
    fields: { campaign_id: campaignId },
  });
  return result;
}
