import 'server-only';

import { logActivity } from '@/lib/data/activity';
import { listEligibleBenefits, type EligibleBenefit } from '@/lib/data/coupon-benefits';
import { computeOfferOption, type OfferKind } from '@/lib/offers/pricing';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { listOfferPackageChoices, listOffers } from './offers';

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

// ── The staff list (task 7.3, mockup ui/Assignments.dc.html) ────────────────

export type StaffAssignmentListRow = {
  id: string;
  createdAt: string;
  expiresAt: string;
  state: 'assigned' | 'bound' | 'consumed' | 'void';
  offerTitle: string;
  source: { kind: 'agent' } | { kind: 'staff' };
  target: { userEmail: string | null; phoneMasked: string | null; claimed: boolean };
  options: { packageName: string; finalPrice: number }[];
  bound: { eventName: string | null; packageName: string | null; finalPrice: number | null } | null;
  /** The bound campaign's package payment, as the screen shows it. */
  payment: 'none' | 'pending' | 'review' | 'succeeded';
  /** Why the void button is disabled (D22/D10); null = void is offered. */
  heldBy: 'payment' | 'review' | 'approved_terms' | null;
  /** D10's guard: a SUCCEEDED payment whose assignment was not consumed — data damage to surface. */
  guard: boolean;
};

export type StaffAssignmentList = {
  rows: StaffAssignmentListRow[];
  /** D10 guard rows in the whole set — the banner says plainly whether any exist. */
  guardCount: number;
};

// The caller sees most of a number, never all of it: +9725…123 keeps the prefix and last 3.
function maskPhone(phone: string): string {
  if (phone.length <= 8) return phone;
  return `${phone.slice(0, 5)}…${phone.slice(-3)}`;
}

// Every assignment with its source, target, frozen options, bound campaign, and that campaign's
// package-payment outcome (the spec's staff-visibility requirement). Batched reads — never per-row
// queries against campaigns/payments; the user-email lookups go per UNIQUE id through the Auth
// admin API (small, capped set).
export async function listStaffAssignments(): Promise<StaffAssignmentList> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('coupon_assignments')
    .select(
      'id, created_at, expires_at, state, user_id, phone_e164, sales_call_attempt_id, assigned_by, bound_campaign_id, offers(title), coupon_assignment_options(final_price, packages(name))',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('טעינת ההטבות נכשלה');

  type Row = {
    id: string;
    created_at: string;
    expires_at: string;
    state: string;
    user_id: string | null;
    phone_e164: string | null;
    sales_call_attempt_id: string | null;
    assigned_by: string | null;
    bound_campaign_id: string | null;
    offers: { title: string } | null;
    coupon_assignment_options: { final_price: number; packages: { name: string } | null }[] | null;
  };
  const rows = (data ?? []) as Row[];

  // The bound campaigns: event name + the chosen package's name, one query.
  const campaignIds = [...new Set(rows.map((r) => r.bound_campaign_id).filter((x): x is string => !!x))];
  const campaignById = new Map<string, { eventName: string | null; packageName: string | null; templateId: string | null }>();
  const lockedCampaigns = new Set<string>();
  if (campaignIds.length > 0) {
    const { data: campaigns, error: cErr } = await admin
      .from('campaigns')
      .select('id, template_id, events(name), packages(name)')
      .in('id', campaignIds);
    if (cErr) throw new Error('טעינת הקמפיינים נכשלה');
    for (const c of (campaigns ?? []) as Array<{ id: string; template_id: string | null; events: { name: string } | null; packages: { name: string } | null }>) {
      campaignById.set(c.id, {
        eventName: c.events?.name ?? null,
        packageName: c.packages?.name ?? null,
        templateId: c.template_id,
      });
    }

    const { data: lockedRounds, error: lErr } = await admin
      .from('campaign_pricing')
      .select('campaign_id, locked_at')
      .in('campaign_id', campaignIds)
      .is('superseded_at', null);
    if (lErr) throw new Error('טעינת המחירים נכשלה');
    for (const r of lockedRounds ?? []) {
      if (r.locked_at) lockedCampaigns.add(r.campaign_id);
    }
  }

  // The package payments of those campaigns, one query; precedence for display: pending > review > succeeded.
  const paymentByCampaign = new Map<string, StaffAssignmentListRow['payment']>();
  if (campaignIds.length > 0) {
    const { data: payments, error: pErr } = await admin
      .from('payment_operations')
      .select('campaign_id, outcome')
      .in('campaign_id', campaignIds)
      .eq('kind', 'package_purchase')
      .in('outcome', ['pending', 'review', 'succeeded']);
    if (pErr) throw new Error('טעינת התשלומים נכשלה');
    const rank = { pending: 3, review: 2, succeeded: 1 } as const;
    for (const p of payments ?? []) {
      if (!p.campaign_id) continue;
      const held = paymentByCampaign.get(p.campaign_id);
      const next = p.outcome as keyof typeof rank;
      if (!held || rank[next] > rank[held as keyof typeof rank]) paymentByCampaign.set(p.campaign_id, next);
    }
  }

  // The claimed accounts' emails — per unique id, through the Auth admin API (the set is small).
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const emailById = new Map<string, string | null>();
  for (const id of userIds) {
    const { data: u } = await admin.auth.admin.getUserById(id);
    emailById.set(id, u?.user?.email ?? null);
  }

  let guardCount = 0;
  const out: StaffAssignmentListRow[] = rows.map((r) => {
    const bound = r.bound_campaign_id ? (campaignById.get(r.bound_campaign_id) ?? null) : null;
    const payment = r.bound_campaign_id ? (paymentByCampaign.get(r.bound_campaign_id) ?? 'none') : 'none';
    const boundFinal =
      bound?.templateId != null
        ? (r.coupon_assignment_options ?? []).find((o) => o.packages?.name === bound.packageName)?.final_price ?? null
        : null;
    const guard = payment === 'succeeded' && r.state !== 'consumed';
    if (guard) guardCount += 1;
    const heldBy: StaffAssignmentListRow['heldBy'] =
      r.state !== 'assigned' && r.state !== 'bound'
        ? null
        : payment === 'pending'
          ? 'payment'
          : payment === 'review'
            ? 'review'
            : r.bound_campaign_id && lockedCampaigns.has(r.bound_campaign_id)
              ? 'approved_terms'
              : null;
    return {
      id: r.id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      state: (['assigned', 'bound', 'consumed', 'void'] as const).includes(r.state as never)
        ? (r.state as StaffAssignmentListRow['state'])
        : 'void',
      offerTitle: r.offers?.title ?? '',
      source: r.sales_call_attempt_id ? { kind: 'agent' } : { kind: 'staff' },
      target: {
        userEmail: r.user_id ? (emailById.get(r.user_id) ?? null) : null,
        phoneMasked: r.phone_e164 ? maskPhone(r.phone_e164) : null,
        claimed: r.user_id !== null,
      },
      options: (r.coupon_assignment_options ?? []).map((o) => ({
        packageName: o.packages?.name ?? '',
        finalPrice: Number(o.final_price),
      })),
      bound: bound
        ? { eventName: bound.eventName, packageName: bound.packageName, finalPrice: boundFinal != null ? Number(boundFinal) : null }
        : null,
      payment,
      heldBy,
      guard,
    };
  });

  return { rows: out, guardCount };
}

