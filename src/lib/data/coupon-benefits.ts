import 'server-only';

import type { User } from '@supabase/supabase-js';

import { logActivity } from '@/lib/data/activity';
import { verifiedPhoneOf } from '@/lib/auth/verified-phone';
import { createAdminClient } from '@/lib/supabase/admin';

// The customer's personal benefits (personal-coupons task 5.2): WHO may use an assignment, the
// one-time claim, and the automatic binding at package choice.
//
// Eligibility is PROVEN, never claimed (the spec's rule): exactly two proofs exist —
//   1. a staff assignment made to this account (`user_id` = the account);
//   2. an assignment made to a phone number that EQUALS the account's VERIFIED phone
//      (auth.users.phone + phone_confirmed_at, via verifiedPhoneOf), while it is still unclaimed.
// A signup link, a code, or `profiles.sales_referral_attempt_id` (the referral the account owner
// can set themselves) is NOT proof — nothing here reads any of them, and no function in this
// module accepts one.
//
// The coupon tables are CLOSED (RLS, no grants to anon/authenticated), so this module runs on the
// admin client; callers hand it the SESSION user they already authenticated — it never trusts a
// submitted user id.

export type BenefitOption = {
  packageId: string;
  listPrice: number;
  discountAmount: number;
  finalPrice: number;
};

export type EligibleBenefit = {
  assignmentId: string;
  state: 'assigned' | 'bound';
  boundCampaignId: string | null;
  expiresAt: string;
  /** Already tied to this account (claimed), vs. reachable through the verified phone only. */
  claimed: boolean;
  options: BenefitOption[];
};

type AssignmentRow = {
  id: string;
  state: string;
  bound_campaign_id: string | null;
  expires_at: string;
  user_id: string | null;
  coupon_assignment_options:
    | { package_id: string; list_price: number; discount_amount: number; final_price: number }[]
    | null;
};

const ASSIGNMENT_COLUMNS =
  'id, state, bound_campaign_id, expires_at, user_id, coupon_assignment_options(package_id, list_price, discount_amount, final_price)';

function toBenefit(row: AssignmentRow): EligibleBenefit {
  return {
    assignmentId: row.id,
    state: row.state === 'bound' ? 'bound' : 'assigned',
    boundCampaignId: row.bound_campaign_id,
    expiresAt: row.expires_at,
    claimed: row.user_id !== null,
    options: (row.coupon_assignment_options ?? []).map((o) => ({
      packageId: o.package_id,
      listPrice: Number(o.list_price),
      discountAmount: Number(o.discount_amount),
      finalPrice: Number(o.final_price),
    })),
  };
}

type SessionUser = Pick<User, 'id' | 'phone' | 'phone_confirmed_at'>;

export type PackageBenefitPrice = {
  packageId: string;
  listPrice: number;
  discountAmount: number;
  finalPrice: number;
};

/**
 * What the package-choice screen may say about a benefit (tasks 7.1/7.2). The variants ARE the
 * reveal rules:
 *  - `verify_invite` — the account has no verified phone and holds no claimed benefit. The screen
 *    shows the NEUTRAL invitation only; by construction the answer is identical whether or not a
 *    phone-targeted assignment exists, because the phone is never even queried.
 *  - `active` — usable benefit(s): the best final price per package (D18's own rule), with expiry.
 *  - `used` — the benefit serves another campaign, or was consumed; named with its event.
 *  - `ended` — expired (with the date) or voided. Shown only to the proven owner.
 *  - `none` — verified (or claimed) and simply nothing to show.
 */
export type BenefitView =
  | { kind: 'verify_invite' }
  | { kind: 'none' }
  | { kind: 'active'; expiresAt: string; perPackage: PackageBenefitPrice[] }
  | { kind: 'used'; eventName: string | null }
  | { kind: 'ended'; reason: 'expired' | 'unavailable'; endedAt: string | null };

type ViewRow = AssignmentRow & { state: string };

