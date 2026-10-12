import 'server-only';

import { logActivity } from '@/lib/data/activity';
import { listEligibleBenefits, type EligibleBenefit } from '@/lib/data/coupon-benefits';
import { computeOfferOption, type OfferKind } from '@/lib/offers/pricing';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';

// Staff assignment of a personal benefit (personal-coupons tasks 5.3/7.3, mockup ui/AssignNew.dc.html).
// The STAFF source: an assignment to a specific ACCOUNT, no phone proof needed (D13; the mockup's
// own note). The agent source (a sales call, D23's usage rules) is the 6.2 tool — it shares the
// frozen-options math here through computeOfferOption, never a second computation.
//
// What is frozen at assignment time (D3): kind, value, expiry (now + the offer's validity days),
// and one option per allowed package with the package's CURRENT list price and the computed final
// price. A later change to the offer or the package price never touches this assignment.
//
// D18's duplicate rule: a new assignment whose option set is IDENTICAL to an active one of the
// same account — the same packages, the same final price on each — does not stay: the one whose
// validity ends sooner is voided with an audited reason. Any other overlap leaves both active
// (best-price-per-package decides at binding).

export type StaffAssignmentResult = {
  assignmentId: string;
  /** 'created' | 'existing' (an idempotent retry) — and whether the duplicate rule voided a row. */
  outcome: 'created' | 'existing';
  duplicateVoided: 'none' | 'new' | 'previous';
  expiresAt: string;
  options: { packageId: string; packageName: string; listPrice: number; finalPrice: number }[];
};

type OfferRow = {
  id: string;
  kind: string;
  value: number;
  validity_days: number;
  allow_staff: boolean;
  is_active: boolean;
  offer_packages: { package_id: string; value_override: number | null }[] | null;
};

// The option sets are identical when the package set matches and every final price matches — in
// whole agorot, never float equality.
function sameOptionSet(
  a: { packageId: string; finalPrice: number }[],
  b: { packageId: string; finalPrice: number }[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (o: { packageId: string; finalPrice: number }) =>
    `${o.packageId}:${Math.round(o.finalPrice * 100)}`;
  const bKeys = new Set(b.map(key));
  return a.every((o) => bKeys.has(key(o)));
}

export type VoidRefusal = 'held_by_payment' | 'held_by_approved_terms' | 'already_ended';
export type VoidResult = { outcome: 'voided' } | { outcome: 'refused'; reason: VoidRefusal };

// Staff void (tasks 5.5/7.3). The refusals are the spec's own:
//   - a pending or in-review package payment HOLDS the assignment (D22) — an unknown payment
//     outcome never releases, and the row is shown as held by that payment;
//   - a benefit bound into APPROVED terms (a locked round) is not voided — the payment open guard
//     requires the bound benefit, so voiding it would break paying the approved price; it pays in
//     its validity or lapses (D15);
//   - consumed or void: nothing to void.
// A bound assignment on an UNLOCKED round is released first (the pricing returns to the list
// price) and then voided — both audited.
export async function voidStaffAssignment(assignmentId: string): Promise<VoidResult> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  const { data: asg, error } = await admin
    .from('coupon_assignments')
    .select('id, state, bound_campaign_id')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error || !asg) throw new Error('טעינת ההטבה נכשלה');
  if (asg.state === 'consumed' || asg.state === 'void') {
    return { outcome: 'refused', reason: 'already_ended' };
  }

  if (asg.state === 'bound' && asg.bound_campaign_id) {
    const { data: holding, error: payError } = await admin
      .from('payment_operations')
      .select('id')
      .eq('campaign_id', asg.bound_campaign_id)
      .eq('kind', 'package_purchase')
      .in('outcome', ['pending', 'review'])
      .limit(1)
      .maybeSingle();
    if (payError) throw new Error('בדיקת התשלום נכשלה');
    if (holding) return { outcome: 'refused', reason: 'held_by_payment' };

    const { data: round, error: roundError } = await admin
      .from('campaign_pricing')
      .select('id, locked_at, coupon_assignment_id')
      .eq('campaign_id', asg.bound_campaign_id)
      .is('superseded_at', null)
      .maybeSingle();
    if (roundError) throw new Error('טעינת המחיר נכשלה');
    if (round?.locked_at && round.coupon_assignment_id === assignmentId) {
      return { outcome: 'refused', reason: 'held_by_approved_terms' };
    }

    // Unlocked: the release function resets the pricing and frees the assignment side.
    const { error: releaseError } = await admin.rpc('release_coupon_assignment', {
      _assignment_id: assignmentId,
      _reason: 'voided_by_staff',
      _actor_user_id: staff.id,
    });
    if (releaseError) throw new Error('שחרור ההטבה נכשל');
  }

  const { error: voidError } = await admin
    .from('coupon_assignments')
    .update({ state: 'void' })
    .eq('id', assignmentId)
    .in('state', ['assigned', 'bound']);
  if (voidError) throw new Error('ביטול ההטבה נכשל');

  await admin.from('coupon_assignment_events').insert({
    assignment_id: assignmentId,
    action: 'voided',
    actor_user_id: staff.id,
    reason: 'staff_void',
  });
  await logActivity({
    action: 'coupon.voided',
    meta: { assignmentId, by: 'staff' },
  });
  return { outcome: 'voided' };
}