// An EXACT-email account lookup for the assign form (the mockup's search field). The Auth admin
// API has no email filter, so this scans capped pages for an exact, case-insensitive match —
// fine at this platform's account scale, and never a substring search that could leak lookalikes.
export async function findAccountByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const needle = email.trim().toLowerCase();
  if (!needle) return null;

  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('חיפוש החשבון נכשל');
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === needle);
    if (hit) return { id: hit.id, email: hit.email ?? needle };
    if (data.users.length < 200) break;
  }
  return null;
}

// ── The assign form's offer choices (task 7.3, mockup ui/AssignNew.dc.html) ──
// Precomputed HERE, with the same computeOfferOption createStaffAssignment freezes, so the preview
// the staff member reads is exactly what the customer gets. Shown: active, staff-allowed offers
// with at least one allowed package — and, like the agent path, an offer that floors any package
// at zero or below is not assignable.

export type AssignableOffer = {
  id: string;
  title: string;
  /** "5%" or the formatted amount — the select's label next to the title. */
  valueLabel: string;
  /** The expiry the assignment WOULD get if created now (now + validity days), pre-formatted. */
  expiresLabel: string;
  options: { name: string; listPrice: string; finalPrice: string }[];
};

export async function listAssignableOffers(
  format: { currency: (amount: number) => string; date: (value: Date) => string },
): Promise<AssignableOffer[]> {
  await requirePlatformPermission('manage_billing');
  const [offers, choices] = await Promise.all([listOffers(), listOfferPackageChoices()]);
  const byPackage = new Map(choices.map((c) => [c.id, { name: c.name, price: c.price_with_vat }]));
  const nowMs = Date.now();

  const assignable: AssignableOffer[] = [];
  for (const offer of offers) {
    if (!offer.is_active || !offer.allow_staff || offer.packages.length === 0) continue;
    const kind: OfferKind = offer.kind === 'amount' ? 'amount' : 'percent';
    const options: AssignableOffer['options'] = [];
    let honorable = true;
    for (const allowed of offer.packages) {
      const pkg = byPackage.get(allowed.package_id);
      if (!pkg) {
        honorable = false;
        break;
      }
      const { finalPrice } = computeOfferOption(pkg.price, kind, Number(allowed.value_override ?? offer.value));
      if (finalPrice <= 0) {
        honorable = false;
        break;
      }
      options.push({
        name: pkg.name,
        listPrice: format.currency(pkg.price),
        finalPrice: format.currency(finalPrice),
      });
    }
    if (!honorable || options.length === 0) continue;

    assignable.push({
      id: offer.id,
      title: offer.title,
      valueLabel: kind === 'percent' ? `${Number(offer.value)}%` : format.currency(Number(offer.value)),
      expiresLabel: format.date(new Date(nowMs + offer.validity_days * 24 * 60 * 60 * 1000)),
      options,
    });
  }
  return assignable;
}