export async function getBenefitView(
  user: SessionUser,
  { currentCampaignId }: { currentCampaignId?: string | null } = {},
): Promise<BenefitView> {
  const admin = createAdminClient();

  // The account's PROVEN rows (claimed or staff-assigned), every state — the owner is told about
  // ended and used benefits too.
  const { data: ownRows, error: ownError } = await admin
    .from('coupon_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('user_id', user.id);
  if (ownError) return { kind: 'none' }; // fail-closed: reveal nothing on a broken read

  const verifiedPhone = verifiedPhoneOf(user);
  let phoneRows: ViewRow[] = [];
  if (verifiedPhone) {
    const { data, error } = await admin
      .from('coupon_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('phone_e164', verifiedPhone)
      .is('user_id', null)
      .in('state', ['assigned', 'bound']);
    if (error) return { kind: 'none' };
    phoneRows = (data ?? []) as ViewRow[];
  }

  const rows = [...((ownRows ?? []) as ViewRow[]), ...phoneRows];
  const now = Date.now();

  const isActive = (r: ViewRow) =>
    (r.state === 'assigned' || (r.state === 'bound' && r.bound_campaign_id === (currentCampaignId ?? null))) &&
    Date.parse(r.expires_at) > now;
  const active = rows.filter(isActive);

  if (active.length > 0) {
    // D18's display rule = its binding rule: per package, the lowest final price among the
    // account's active benefits.
    const best = new Map<string, PackageBenefitPrice>();
    let expiresAt = active[0].expires_at;
    for (const row of active) {
      if (Date.parse(row.expires_at) > Date.parse(expiresAt)) expiresAt = row.expires_at;
      for (const o of row.coupon_assignment_options ?? []) {
        const price: PackageBenefitPrice = {
          packageId: o.package_id,
          listPrice: Number(o.list_price),
          discountAmount: Number(o.list_price) - Number(o.final_price),
          finalPrice: Number(o.final_price),
        };
        const held = best.get(price.packageId);
        if (!held || price.finalPrice < held.finalPrice) best.set(price.packageId, price);
      }
    }
    return { kind: 'active', expiresAt, perPackage: [...best.values()] };
  }

  // Nothing usable. An unverified account that holds no proven benefit gets the neutral invite —
  // and nothing else, whatever may or may not exist on its (unproven) phone.
  const used = rows.find(
    (r) => r.state === 'consumed' || (r.state === 'bound' && r.bound_campaign_id !== (currentCampaignId ?? null)),
  );
  if (used) {
    let eventName: string | null = null;
    if (used.bound_campaign_id) {
      const { data: campaignRow } = await admin
        .from('campaigns')
        .select('id, events(name)')
        .eq('id', used.bound_campaign_id)
        .maybeSingle();
      eventName = (campaignRow as { events?: { name?: string } | null } | null)?.events?.name ?? null;
    }
    return { kind: 'used', eventName };
  }

  const expired = rows
    .filter((r) => (r.state === 'assigned' || r.state === 'bound') && Date.parse(r.expires_at) <= now)
    .sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0];
  if (expired) return { kind: 'ended', reason: 'expired', endedAt: expired.expires_at };

  if (rows.some((r) => r.state === 'void')) {
    return { kind: 'ended', reason: 'unavailable', endedAt: null };
  }

  if (!verifiedPhone) return { kind: 'verify_invite' };
  return { kind: 'none' };
}

/**
 * Every assignment this account may use: claimed/staff assignments on the account itself, plus
 * unclaimed phone assignments whose number equals the account's verified phone. Includes expired
 * rows (the screens tell the owner a benefit has ended); the bind path filters them out. Two
 * indexed queries, merged — never an `or` filter carrying the raw `+`-prefixed phone.
 */
export async function listEligibleBenefits(user: SessionUser): Promise<EligibleBenefit[]> {
  const admin = createAdminClient();

  const { data: ownRows, error: ownError } = await admin
    .from('coupon_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('user_id', user.id)
    .in('state', ['assigned', 'bound']);
  if (ownError) throw new Error('טעינת ההטבות נכשלה');

  const verifiedPhone = verifiedPhoneOf(user);
  let phoneRows: AssignmentRow[] = [];
  if (verifiedPhone) {
    const { data, error } = await admin
      .from('coupon_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('phone_e164', verifiedPhone)
      .is('user_id', null)
      .in('state', ['assigned', 'bound']);
    if (error) throw new Error('טעינת ההטבות נכשלה');
    phoneRows = (data ?? []) as AssignmentRow[];
  }

  return [...((ownRows ?? []) as AssignmentRow[]), ...phoneRows].map(toBenefit);
}

/**
 * The one-time claim (D3: "its account (once, on claim)"): ties a phone assignment to the account
 * at its FIRST USE. Guarded by `user_id is null` so a concurrent claim by another account can
 * never be overwritten — the freeze trigger refuses any later change too. Returns whether this
 * call won the claim.
 */
async function claimBenefit(assignmentId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('coupon_assignments')
    .update({ user_id: userId, claimed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .is('user_id', null)
    .select('id');
  if (error) return false;
  return (data ?? []).length > 0;
}

/**
 * The acceptance flow (task 5.5, ש5/D21/D22): the owner of a benefit whose campaign already has
 * APPROVED, UNPAID terms accepts the benefit — the locked round is superseded (reason
 * `benefit_accepted`) by a fresh round carrying the benefit's frozen option prices, and the
 * campaign returns to `pending_approval`: the customer approves the NEW terms at the discounted
 * price before anything is charged. Not accepting leaves the approved price payable as it is.
 *
 * The best benefit is chosen exactly as at package choice (D18 — lowest final price for the
 * campaign's package). After the supersede, bind_coupon_assignment normalizes the assignment to
 * `bound` on the new, unlocked round (the supersede names the assignment on the round; the bind
 * writes the assignment side and its history row).
 */
export async function acceptBenefitForCampaign({
  campaignId,
  eventId,
  packageId,
  user,
}: {
  campaignId: string;
  eventId: string;
  packageId: string;
  user: SessionUser;
}): Promise<'accepted' | 'none'> {
  const now = Date.now();
  const benefits = await listEligibleBenefits(user);
  const candidates = benefits
    .filter((b) => Date.parse(b.expiresAt) > now)
    .filter((b) => b.state !== 'bound' || b.boundCampaignId === campaignId)
    .map((b) => ({ benefit: b, option: b.options.find((o) => o.packageId === packageId) }))
    .filter((c): c is { benefit: EligibleBenefit; option: BenefitOption } => c.option !== undefined)
    .sort(
      (a, b) =>
        a.option.finalPrice - b.option.finalPrice ||
        Date.parse(a.benefit.expiresAt) - Date.parse(b.benefit.expiresAt),
    );

  const admin = createAdminClient();
  for (const { benefit, option } of candidates) {
    if (!benefit.claimed) {
      const claimed = await claimBenefit(benefit.assignmentId, user.id);
      if (!claimed) continue;
    }

    const { error } = await admin.rpc('supersede_campaign_pricing', {
      _campaign_id: campaignId,
      _reason: 'benefit_accepted',
      _list_price: option.listPrice,
      _discount_amount: option.discountAmount,
      _assignment_id: benefit.assignmentId,
      _actor_user_id: user.id,
    });
    if (error) {
      // Money movement, or a concurrent supersede — refused there, loudly here, nothing changed.
      console.error('[coupon-benefits] benefit-accept supersede was refused', {
        campaignId,
        error: error.message,
      });
      return 'none';
    }

    // Normalize the assignment onto the new (unlocked) round: state `bound` + its history row.
    const { error: bindError } = await admin.rpc('bind_coupon_assignment', {
      _assignment_id: benefit.assignmentId,
      _campaign_id: campaignId,
      _actor_user_id: user.id,
    });
    if (bindError) {
      // The supersede stands (the round carries the discount); the bind self-heals on the next
      // pass. Loud, never silent.
      console.error('[coupon-benefits] benefit-accept bind did not complete', {
        campaignId,
        assignmentId: benefit.assignmentId,
        error: bindError.message,
      });
    }

    await logActivity({
      eventId,
      action: 'campaign.benefit_accepted',
      meta: { campaignId, assignmentId: benefit.assignmentId, packageId },
    });
    return 'accepted';
  }
  return 'none';
}

/**
 * D17 (task 5.3): a cancelled campaign frees its bound, unconsumed assignment — the ASSIGNMENT
 * side only. The release function returns it to `assigned` (or `void` when expired) so it follows
 * the event's next campaign; the cancelled campaign's locked pricing round and stored agreement
 * stay immutable history. Idempotent: no bound assignment → nothing to do. A refused release
 * (e.g. the campaign has money movement — an unknown payment outcome never releases) is loud but
 * non-fatal: the cancellation already happened.
 */
export async function releaseCancelledCampaignBenefit(
  campaignId: string,
  actorUserId: string | null,
): Promise<'released' | 'none'> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('coupon_assignments')
    .select('id')
    .eq('bound_campaign_id', campaignId)
    .eq('state', 'bound')
    .maybeSingle();
  if (error || !data) return 'none';

  const { error: releaseError } = await admin.rpc('release_coupon_assignment', {
    _assignment_id: data.id,
    _reason: 'campaign_cancelled',
    _actor_user_id: actorUserId ?? undefined,
  });
  if (releaseError) {
    console.error('[coupon-benefits] release on campaign cancel was refused', {
      campaignId,
      assignmentId: data.id,
      error: releaseError.message,
    });
    return 'none';
  }
  return 'released';
}

/**
 * D15's lapse (task 5.3): payment is the deciding step — a benefit counts only if the payment
 * session OPENS before its expiry. When the buyer reaches payment and the locked round's bound
 * benefit has expired, the discounted price is no longer payable: the locked round is superseded
 * (reason `lapsed_reapproval`) with a fresh round at the LIST price and no benefit, and the
 * campaign returns to `pending_approval` — the customer approves new terms at the then-current
 * price. Returns 'lapsed' when it superseded (the caller routes to re-approval), 'kept' when the
 * benefit is still valid or nothing could be decided (the DB open guard remains the uncheatable
 * backstop inside the PENDING insert's own transaction).
 */
export async function lapseExpiredBoundBenefit({
  campaignId,
  assignmentId,
  listPrice,
  actorUserId,
}: {
  campaignId: string;
  assignmentId: string;
  listPrice: number;
  actorUserId: string;
}): Promise<'kept' | 'lapsed'> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('coupon_assignments')
    .select('expires_at')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error || !data) return 'kept'; // unreadable — the DB guard decides at open
  if (Date.parse(data.expires_at) > Date.now()) return 'kept';

  const { error: supersedeError } = await admin.rpc('supersede_campaign_pricing', {
    _campaign_id: campaignId,
    _reason: 'lapsed_reapproval',
    _list_price: listPrice,
    _discount_amount: 0,
    // No `_assignment_id`: the fresh round carries no benefit — the lapsed one stays history.
    _actor_user_id: actorUserId,
  });
  if (supersedeError) {
    // e.g. a concurrent open took payment activity first — fall through; the guard rules there.
    console.error('[coupon-benefits] lapse supersede was refused', {
      campaignId,
      error: supersedeError.message,
    });
    return 'kept';
  }
  return 'lapsed';
}

/**
 * The binding applied at package choice (task 5.2): among the account's usable benefits that
 * carry an option for the chosen package, bind the one with the LOWEST final price (D18 — no
 * customer choice screen). A phone benefit is claimed first (once); a lost claim race just moves
 * to the next candidate. Returns 'bound' or 'none'.
 *
 * The caller created the campaign already — a benefit that cannot be bound leaves the campaign at
 * its list price; it never fails the purchase flow.
 */
export async function bindBestBenefit({
  campaignId,
  eventId,
  packageId,
  user,
}: {
  campaignId: string;
  eventId: string;
  packageId: string;
  user: SessionUser;
}): Promise<'bound' | 'none'> {
  const now = Date.now();
  const benefits = await listEligibleBenefits(user);

  const candidates = benefits
    .filter((b) => Date.parse(b.expiresAt) > now)
    // Bound to another campaign = not available (the bind function refuses it too).
    .filter((b) => b.state !== 'bound' || b.boundCampaignId === campaignId)
    .map((b) => ({ benefit: b, option: b.options.find((o) => o.packageId === packageId) }))
    .filter((c): c is { benefit: EligibleBenefit; option: BenefitOption } => c.option !== undefined)
    // Lowest final price first; ties go to the benefit that expires sooner (use it before it dies).
    .sort(
      (a, b) =>
        a.option.finalPrice - b.option.finalPrice ||
        Date.parse(a.benefit.expiresAt) - Date.parse(b.benefit.expiresAt),
    );

  const admin = createAdminClient();
  for (const { benefit } of candidates) {
    if (!benefit.claimed) {
      const claimed = await claimBenefit(benefit.assignmentId, user.id);
      if (!claimed) continue; // another account claimed it first — it is no longer this account's
    }

    const { error } = await admin.rpc('bind_coupon_assignment', {
      _assignment_id: benefit.assignmentId,
      _campaign_id: campaignId,
      _actor_user_id: user.id,
    });
    if (error) continue; // expired or taken mid-flight — the next candidate may still fit

    await logActivity({
      eventId,
      action: 'campaign.benefit_bound',
      meta: { campaignId, assignmentId: benefit.assignmentId, packageId },
    });
    return 'bound';
  }
  return 'none';
}