export async function createStaffAssignment({
  userId,
  offerId,
  idempotencyKey,
}: {
  userId: string;
  offerId: string;
  idempotencyKey: string;
}): Promise<StaffAssignmentResult> {
  const staff = await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  // The offer, server-side (D14): nothing about the discount is accepted from the browser.
  const { data: offerRow, error: offerError } = await admin
    .from('offers')
    .select('id, kind, value, validity_days, allow_staff, is_active, offer_packages(package_id, value_override)')
    .eq('id', offerId)
    .maybeSingle();
  if (offerError) throw new Error('טעינת ההצעה נכשלה');
  const offer = offerRow as OfferRow | null;
  if (!offer || !offer.is_active) throw new Error('ההצעה אינה פעילה');
  if (!offer.allow_staff) throw new Error('ההצעה אינה מוקצית על ידי צוות');
  const allowed = offer.offer_packages ?? [];
  if (allowed.length === 0) throw new Error('להצעה אין חבילות');

  // The options, frozen from the packages' CURRENT prices via the one shared computation.
  const { data: packages, error: packagesError } = await admin
    .from('packages')
    .select('id, name, price_with_vat')
    .in('id', allowed.map((p) => p.package_id));
  if (packagesError || !packages || packages.length !== allowed.length) {
    throw new Error('טעינת חבילות ההצעה נכשלה');
  }
  const byId = new Map(packages.map((p) => [p.id, p]));
  const kind: OfferKind = offer.kind === 'amount' ? 'amount' : 'percent';
  const options = allowed.map((p) => {
    const pkg = byId.get(p.package_id)!;
    const price = Number(pkg.price_with_vat);
    const { discountAmount, finalPrice } = computeOfferOption(
      price,
      kind,
      Number(p.value_override ?? offer.value),
    );
    if (finalPrice <= 0) throw new Error(`ההצעה מביאה את החבילה "${pkg.name}" למחיר אפס או שלילי`);
    return {
      packageId: p.package_id,
      packageName: pkg.name,
      listPrice: price,
      discountAmount,
      finalPrice,
    };
  });

  const expiresAt = new Date(Date.now() + offer.validity_days * 24 * 60 * 60 * 1000).toISOString();

  // The account's active benefits BEFORE the insert — the duplicate comparison set (D18). The
  // account's auth user supplies the verified phone, so an unclaimed phone benefit counts too.
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const activeBefore: EligibleBenefit[] = authUser?.user
    ? await listEligibleBenefits(authUser.user)
    : await listEligibleBenefits({ id: userId, phone: undefined, phone_confirmed_at: undefined });
  const activeUnexpired = activeBefore.filter((b) => Date.parse(b.expiresAt) > Date.now());

  const { data: inserted, error: insertError } = await admin
    .from('coupon_assignments')
    .insert({
      offer_id: offer.id,
      assigned_by: staff.id,
      user_id: userId,
      kind,
      value: offer.value,
      expires_at: expiresAt,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (insertError) {
    // 23505 on (assigned_by, idempotency_key): the idempotent retry — the existing assignment IS
    // the answer; no second assignment, no second duplicate pass.
    if (insertError.code === '23505') {
      const { data: existing } = await admin
        .from('coupon_assignments')
        .select('id, expires_at')
        .eq('assigned_by', staff.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing) {
        return {
          assignmentId: existing.id,
          outcome: 'existing',
          duplicateVoided: 'none',
          expiresAt: existing.expires_at,
          options: options.map(({ packageId, packageName, listPrice, finalPrice }) => ({
            packageId,
            packageName,
            listPrice,
            finalPrice,
          })),
        };
      }
    }
    throw new Error('הקצאת ההטבה נכשלה');
  }

  const { error: optionsError } = await admin.from('coupon_assignment_options').insert(
    options.map((o) => ({
      assignment_id: inserted.id,
      package_id: o.packageId,
      list_price: o.listPrice,
      discount_amount: o.discountAmount,
      final_price: o.finalPrice,
    })),
  );
  if (optionsError) {
    await admin.from('coupon_assignments').delete().eq('id', inserted.id);
    throw new Error('הקצאת ההטבה נכשלה');
  }

  await admin.from('coupon_assignment_events').insert({
    assignment_id: inserted.id,
    action: 'assigned',
    actor_user_id: staff.id,
    reason: null,
  });
  await logActivity({
    action: 'coupon.assigned',
    meta: {
      assignmentId: inserted.id,
      offerId: offer.id,
      targetUserId: userId,
      packageIds: options.map((o) => o.packageId),
    },
  });

  // D18's duplicate rule, after the insert: an identical option set may not stay twice — the one
  // whose validity ends SOONER is voided, audited as a duplicate. A bound duplicate is left alone
  // (its campaign relies on it); best-price binding already neutralizes it.
  let duplicateVoided: StaffAssignmentResult['duplicateVoided'] = 'none';
  const newSet = options.map(({ packageId, finalPrice }) => ({ packageId, finalPrice }));
  const duplicate = activeUnexpired.find(
    (b) => b.state === 'assigned' && sameOptionSet(newSet, b.options),
  );
  if (duplicate) {
    const newExpiresLater = Date.parse(expiresAt) >= Date.parse(duplicate.expiresAt);
    const voidedId = newExpiresLater ? duplicate.assignmentId : inserted.id;
    duplicateVoided = newExpiresLater ? 'previous' : 'new';
    const { error: voidError } = await admin
      .from('coupon_assignments')
      .update({ state: 'void' })
      .eq('id', voidedId)
      .eq('state', 'assigned');
    if (!voidError) {
      await admin.from('coupon_assignment_events').insert({
        assignment_id: voidedId,
        action: 'voided',
        actor_user_id: staff.id,
        reason: 'duplicate',
      });
      await logActivity({
        action: 'coupon.voided_duplicate',
        meta: { assignmentId: voidedId, keptAssignmentId: newExpiresLater ? inserted.id : duplicate.assignmentId },
      });
    }
  }

  return {
    assignmentId: inserted.id,
    outcome: 'created',
    duplicateVoided,
    expiresAt,
    options: options.map(({ packageId, packageName, listPrice, finalPrice }) => ({
      packageId,
      packageName,
      listPrice,
      finalPrice,
    })),
  };
}
